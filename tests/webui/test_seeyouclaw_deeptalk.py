from __future__ import annotations

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

from nanobot.providers.base import LLMResponse
from nanobot.webui import seeyouclaw_deeptalk_updater as updater
from nanobot.webui.seeyouclaw_deeptalk import (
    archive_deeptalk_project,
    ensure_deeptalk_project,
    read_deeptalk_project,
    update_deeptalk_project,
)


def _run_update(tmp_path: Path, payload: dict) -> dict:
    return asyncio.run(update_deeptalk_project(tmp_path, payload))


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
    assert project["summary"]["lane"] == "mixed"
    assert (project_dir / "proposal.md").exists()
    assert (project_dir / "design.md").exists()
    assert (project_dir / "tasks.md").exists()
    assert (project_dir / "specs" / "main" / "spec.md").exists()
    assert (project_dir / "notes.md").read_text(encoding="utf-8") == "# Notes\n"
    design = (project_dir / "design.md").read_text(encoding="utf-8")
    assert "DeepTalk Runtime" not in design
    spec = (project_dir / "specs" / "main" / "spec.md").read_text(encoding="utf-8")
    assert "Preserve DeepTalk continuity" not in spec


def test_deeptalk_project_reuses_existing_chat(tmp_path: Path) -> None:
    first = ensure_deeptalk_project(tmp_path, {"chatId": "chat-1", "title": "DeepTalk"})
    second = ensure_deeptalk_project(tmp_path, {"chatId": "chat-1", "title": "Other"})

    assert second["project"]["id"] == first["project"]["id"]
    assert second["project"]["title"] == "DeepTalk"


def test_deeptalk_project_updates_summary_and_notes(tmp_path: Path) -> None:
    created = ensure_deeptalk_project(tmp_path, {"chatId": "chat-1", "title": "DeepTalk"})
    project_id = created["project"]["id"]

    updated = _run_update(
        tmp_path,
        {
            "assistantText": "What outcome would make this worth archiving?",
            "projectId": project_id,
            "skipLlm": True,
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
    assert any("Frame" in item for item in project["summary"]["guidance_moves"])
    notes = (project_dir / "notes.md").read_text(encoding="utf-8")
    assert "## Turn 1 - User" in notes
    assert "## Turn 1 - Assistant" in notes


def test_deeptalk_project_tracks_observation_and_hook_signals(tmp_path: Path) -> None:
    created = ensure_deeptalk_project(tmp_path, {"chatId": "chat-1", "title": "DeepTalk"})
    project_id = created["project"]["id"]

    updated = _run_update(
        tmp_path,
        {
            "hookText": "Long pause; revisit stale open question before archive.",
            "observationText": "Video window: the user looks confused across several frames.",
            "projectId": project_id,
            "skipLlm": True,
        },
    )

    project = updated["project"]
    project_dir = tmp_path / project["path"]
    assert any("Observation-window signal" in item for item in project["summary"]["proactive_signals"])
    assert any("Hook signal" in item for item in project["summary"]["proactive_signals"])
    assert any("Observation window" in item for item in project["summary"]["guidance_moves"])
    assert any("Checkpoint" in item for item in project["summary"]["guidance_moves"])
    assert any("visual window" in item for item in project["summary"]["open_questions"])
    notes = (project_dir / "notes.md").read_text(encoding="utf-8")
    assert "## Turn 1 - Observation" in notes
    assert "## Turn 1 - Hook" in notes


def test_deeptalk_project_records_spoken_guidance_moves(tmp_path: Path) -> None:
    created = ensure_deeptalk_project(tmp_path, {"chatId": "chat-1", "title": "DeepTalk"})
    project_id = created["project"]["id"]

    updated = _run_update(
        tmp_path,
        {
            "projectId": project_id,
            "skipLlm": True,
            "userText": (
                "I am not sure where this is going; maybe it is an essay, "
                "maybe a project, and I feel overwhelmed."
            ),
        },
    )

    project = updated["project"]
    moves = project["summary"]["guidance_moves"]
    assert any("Mirror" in item for item in moves)
    assert any("Frame" in item for item in moves)
    assert any("Offer lanes" in item for item in moves)
    assert "Spoken Guidance Moves" in project["files"]["proposal"]


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
        updated = _run_update(
            tmp_path,
            {"projectId": project_id, "skipLlm": True, "userText": scenario["text"]},
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
        assert "Themes and Trade-offs" in files["design"]
        assert scenario["text"] in files["notes"]


def test_deeptalk_project_llm_update_synthesizes_artifacts(tmp_path: Path, monkeypatch) -> None:
    llm_payload = json.dumps(
        {
            "lane": "emotional_reflection",
            "why": "The user wants emotional support around an ex-partner and stalled life momentum.",
            "current": "They feel uncertain about internships, sleep, and whether to keep holding the past.",
            "open_questions": [
                "What feels hardest when you think about your ex right now?",
            ],
            "tasks": [
                "Name one feeling that keeps returning this week.",
            ],
            "proactive_signals": [
                "Empathy before structure.",
            ],
            "guidance_moves": [
                "Mirror the loneliness before asking about next steps.",
            ],
            "design_notes": "Themes: breakup residue, internship anxiety, disrupted routine.",
            "spec_body": (
                "### Requirement: Hold emotional reflection without forcing a project frame\n\n"
                "The host SHOULD help the user name feelings before proposing structure."
            ),
        }
    )
    provider = SimpleNamespace(
        kwargs=None,
        model="deepseek-v4-flash",
    )

    async def fake_chat_with_retry(**kwargs):
        provider.kwargs = kwargs
        return LLMResponse(content=llm_payload)

    provider.chat_with_retry = fake_chat_with_retry

    def fake_snapshot_loader(*, preset_name=None):
        if preset_name in {"seeyouclaw-router", "deepseek-v4-flash"}:
            raise ValueError("missing preset")
        return SimpleNamespace(provider=provider, model="deepseek-v4-flash")

    monkeypatch.setattr(updater, "load_provider_snapshot", fake_snapshot_loader)

    created = ensure_deeptalk_project(tmp_path, {"chatId": "chat-llm", "title": "Emotional Talk"})
    project_id = created["project"]["id"]
    updated = _run_update(
        tmp_path,
        {
            "projectId": project_id,
            "userText": "I am single but still miss my ex and my internship search is going badly.",
            "assistantText": "I hear the mix of longing and pressure. What feels most stuck right now?",
        },
    )

    summary = updated["project"]["summary"]
    assert summary["lane"] == "emotional_reflection"
    assert "emotional support" in summary["why"]
    assert "internship" in summary["current"]
    assert any("ex" in item.lower() for item in summary["open_questions"])
    assert "Themes:" in summary["design_notes"]
    assert "emotional reflection" in summary["spec_body"].lower()
    files = updated["project"]["files"]
    assert "Preserve DeepTalk continuity" not in files["spec"]
    assert "Themes and Trade-offs" in files["design"]
    assert provider.kwargs["max_tokens"] == updater.UPDATER_MAX_TOKENS


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
