"""Runtime prompt hints for seeyouclaw WebUI interaction modes."""

from __future__ import annotations

from typing import Any, Mapping

SEEYOUCLAW_TELEPHONE_METADATA_KEY = "seeyouclaw_telephone"

TELEPHONE_REPLY_STYLE_LINE = (
    "seeyouclaw telephone mode: Reply for spoken playback in a live video call. "
    "Use concise, conversational language (usually 1-3 short sentences). "
    "Avoid markdown, bullet lists, code blocks, and long written-style paragraphs. "
    "Match the user's language."
)


def runtime_lines(message: Any, *, skip: bool = False) -> list[str]:
    """Return model-visible hints when a turn originates from telephone mode."""
    if skip:
        return []
    metadata = message.metadata if isinstance(getattr(message, "metadata", None), Mapping) else None
    if not isinstance(metadata, Mapping):
        return []
    if metadata.get(SEEYOUCLAW_TELEPHONE_METADATA_KEY) is True:
        return [TELEPHONE_REPLY_STYLE_LINE]
    return []
