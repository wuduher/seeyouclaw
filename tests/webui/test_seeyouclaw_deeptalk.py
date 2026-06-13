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
    assert any("SDD questions" in item for item in project["summary"]["proactive_signals"])
    assert any("Multimodal observation window" in item for item in project["summary"]["proactive_signals"])
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
    assert any("SDD signal" in item for item in project["summary"]["proactive_signals"])
    notes = (project_dir / "notes.md").read_text(encoding="utf-8")
    assert "## Turn 1 - User" in notes
    assert "## Turn 1 - Assistant" in notes


def test_deeptalk_project_tracks_observation_and_hook_signals(tmp_path: Path) -> None:
    created = ensure_deeptalk_project(tmp_path, {"chatId": "chat-1", "title": "DeepTalk"})
    project_id = created["project"]["id"]

    updated = update_deeptalk_project(
        tmp_path,
        {
            "hookText": "Long pause; revisit stale open question before archive.",
            "observationText": "Video window: the user looks confused across several frames.",
            "projectId": project_id,
        },
    )

    project = updated["project"]
    project_dir = tmp_path / project["path"]
    assert any("Observation-window signal" in item for item in project["summary"]["proactive_signals"])
    assert any("Hook signal" in item for item in project["summary"]["proactive_signals"])
    assert any("visual window" in item for item in project["summary"]["open_questions"])
    notes = (project_dir / "notes.md").read_text(encoding="utf-8")
    assert "## Turn 1 - Observation" in notes
    assert "## Turn 1 - Hook" in notes
    spec = (project_dir / "specs" / "main" / "spec.md").read_text(encoding="utf-8")
    assert "observation window" in spec


def test_deeptalk_project_covers_acceptance_scenarios(tmp_path: Path) -> None:
    scenarios = [
        {
            "chatId": "emotional-chat",
            "text": (
                "I feel overwhelmed and uncertain about this relationship. "
                "I do not need research yet; I need help naming what feels hard."
            ),
            "expected_signal": "Empathy signal",
            "expected_question": "felt difficulty",
            "expected_task": None,
        },
        {
            "chatId": "research-chat",
            "text": (
                "I have a research idea about multimodal routing. Before choosing "
                "a design, we may need literature, papers, benchmarks, and sources."
            ),
            "expected_signal": "Deepresearch gate",
            "expected_question": "external evidence",
            "expected_task": "focused research subagent",
        },
        {
            "chatId": "blog-chat",
            "text": (
                "I want to turn this long conversation into a blog essay or article "
                "with a clear why, argument, current shape, and next section."
            ),
            "expected_signal": "SDD signal",
            "expected_question": "Which artifact",
            "expected_task": "Name the core question",
        },
    ]

    for scenario in scenarios:
        created = ensure_deeptalk_project(
            tmp_path,
            {"chatId": scenario["chatId"], "title": "Scenario DeepTalk"},
        )
        project_id = created["project"]["id"]
        updated = update_deeptalk_project(
            tmp_path,
            {"projectId": project_id, "userText": scenario["text"]},
        )

        summary = updated["project"]["summary"]
        assert any(
            scenario["expected_signal"] in item
            for item in summary["proactive_signals"]
        ), scenario["chatId"]
        assert any(
            scenario["expected_question"] in item
            for item in summary["open_questions"]
        ), scenario["chatId"]
        if scenario["expected_task"] is not None:
            assert any(
                scenario["expected_task"] in item
                for item in summary["tasks"]
            ), scenario["chatId"]

        files = updated["project"]["files"]
        assert "OpenSpec-style state" in files["design"]
        assert "Subagent and DeepResearch Gate" in files["design"]
        assert scenario["text"] in files["notes"]


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
