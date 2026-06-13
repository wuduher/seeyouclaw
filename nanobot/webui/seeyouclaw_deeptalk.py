"""Disk-backed DeepTalk project scaffold for seeyouclaw.

This module is intentionally deterministic. The nanobot conversation remains
the source of truth for language quality, while this sidecar records a compact
OpenSpec-style project shape that can be shown in the telephone UI.
"""

from __future__ import annotations

import json
import re
import shutil
import uuid
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

PROJECT_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}$")
QUESTION_RE = re.compile("[^?\n\uFF1F]{4,160}[?\uFF1F]")

MAX_FIELD_CHARS = 1_200
MAX_FILE_CHARS = 6_000
MAX_LIST_ITEMS = 6

DEFAULT_PROACTIVE_SIGNALS = [
    "SDD questions: clarify why, scope, requirements, scenarios, trade-offs, and tasks.",
    "Empathy and curiosity: ask from the user's motivation, uncertainty, and emotional state.",
    "Multimodal observation window: reason over available frames or video context, not one frozen keyframe.",
    "Hook nudges: revisit stale questions, drift, long pauses, repeated uncertainty, or archive readiness.",
]

ARCHIVE_KEYWORDS = (
    "archive",
    "archived",
    "summarize",
    "summary",
    "\u5f52\u6863",
    "\u603b\u7ed3",
)
DESIGN_KEYWORDS = (
    "how",
    "design",
    "plan",
    "approach",
    "implement",
    "\u600e\u4e48",
    "\u5982\u4f55",
    "\u65b9\u6848",
    "\u8bbe\u8ba1",
    "\u5b9e\u73b0",
)
PROJECT_KEYWORDS = (
    "project",
    "research",
    "idea",
    "paper",
    "blog",
    "\u9879\u76ee",
    "\u79d1\u7814",
    "\u60f3\u6cd5",
)
EMPATHY_KEYWORDS = (
    "stuck",
    "uncertain",
    "confused",
    "worried",
    "hard",
    "\u5361\u4f4f",
    "\u4e0d\u786e\u5b9a",
    "\u56f0\u60d1",
    "\u7126\u8651",
    "\u96be",
)
OBSERVATION_KEYWORDS = (
    "camera",
    "frame",
    "frames",
    "video",
    "screen",
    "posture",
    "expression",
    "\u6444\u50cf\u5934",
    "\u753b\u9762",
    "\u89c6\u9891",
    "\u8868\u60c5",
)


def ensure_deeptalk_project(workspace_path: Path, payload: Mapping[str, Any]) -> dict[str, Any]:
    chat_id = _required_text(payload, "chatId")
    title = _clean_text(str(payload.get("title") or "DeepTalk"), 80) or "DeepTalk"
    seed_text = _clean_text(str(payload.get("seedText") or ""), MAX_FIELD_CHARS)

    existing = _find_project_by_chat(workspace_path, chat_id)
    if existing is not None:
        return {
            "ok": True,
            "project": _project_response(
                workspace_path,
                existing,
                _project_dir(workspace_path, existing["id"]),
            ),
        }

    project_id = _new_project_id(title)
    now = _now_iso()
    project = {
        "id": project_id,
        "chat_id": chat_id,
        "title": title,
        "created_at": now,
        "updated_at": now,
        "turn_count": 0,
        "archive_count": 0,
        "summary": {
            "why": seed_text or "A DeepTalk exploration started from telephone mode.",
            "current": seed_text or "Project opened; waiting for the first concrete direction.",
            "open_questions": [
                "What concrete outcome should this DeepTalk produce?",
            ],
            "tasks": [
                "Clarify the main question.",
                "Choose one concrete artifact to preserve.",
            ],
            "proactive_signals": list(DEFAULT_PROACTIVE_SIGNALS),
        },
    }
    project_dir = _project_dir(workspace_path, project_id)
    (project_dir / "specs" / "main").mkdir(parents=True, exist_ok=True)
    (project_dir / "archive").mkdir(parents=True, exist_ok=True)
    _write_json(project_dir / "project.json", project)
    _write_markdown_files(project_dir, project)
    (project_dir / "notes.md").write_text("# Notes\n", encoding="utf-8")
    return {"ok": True, "project": _project_response(workspace_path, project, project_dir)}


