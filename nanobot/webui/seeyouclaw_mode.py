"""Runtime prompt hints for seeyouclaw WebUI interaction modes."""

from __future__ import annotations

from typing import Any, Mapping

SEEYOUCLAW_TELEPHONE_METADATA_KEY = "seeyouclaw_telephone"
SEEYOUCLAW_DEEPTALK_METADATA_KEY = "seeyouclaw_deeptalk"

TELEPHONE_REPLY_STYLE_LINE = (
    "seeyouclaw telephone mode: Reply for spoken playback in a live video call. "
    "Use concise, conversational language (usually 1-3 short sentences). "
    "Avoid markdown, bullet lists, code blocks, and long written-style paragraphs. "
    "Match the user's language."
)

DEEPTALK_RUNTIME_LINES = [
    (
        "seeyouclaw deeptalk mode is ON. Do not behave like ordinary Q&A. "
        "You are the proactive host of an in-depth conversation about emotions, "
        "research ideas, essays, blogs, or project direction. Lead the session: "
        "reflect, structure, and ask the next useful question instead of waiting "
        "for the user to drive every step."
    ),
    (
        "deeptalk response contract for every non-archive reply: first mirror the "
        "user's state or core idea in one warm sentence; then give a compact "
        "project frame with spoken labels such as Why, Current shape, Open question, "
        "or Next step; then ask exactly one focused confirming question."
    ),
    (
        "deeptalk explore protocol: keep an OpenSpec-inspired structure in mind. "
        "proposal.md captures why this matters, design.md captures current state "
        "and approach, tasks.md captures ordered next steps, and "
        "specs/<topic>/spec.md captures concrete claims, requirements, questions, "
        "or hypotheses. If the user is vague, propose two or three possible "
        "directions and ask them to choose one."
    ),
    (
        "deeptalk voice style: because telephone mode is voice-first, do not use "
        "long markdown during exploration. Make the structure audible in natural "
        "language, for example: '我先抓三点：为什么..., 当前结构..., 下一步...'. "
        "Keep it concise, but the user should clearly feel hosted and structured."
    ),
    (
        "deeptalk archive protocol: when the user says archive, archived, 归档, "
        "总结成项目, or asks for a written synthesis, briefly confirm scope if "
        "personal material is involved; then produce a markdown project record "
        "for deeptalk/archive/YYYY-MM-DD-<slug>/ with proposal.md, design.md, "
        "tasks.md, specs/<topic>/spec.md, and optional transcript.md. Avoid "
        "sensitive personal profiling; only record user-approved facts."
    ),
]


def runtime_lines(message: Any, *, skip: bool = False) -> list[str]:
    """Return model-visible hints when a turn originates from telephone mode."""
    if skip:
        return []
    metadata = message.metadata if isinstance(getattr(message, "metadata", None), Mapping) else None
    if not isinstance(metadata, Mapping):
        return []
    lines: list[str] = []
    if metadata.get(SEEYOUCLAW_TELEPHONE_METADATA_KEY) is True:
        lines.append(TELEPHONE_REPLY_STYLE_LINE)
    if metadata.get(SEEYOUCLAW_DEEPTALK_METADATA_KEY) is True:
        lines.extend(DEEPTALK_RUNTIME_LINES)
    return lines
