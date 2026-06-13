from __future__ import annotations

from types import SimpleNamespace

from nanobot.webui import seeyouclaw_mode


def test_telephone_runtime_line_when_metadata_flag_set() -> None:
    message = SimpleNamespace(metadata={"seeyouclaw_telephone": True})
    lines = seeyouclaw_mode.runtime_lines(message)
    assert len(lines) == 1
    assert "telephone mode" in lines[0].lower()
    assert "markdown" in lines[0].lower()


def test_deeptalk_runtime_lines_when_metadata_flag_set() -> None:
    message = SimpleNamespace(metadata={"seeyouclaw_deeptalk": True})
    lines = seeyouclaw_mode.runtime_lines(message)
    assert len(lines) >= 5
    assert "deeptalk mode" in lines[0].lower()
    assert "response contract" in " ".join(lines).lower()
    assert "exactly one focused" in " ".join(lines).lower()
    assert "proposal.md" in " ".join(lines)
    assert "proactivity has three sources" in " ".join(lines).lower()
    assert "observation window" in " ".join(lines).lower()
    assert "archive" in " ".join(lines).lower()


def test_telephone_and_deeptalk_runtime_lines_can_stack() -> None:
    message = SimpleNamespace(metadata={
        "seeyouclaw_telephone": True,
        "seeyouclaw_deeptalk": True,
    })
    lines = seeyouclaw_mode.runtime_lines(message)
    assert len(lines) >= 5
    assert "telephone mode" in lines[0].lower()
    assert any("deeptalk explore protocol" in line.lower() for line in lines)


def test_telephone_runtime_line_skipped_without_flag() -> None:
    message = SimpleNamespace(metadata={"webui": True})
    assert seeyouclaw_mode.runtime_lines(message) == []


def test_telephone_runtime_line_respects_skip() -> None:
    message = SimpleNamespace(metadata={"seeyouclaw_telephone": True})
    assert seeyouclaw_mode.runtime_lines(message, skip=True) == []