def update_deeptalk_project(workspace_path: Path, payload: Mapping[str, Any]) -> dict[str, Any]:
    project = _resolve_project(workspace_path, payload)
    project_dir = _project_dir(workspace_path, project["id"])
    user_text = _clean_text(str(payload.get("userText") or ""), MAX_FIELD_CHARS)
    assistant_text = _clean_text(str(payload.get("assistantText") or ""), MAX_FIELD_CHARS)
    observation_text = _clean_text(str(payload.get("observationText") or ""), MAX_FIELD_CHARS)
    hook_text = _clean_text(str(payload.get("hookText") or ""), MAX_FIELD_CHARS)
    if not any([user_text, assistant_text, observation_text, hook_text]):
        return {"ok": True, "project": _project_response(workspace_path, project, project_dir)}

    now = _now_iso()
    if user_text:
        project["turn_count"] = int(project.get("turn_count") or 0) + 1
        _append_note(project_dir, project["turn_count"], "User", user_text)
        _update_summary_from_text(project, user_text, source="user")
    if assistant_text:
        _append_note(
            project_dir,
            int(project.get("turn_count") or 0),
            "Assistant",
            assistant_text,
        )
        _update_summary_from_text(project, assistant_text, source="assistant")
    if observation_text:
        _append_note(
            project_dir,
            int(project.get("turn_count") or 0),
            "Observation",
            observation_text,
        )
        _update_summary_from_text(project, observation_text, source="observation")
    if hook_text:
        _append_note(project_dir, int(project.get("turn_count") or 0), "Hook", hook_text)
        _update_summary_from_text(project, hook_text, source="hook")

    project["updated_at"] = now
    _write_json(project_dir / "project.json", project)
    _write_markdown_files(project_dir, project)
    return {"ok": True, "project": _project_response(workspace_path, project, project_dir)}


def archive_deeptalk_project(workspace_path: Path, payload: Mapping[str, Any]) -> dict[str, Any]:
    project = _resolve_project(workspace_path, payload)
    project_dir = _project_dir(workspace_path, project["id"])
    archive_name = _now_iso().replace(":", "").replace("-", "").replace("Z", "Z")
    archive_dir = project_dir / "archive" / archive_name
    archive_dir.mkdir(parents=True, exist_ok=True)
    for relative in [
        "project.json",
        "proposal.md",
        "design.md",
        "tasks.md",
        "notes.md",
        "specs/main/spec.md",
    ]:
        src = project_dir / relative
        if src.exists():
            dst = archive_dir / relative
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
    project["archive_count"] = int(project.get("archive_count") or 0) + 1
    project["updated_at"] = _now_iso()
    _write_json(project_dir / "project.json", project)
    return {
        "ok": True,
        "archivePath": _relative_display_path(workspace_path, archive_dir),
        "project": _project_response(workspace_path, project, project_dir),
    }


def read_deeptalk_project(workspace_path: Path, payload: Mapping[str, Any]) -> dict[str, Any]:
    project = _resolve_project(workspace_path, payload)
    project_dir = _project_dir(workspace_path, project["id"])
    return {"ok": True, "project": _project_response(workspace_path, project, project_dir)}


