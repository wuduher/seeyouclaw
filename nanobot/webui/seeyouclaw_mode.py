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
        "seeyouclaw deeptalk mode: Act as a proactive host for an in-depth "
        "conversation about emotions, research ideas, essays, or project direction. "
        "Warmly reflect the user's current state, name useful themes, and guide the "
        "conversation forward instead of only answering the latest sentence."
    ),
    (
        "deeptalk explore protocol: keep a lightweight project frame in mind: "
        "proposal.md captures why this matters, design.md captures current state and "
        "approach, tasks.md captures ordered next steps, and specs/<topic>/spec.md "
        "captures concrete claims, requirements, questions, or hypotheses."
    ),
    (
        "deeptalk interaction style: ask one focused confirming question at a time, "
        "surface assumptions and open questions, and periodically summarize the "
        "evolving structure. Keep spoken replies concise unless the user explicitly "
        "asks for a written archive or long-form synthesis."
    ),
    (
        "deeptalk archive protocol: when the user asks to archive, first confirm the "
        "scope briefly, then produce an OpenSpec-inspired date folder suggestion "
        "deeptalk/archive/YYYY-MM-DD-<slug>/ with proposal.md, design.md, tasks.md, "
        "specs/<topic>/spec.md, and a transcript or notes file. Avoid sensitive "
        "personal profiling; only record user-approved facts."
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
