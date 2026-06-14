"""LLM-assisted DeepTalk project updater for seeyouclaw.

Replaces keyword-only sidecar updates with semantic OpenSpec-style artifact
synthesis. Uses a low-cost router preset and returns structured JSON that maps
to proposal.md, design.md, tasks.md, and specs/main/spec.md.
"""

from __future__ import annotations

import json
import re
from typing import Any, Mapping

import json_repair
from loguru import logger

from nanobot.providers.factory import load_provider_snapshot

UPDATER_PRESET_CANDIDATES: tuple[str | None, ...] = (
    "seeyouclaw-router",
    "deepseek-v4-flash",
    "deepseek-flash",
    None,
)
UPDATER_MAX_TOKENS = 900
MAX_LIST_ITEMS = 6
MAX_FIELD_CHARS = 1_200
MAX_NOTES_EXCERPT_CHARS = 2_400
LANES = frozenset({
    "emotional_reflection",
    "research",
    "essay",
    "project_planning",
    "mixed",
})

SYSTEM_PROMPT = """You are seeyouclaw's DeepTalk project sidecar updater.

Your job is NOT to copy user quotes into structured files. Synthesize the
conversation into compact OpenSpec-style artifacts that a host can reuse on the
next voice turn.

Artifact map (OpenSpec-inspired):
- why / open_questions -> proposal.md
- current / design_notes -> design.md
- tasks -> tasks.md
- spec_body -> specs/main/spec.md (user-specific requirements and scenarios)

Rules:
1. Write in the user's language when the conversation is Chinese; otherwise English.
2. Synthesize meaning. Do not paste long ASR transcripts into why or current.
3. Replace generic template questions with conversation-specific questions.
4. For emotional reflection: capture themes, felt difficulty, relationship or life
   context, and what the user wants from the talk — not research SDD boilerplate.
5. For research or essay lanes: capture hypotheses, scope, evidence needs, and
   concrete artifacts — not DeepTalk system documentation.
6. spec_body must describe THIS user's situation and requirements, never generic
   "Preserve DeepTalk continuity" template text.
7. guidance_moves and proactive_signals should be short and useful for the NEXT
   host turn only (max 4 each).
8. tasks should be conversation follow-ups, not "Clarify the main question" unless
   that is still genuinely the gap.

Return JSON only with this schema:
{
  "lane": "emotional_reflection|research|essay|project_planning|mixed",
  "why": "string",
  "current": "string",
  "open_questions": ["string"],
  "tasks": ["string"],
  "proactive_signals": ["string"],
  "guidance_moves": ["string"],
  "design_notes": "markdown string (themes, tradeoffs, emotional threads)",
  "spec_body": "markdown string (requirements and scenarios for this user)"
}
"""


def _clean_text(value: Any, limit: int = MAX_FIELD_CHARS) -> str:
    if not isinstance(value, str):
        return ""
    cleaned = re.sub(r"\s+", " ", value.replace("\x00", " ")).strip()
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[: limit - 1].rstrip() + "..."


def _clean_list(value: Any, *, item_limit: int = 180) -> list[str]:
    if not isinstance(value, list):
        return []
    items: list[str] = []
    seen: set[str] = set()
    for raw in value:
        item = _clean_text(raw, item_limit)
        if not item:
            continue
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        items.append(item)
        if len(items) >= MAX_LIST_ITEMS:
            break
    return items


def _json_from_model_text(text: str) -> dict[str, Any]:
    candidate = text.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", candidate, flags=re.IGNORECASE | re.DOTALL)
    if fenced:
        candidate = fenced.group(1).strip()
    parsed = json_repair.loads(candidate)
    if not isinstance(parsed, dict):
        raise ValueError("updater response was not a JSON object")
    return parsed


def _notes_excerpt(notes_text: str) -> str:
    text = notes_text.strip()
    if len(text) <= MAX_NOTES_EXCERPT_CHARS:
        return text
    return text[-MAX_NOTES_EXCERPT_CHARS:]


def _updater_user_prompt(payload: Mapping[str, Any]) -> str:
    summary = payload.get("summary")
    if not isinstance(summary, dict):
        summary = {}
    compact = {
        "title": _clean_text(payload.get("title"), 80),
        "turnCount": payload.get("turnCount"),
        "lane": _clean_text(summary.get("lane"), 40) or None,
        "currentSummary": {
            "why": _clean_text(summary.get("why"), 400),
            "current": _clean_text(summary.get("current"), 400),
            "open_questions": _clean_list(summary.get("open_questions"), item_limit=160),
            "tasks": _clean_list(summary.get("tasks"), item_limit=160),
        },
        "recentNotes": _clean_text(payload.get("notesExcerpt"), MAX_NOTES_EXCERPT_CHARS),
        "newTurn": {
            "userText": _clean_text(payload.get("userText"), 600) or None,
            "assistantText": _clean_text(payload.get("assistantText"), 600) or None,
            "observationText": _clean_text(payload.get("observationText"), 400) or None,
            "hookText": _clean_text(payload.get("hookText"), 200) or None,
        },
    }
    return json.dumps(compact, ensure_ascii=False)


def _sanitize_updater_output(raw: dict[str, Any]) -> dict[str, Any]:
    lane = _clean_text(raw.get("lane"), 40)
    if lane not in LANES:
        lane = "mixed"
    design_notes = raw.get("design_notes")
    spec_body = raw.get("spec_body")
    return {
        "lane": lane,
        "why": _clean_text(raw.get("why"), 500),
        "current": _clean_text(raw.get("current"), 500),
        "open_questions": _clean_list(raw.get("open_questions"), item_limit=160),
        "tasks": _clean_list(raw.get("tasks"), item_limit=160),
        "proactive_signals": _clean_list(raw.get("proactive_signals"), item_limit=160),
        "guidance_moves": _clean_list(raw.get("guidance_moves"), item_limit=160),
        "design_notes": _clean_text(design_notes, 2_000) if isinstance(design_notes, str) else "",
        "spec_body": _clean_text(spec_body, 3_000) if isinstance(spec_body, str) else "",
    }


def _load_updater_snapshot() -> Any:
    errors: list[str] = []
    for preset_name in UPDATER_PRESET_CANDIDATES:
        try:
            return load_provider_snapshot(preset_name=preset_name)
        except Exception as exc:
            label = preset_name or "default"
            errors.append(f"{label}: {exc}")
            logger.debug("seeyouclaw deeptalk updater preset {} unavailable: {}", label, exc)
    raise RuntimeError("; ".join(errors))


async def llm_synthesize_deeptalk_update(payload: Mapping[str, Any]) -> dict[str, Any] | None:
    """Return sanitized artifact fields or None when the updater cannot run."""
    if not any([
        _clean_text(payload.get("userText")),
        _clean_text(payload.get("assistantText")),
        _clean_text(payload.get("observationText")),
        _clean_text(payload.get("hookText")),
    ]):
        return None

    try:
        snapshot = _load_updater_snapshot()
    except Exception as exc:
        logger.warning("seeyouclaw deeptalk updater unavailable: {}", exc)
        return None

    try:
        response = await snapshot.provider.chat_with_retry(
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": _updater_user_prompt(payload)},
            ],
            tools=[],
            model=snapshot.model,
            max_tokens=UPDATER_MAX_TOKENS,
            reasoning_effort="none",
            temperature=0.2,
        )
        raw = _json_from_model_text(response.content or "")
        result = _sanitize_updater_output(raw)
        result["updater_model"] = snapshot.model
        return result
    except Exception as exc:
        logger.warning("seeyouclaw deeptalk updater failed: {}", exc)
        return None