def _required_text(payload: Mapping[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"missing {key}")
    return _clean_text(value, 160)


def _project_root(workspace_path: Path) -> Path:
    return workspace_path / ".seeyouclaw" / "deeptalk" / "projects"


def _project_dir(workspace_path: Path, project_id: str) -> Path:
    if PROJECT_ID_RE.match(project_id) is None:
        raise ValueError("invalid projectId")
    root = _project_root(workspace_path)
    return root / project_id


def _new_project_id(title: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:36] or "deeptalk"
    stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    return f"{stamp}-{slug}-{uuid.uuid4().hex[:6]}"


def _now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _clean_text(text: str, limit: int) -> str:
    cleaned = text.replace("\x00", " ").strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[: limit - 1].rstrip() + "..."


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return value if isinstance(value, dict) else None


def _write_json(path: Path, value: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _find_project_by_chat(workspace_path: Path, chat_id: str) -> dict[str, Any] | None:
    root = _project_root(workspace_path)
    if not root.exists():
        return None
    for meta_file in sorted(root.glob("*/project.json")):
        project = _read_json(meta_file)
        if project and project.get("chat_id") == chat_id and isinstance(project.get("id"), str):
            return project
    return None


def _resolve_project(workspace_path: Path, payload: Mapping[str, Any]) -> dict[str, Any]:
    project_id = payload.get("projectId")
    if isinstance(project_id, str) and project_id.strip():
        project_dir = _project_dir(workspace_path, _clean_text(project_id, 128))
        project = _read_json(project_dir / "project.json")
        if project is None:
            raise ValueError("project not found")
        return project
    chat_id = payload.get("chatId")
    if isinstance(chat_id, str) and chat_id.strip():
        project = _find_project_by_chat(workspace_path, _clean_text(chat_id, 160))
        if project is not None:
            return project
    raise ValueError("project not found")


def _summary(project: Mapping[str, Any]) -> dict[str, Any]:
    raw = project.get("summary")
    if not isinstance(raw, dict):
        raw = {}
    proactive = [str(x) for x in raw.get("proactive_signals") or [] if str(x).strip()]
    if not proactive:
        proactive = list(DEFAULT_PROACTIVE_SIGNALS)
    return {
        "why": str(raw.get("why") or ""),
        "current": str(raw.get("current") or ""),
        "open_questions": [str(x) for x in raw.get("open_questions") or [] if str(x).strip()],
        "tasks": [str(x) for x in raw.get("tasks") or [] if str(x).strip()],
        "proactive_signals": proactive[-MAX_LIST_ITEMS:],
    }


def _project_response(
    workspace_path: Path,
    project: Mapping[str, Any],
    project_dir: Path,
) -> dict[str, Any]:
    files = {
        "proposal": _read_text(project_dir / "proposal.md"),
        "design": _read_text(project_dir / "design.md"),
        "tasks": _read_text(project_dir / "tasks.md"),
        "notes": _read_text(project_dir / "notes.md"),
        "spec": _read_text(project_dir / "specs" / "main" / "spec.md"),
    }
    return {
        "id": project.get("id"),
        "chatId": project.get("chat_id"),
        "title": project.get("title"),
        "createdAt": project.get("created_at"),
        "updatedAt": project.get("updated_at"),
        "turnCount": project.get("turn_count", 0),
        "archiveCount": project.get("archive_count", 0),
        "path": _relative_display_path(workspace_path, project_dir),
        "summary": _summary(project),
        "files": files,
    }


def _relative_display_path(workspace_path: Path, path: Path) -> str:
    try:
        return path.relative_to(workspace_path).as_posix()
    except ValueError:
        return path.as_posix()


def _read_text(path: Path) -> str:
    if not path.exists():
        return ""
    text = path.read_text(encoding="utf-8")
    if len(text) <= MAX_FILE_CHARS:
        return text
    return text[:MAX_FILE_CHARS].rstrip() + "\n..."


def _append_note(project_dir: Path, turn: int, role: str, text: str) -> None:
    notes = project_dir / "notes.md"
    notes.parent.mkdir(parents=True, exist_ok=True)
    with notes.open("a", encoding="utf-8") as f:
        f.write(f"\n## Turn {max(turn, 1)} - {role}\n\n{text}\n")


def _append_unique(items: list[str], item: str) -> None:
    normalized = _clean_text(item, 180)
    if not normalized:
        return
    lowered = {existing.lower() for existing in items}
    if normalized.lower() in lowered:
        return
    items.append(normalized)
    del items[:-MAX_LIST_ITEMS]


def _has_any(text: str, keywords: tuple[str, ...]) -> bool:
    lowered = text.lower()
    return any(keyword.lower() in lowered for keyword in keywords)


def _update_summary_from_text(project: dict[str, Any], text: str, *, source: str) -> None:
    summary = _summary(project)
    if source == "user":
        summary["current"] = text
        if summary["why"].startswith("A DeepTalk exploration"):
            summary["why"] = text

    for question in QUESTION_RE.findall(text):
        _append_unique(summary["open_questions"], question.strip())

    if source == "observation" or _has_any(text, OBSERVATION_KEYWORDS):
        _append_unique(
            summary["proactive_signals"],
            "Observation-window signal: ask what changed across the available frames or video.",
        )
        _append_unique(
            summary["open_questions"],
            "What does the recent visual window change about the user's state or project direction?",
        )
    if source == "hook":
        _append_unique(
            summary["proactive_signals"],
            "Hook signal: decide whether to revisit, split, archive, or advance the current thread.",
        )
        _append_unique(
            summary["open_questions"],
            "Is this the right moment to archive, split, or move the DeepTalk forward?",
        )
    if source == "user" or _has_any(text, PROJECT_KEYWORDS + DESIGN_KEYWORDS):
        _append_unique(
            summary["proactive_signals"],
            "SDD signal: map this turn to proposal, design, requirements, scenarios, or tasks.",
        )
        _append_unique(
            summary["open_questions"],
            "Which artifact should this become: proposal, design decision, requirement, scenario, or task?",
        )
    if _has_any(text, EMPATHY_KEYWORDS):
        _append_unique(
            summary["proactive_signals"],
            "Empathy signal: ask from the user's uncertainty or felt difficulty before structuring.",
        )
        _append_unique(
            summary["open_questions"],
            "What is the felt difficulty underneath this idea right now?",
        )

    if source == "user":
        if _has_any(text, ARCHIVE_KEYWORDS):
            _append_unique(summary["tasks"], "Archive the current exploration snapshot.")
        elif _has_any(text, DESIGN_KEYWORDS):
            _append_unique(summary["tasks"], "Turn the exploration into a concrete design option.")
        elif _has_any(text, PROJECT_KEYWORDS):
            _append_unique(summary["tasks"], "Name the core question and expected artifact.")
    project["summary"] = summary


def _markdown_list(items: list[str]) -> str:
    return "\n".join(f"- {item}" for item in items) or "- TBD"


def _write_markdown_files(project_dir: Path, project: Mapping[str, Any]) -> None:
    summary = _summary(project)
    title = str(project.get("title") or "DeepTalk")
    questions = _markdown_list(summary["open_questions"])
    tasks = "\n".join(f"- [ ] {item}" for item in summary["tasks"]) or "- [ ] TBD"
    proactive = _markdown_list(summary["proactive_signals"])
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "proposal.md").write_text(
        "\n".join([
            f"# {title} Proposal",
            "",
            "## Why",
            "",
            summary["why"] or "TBD",
            "",
            "## Open Questions",
            "",
            questions,
            "",
            "## Proactive Signals",
            "",
            proactive,
            "",
        ]),
        encoding="utf-8",
    )
    (project_dir / "design.md").write_text(
        "\n".join([
            f"# {title} Design",
            "",
            "## Current State",
            "",
            summary["current"] or "TBD",
            "",
            "## DeepTalk Runtime",
            "",
            "- Telephone mode remains the live conversation loop.",
            "- This project sidecar records the durable OpenSpec-style state.",
            "- Sidecar updates are deterministic and should not block spoken replies.",
            "",
            "## Proactivity Model",
            "",
            "- SDD questions turn vague conversation into proposal, design, tasks, and specs.",
            "- Empathy and curiosity questions respond to the user's state, motivation, and uncertainty.",
            "- Multimodal observations should be treated as a recent window of frames or video context.",
            "- Hook nudges can surface stale questions, drift, pause, follow-up, or archive readiness.",
            "",
        ]),
        encoding="utf-8",
    )
    (project_dir / "tasks.md").write_text(
        "\n".join([
            f"# {title} Tasks",
            "",
            tasks,
            "",
        ]),
        encoding="utf-8",
    )
    spec_dir = project_dir / "specs" / "main"
    spec_dir.mkdir(parents=True, exist_ok=True)
    (spec_dir / "spec.md").write_text(
        "\n".join([
            f"# {title} Main Spec",
            "",
            "## Requirements",
            "",
            "### Requirement: Preserve DeepTalk continuity",
            "",
            "The assistant SHOULD preserve a project record while the user explores an idea.",
            "",
            "#### Scenario: User adds a new thought",
            "",
            "- WHEN a DeepTalk utterance is processed",
            "- THEN the project summary and notes SHOULD be updated",
            "",
            "### Requirement: Ask proactive project questions",
            "",
            "The assistant SHOULD derive proactive questions from SDD structure, user state, "
            "multimodal observations, and configured hook nudges.",
            "",
            "#### Scenario: A signal appears",
            "",
            "- WHEN the conversation reveals a requirement, design choice, emotional cue, "
            "observation window, stale question, or archive opportunity",
            "- THEN DeepTalk SHOULD ask one focused next question",
            "- AND the sidecar SHOULD record the active proactive signal",
            "",
            "### Requirement: Treat multimodal input as an observation window",
            "",
            "DeepTalk SHOULD support summaries from several keyframes or video snippets instead "
            "of assuming a single captured frame represents the user's state.",
            "",
            "#### Scenario: Visual context is available",
            "",
            "- WHEN multiple frames or a short video-derived observation are available",
            "- THEN DeepTalk SHOULD ask from the observed change over time",
            "- AND it SHOULD avoid storing sensitive visual profile facts unless approved",
            "",
        ]),
        encoding="utf-8",
    )
