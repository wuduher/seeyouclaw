"""LLM-assisted vision routing for seeyouclaw WebUI."""

from __future__ import annotations

import json
import re
from typing import Any

import json_repair
from loguru import logger

from nanobot.providers.factory import load_provider_snapshot

ROUTER_PRESET_CANDIDATES: tuple[str | None, ...] = (
    "seeyouclaw-router",
    "deepseek-v4-flash",
    "deepseek-flash",
    None,
)
ROUTER_MAX_TOKENS = 220
ROUTE_LEVELS = {"audio_only", "vision_snapshot", "vision_burst"}
CONTEXT_KINDS = {"appearance", "emotion", "scene", "screen"}
EMOTION_LEVELS = {"low", "medium", "high"}

SYSTEM_PROMPT = """You are seeyouclaw's fast vision router.

Decide whether the user's latest message requires a fresh camera snapshot.
Use the active visual slot/context for short follow-ups such as "now?",
"what about this?", "this color?", or Chinese equivalents like "现在呢".

Route to vision_snapshot when answering depends on current observable camera
facts: visible objects, colors, counts, position, clothing, screen/OCR text,
the user's visible state, or a strong emotional/stress change where observing
the scene could improve safety or helpfulness.

Do not route for ordinary chat, preferences, memory-only questions, or general
knowledge that does not depend on the user's current camera view. Avoid
sensitive profiling such as age, identity, health diagnosis, attractiveness, or
body evaluation.

Examples:
- "我的椅子是什么颜色的" -> vision_snapshot, visual_attribute, subject chair, attribute color.
- "我现在穿什么衣服" -> vision_snapshot, appearance_query.
- Context: subject=shirt, attribute=color. "现在呢" -> vision_snapshot, contextual_followup.
- "我慌死了，你看看我现在状态" -> vision_snapshot, emotion_shift, emotionEscalation high.
- "天空是什么颜色" -> audio_only.

Return only a JSON object with:
ok, needVision, route, intent, reason, confidence, emotionEscalation, slot,
bypassCooldown.
slot may contain kind, subject, attribute, questionType.
"""


def _fallback_response(reason: str) -> dict[str, Any]:
    return {
        "ok": False,
        "needVision": False,
        "route": "audio_only",
        "intent": "router_unavailable",
        "reason": reason,
        "confidence": 0.0,
        "emotionEscalation": "low",
        "slot": None,
        "bypassCooldown": False,
    }


def _clean_text(value: Any, *, max_len: int = 80) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = re.sub(r"\s+", " ", value).strip()
    if not cleaned:
        return None
    return cleaned[:max_len]


def _clamp_confidence(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, number))


def _json_from_model_text(text: str) -> dict[str, Any]:
    candidate = text.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", candidate, flags=re.IGNORECASE | re.DOTALL)
    if fenced:
        candidate = fenced.group(1).strip()
    parsed = json_repair.loads(candidate)
    if not isinstance(parsed, dict):
        raise ValueError("router response was not a JSON object")
    return parsed


def _sanitize_slot(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    kind = _clean_text(value.get("kind"), max_len=24)
    if kind not in CONTEXT_KINDS:
        kind = None
    slot = {
        "kind": kind,
        "subject": _clean_text(value.get("subject"), max_len=48),
        "attribute": _clean_text(value.get("attribute"), max_len=48),
        "questionType": _clean_text(value.get("questionType"), max_len=48),
    }
    cleaned = {key: item for key, item in slot.items() if item}
    return cleaned or None


def _sanitize_router_output(raw: dict[str, Any], *, model: str | None = None) -> dict[str, Any]:
    need_vision = bool(raw.get("needVision"))
    route = _clean_text(raw.get("route"), max_len=24)
    if route not in ROUTE_LEVELS:
        route = "vision_snapshot" if need_vision else "audio_only"
    if not need_vision:
        route = "audio_only"

    emotion = _clean_text(raw.get("emotionEscalation"), max_len=16)
    if emotion not in EMOTION_LEVELS:
        emotion = "low"

    slot = _sanitize_slot(raw.get("slot"))
    if need_vision and (slot is None or "kind" not in slot):
        intent = (_clean_text(raw.get("intent"), max_len=60) or "").lower()
        inferred_kind = "scene"
        if "appearance" in intent or "wear" in intent or "clothing" in intent:
            inferred_kind = "appearance"
        elif "emotion" in intent or emotion == "high":
            inferred_kind = "emotion"
        elif "screen" in intent or "ocr" in intent:
            inferred_kind = "screen"
        slot = {**(slot or {}), "kind": inferred_kind}

    result = {
        "ok": True,
        "needVision": need_vision,
        "route": route,
        "intent": _clean_text(raw.get("intent"), max_len=60) or (
            "visual_route" if need_vision else "no_visual_need"
        ),
        "reason": _clean_text(raw.get("reason"), max_len=160) or (
            "fresh camera facts are needed" if need_vision else "no fresh camera facts needed"
        ),
        "confidence": _clamp_confidence(raw.get("confidence")),
        "emotionEscalation": emotion,
        "slot": slot,
        "bypassCooldown": bool(raw.get("bypassCooldown")),
    }
    if model:
        result["model"] = model
    return result


def _router_user_prompt(payload: dict[str, Any]) -> str:
    compact = {
        "text": _clean_text(payload.get("text"), max_len=600) or "",
        "context": payload.get("context") if isinstance(payload.get("context"), dict) else None,
        "cameraEnabled": bool(payload.get("cameraEnabled")),
        "cooldownActive": bool(payload.get("cooldownActive")),
        "attachedImageCount": payload.get("attachedImageCount"),
        "maxImagesPerTurn": payload.get("maxImagesPerTurn"),
    }
    return json.dumps(compact, ensure_ascii=False)


def _load_router_snapshot() -> Any:
    errors: list[str] = []
    for preset_name in ROUTER_PRESET_CANDIDATES:
        try:
            return load_provider_snapshot(preset_name=preset_name)
        except Exception as exc:
            label = preset_name or "default"
            errors.append(f"{label}: {exc}")
            logger.debug("seeyouclaw router preset {} unavailable: {}", label, exc)
    raise RuntimeError("; ".join(errors))


async def route_seeyouclaw_vision(payload: dict[str, Any]) -> dict[str, Any]:
    text = _clean_text(payload.get("text"), max_len=600)
    if not text:
        return _fallback_response("empty text")

    try:
        snapshot = _load_router_snapshot()
    except Exception as exc:
        logger.warning("seeyouclaw vision router unavailable: {}", exc)
        return _fallback_response("router provider unavailable")

    try:
        response = await snapshot.provider.chat_with_retry(
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": _router_user_prompt(payload)},
            ],
            tools=[],
            model=snapshot.model,
            max_tokens=ROUTER_MAX_TOKENS,
            temperature=0.0,
        )
        raw = _json_from_model_text(response.content or "")
        return _sanitize_router_output(raw, model=snapshot.model)
    except Exception as exc:
        logger.warning("seeyouclaw vision router failed: {}", exc)
        return _fallback_response("router classification failed")
