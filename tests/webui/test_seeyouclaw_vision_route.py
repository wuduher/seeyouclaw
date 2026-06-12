from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

from nanobot.providers.base import LLMResponse
from nanobot.webui import seeyouclaw_vision_route as router


class FakeProvider:
    def __init__(self, content: str):
        self.content = content
        self.kwargs = None

    async def chat_with_retry(self, **kwargs):
        self.kwargs = kwargs
        return LLMResponse(content=self.content)


def test_llm_router_parses_visible_attribute_slot(monkeypatch):
    provider = FakeProvider(
        json.dumps(
            {
                "ok": True,
                "needVision": True,
                "route": "vision_snapshot",
                "intent": "visual_attribute",
                "reason": "The user asks for the current visible chair color.",
                "confidence": 0.91,
                "emotionEscalation": "low",
                "slot": {
                    "kind": "scene",
                    "subject": "chair",
                    "attribute": "color",
                    "questionType": "attribute",
                },
                "bypassCooldown": False,
            }
        )
    )

    def fake_snapshot_loader(*, preset_name=None):
        if preset_name in {"seeyouclaw-router", "deepseek-v4-flash"}:
            raise ValueError("missing preset")
        return SimpleNamespace(provider=provider, model="deepseek-v4-flash")

    monkeypatch.setattr(router, "load_provider_snapshot", fake_snapshot_loader)

    result = asyncio.run(
        router.route_seeyouclaw_vision(
            {
                "text": "\u6211\u7684\u6905\u5b50\u662f\u4ec0\u4e48\u989c\u8272\u7684",
                "cameraEnabled": True,
                "cooldownActive": False,
                "attachedImageCount": 0,
                "maxImagesPerTurn": 4,
                "context": None,
            }
        )
    )

    assert result["ok"] is True
    assert result["needVision"] is True
    assert result["route"] == "vision_snapshot"
    assert result["intent"] == "visual_attribute"
    assert result["slot"] == {
        "kind": "scene",
        "subject": "chair",
        "attribute": "color",
        "questionType": "attribute",
    }
    assert result["model"] == "deepseek-v4-flash"
    assert provider.kwargs["max_tokens"] == router.ROUTER_MAX_TOKENS
    assert provider.kwargs["temperature"] == 0.0


def test_llm_router_falls_back_on_malformed_response(monkeypatch):
    provider = FakeProvider("not-json")

    def fake_snapshot_loader(*, preset_name=None):
        return SimpleNamespace(provider=provider, model="deepseek-v4-flash")

    monkeypatch.setattr(router, "load_provider_snapshot", fake_snapshot_loader)

    result = asyncio.run(
        router.route_seeyouclaw_vision(
            {
                "text": "look at this",
                "cameraEnabled": True,
                "cooldownActive": False,
                "attachedImageCount": 0,
                "maxImagesPerTurn": 4,
                "context": None,
            }
        )
    )

    assert result == {
        "ok": False,
        "needVision": False,
        "route": "audio_only",
        "intent": "router_unavailable",
        "reason": "router classification failed",
        "confidence": 0.0,
        "emotionEscalation": "low",
        "slot": None,
        "bypassCooldown": False,
    }
