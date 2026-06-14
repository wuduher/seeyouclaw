from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

from nanobot.providers.base import LLMResponse
from nanobot.webui import seeyouclaw_deeptalk_updater as updater


class FakeProvider:
    def __init__(self, content: str):
        self.content = content
        self.kwargs = None

    async def chat_with_retry(self, **kwargs):
        self.kwargs = kwargs
        return LLMResponse(content=self.content)


def test_llm_updater_synthesizes_emotional_lane(monkeypatch):
    provider = FakeProvider(
        json.dumps(
            {
                "lane": "emotional_reflection",
                "why": "The user wants to process lingering feelings about an ex.",
                "current": "They feel lost about internships and daily rhythm.",
                "open_questions": ["What part of the breakup still feels unresolved?"],
                "tasks": ["Name one feeling that keeps returning."],
                "proactive_signals": ["Lead with empathy."],
                "guidance_moves": ["Mirror before framing."],
                "design_notes": "Themes: ex, internship stress.",
                "spec_body": "### Requirement: Emotional hosting\n\nStay with feelings first.",
            }
        )
    )

    def fake_snapshot_loader(*, preset_name=None):
        if preset_name in {"seeyouclaw-router", "deepseek-v4-flash"}:
            raise ValueError("missing preset")
        return SimpleNamespace(provider=provider, model="deepseek-v4-flash")

    monkeypatch.setattr(updater, "load_provider_snapshot", fake_snapshot_loader)

    result = asyncio.run(
        updater.llm_synthesize_deeptalk_update(
            {
                "title": "Talk",
                "turnCount": 2,
                "summary": {"why": "", "current": "", "open_questions": [], "tasks": []},
                "notesExcerpt": "## Turn 1 - User\n\nI still miss my ex.",
                "userText": "I still miss my ex and my internship search is hard.",
                "assistantText": "That sounds heavy.",
            }
        )
    )

    assert result is not None
    assert result["lane"] == "emotional_reflection"
    assert "ex" in result["why"]
    assert "internship" in result["current"]
    assert result["design_notes"].startswith("Themes:")
    assert "Emotional hosting" in result["spec_body"]
    assert provider.kwargs["temperature"] == 0.2
