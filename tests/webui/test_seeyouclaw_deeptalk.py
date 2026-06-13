from __future__ import annotations

from pathlib import Path

from nanobot.webui.seeyouclaw_deeptalk import (
    archive_deeptalk_project,
    ensure_deeptalk_project,
    read_deeptalk_project,
    update_deeptalk_project,
)


def test_deeptalk_project_creation_writes_openspec_shape(tmp_path: Path) -> None:
    result = ensure_deeptalk_project(
        tmp_path,
        {
            "chatId": "chat-1",
            "seedText": "Explore a low-cost multimodal routing idea.",
            "title": "Routing Research",
        },
    )

    project = result["project"]
    project_dir = tmp_path / project["path"]
    assert result["ok"] is True
    assert project["chatId"] == "chat-1"
    assert project["summary"]["why"] == "Explore a low-cost multimodal routing idea."
    assert (project_dir / "proposal.md").exists()
    assert (project_dir / "design.md").exists()
    assert (project_dir / "tasks.md").exists()
    assert (project_dir / "specs" / "main" / "spec.md").exists()
    assert (project_dir / "notes.md").read_text(encoding="utf-8") == "# Notes\n"


def test_deeptalk_project_reuses_existing_chat(tmp_path: Path) -> None:
    first = ensure_deeptalk_project(tmp_path, {"chatId": "chat-1", "title": "DeepTalk"})
    second = ensure_deeptalk_project(tmp_path, {"chatId": "chat-1", "title": "Other"})

    assert second["project"]["id"] == first["project"]["id"]
    assert second["project"]["title"] == "DeepTalk"


def test_deeptalk_project_updates_summary_and_notes(tmp_path: Path) -> None:
    created = ensure_deeptalk_project(tmp_path, {"chatId": "chat-1", "title": "DeepTalk"})
    project_id = created["project"]["id"]

    updated = update_deeptalk_project(
        tmp_path,
        {
            "assistantText": "What outcome would make this worth archiving?",
            "projectId": project_id,
            "userText": "How should we design a project-like research discussion?",
        },
    )

    project = updated["project"]
    project_dir = tmp_path / project["path"]
    assert project["turnCount"] == 1
    assert "How should we design" in project["summary"]["current"]
    assert any("How should we design" in item for item in project["summary"]["open_questions"])
    assert any("concrete design option" in item for item in project["summary"]["tasks"])
    notes = (project_dir / "notes.md").read_text(encoding="utf-8")
    assert "## Turn 1 - User" in notes
    assert "## Turn 1 - Assistant" in notes


def test_deeptalk_project_archive_creates_snapshot(tmp_path: Path) -> None:
    created = ensure_deeptalk_project(tmp_path, {"chatId": "chat-1", "title": "DeepTalk"})
    project_id = created["project"]["id"]
    archive = archive_deeptalk_project(tmp_path, {"projectId": project_id})

    archive_dir = tmp_path / archive["archivePath"]
    assert archive["ok"] is True
    assert archive["project"]["archiveCount"] == 1
    assert (archive_dir / "proposal.md").exists()
    assert (archive_dir / "specs" / "main" / "spec.md").exists()


def test_deeptalk_project_read_by_chat(tmp_path: Path) -> None:
    created = ensure_deeptalk_project(tmp_path, {"chatId": "chat-1", "title": "DeepTalk"})
    fetched = read_deeptalk_project(tmp_path, {"chatId": "chat-1"})

    assert fetched["project"]["id"] == created["project"]["id"]
