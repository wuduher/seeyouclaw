from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest

from nanobot.webui import seeyouclaw_telephone as telephone


def test_extract_audio_chunk_from_dashscope_delta() -> None:
    payload = {
        "choices": [
            {
                "delta": {
                    "audio": {
                        "data": "UklGRg==",
                        "transcript": "你好",
                    }
                }
            }
        ]
    }

    assert telephone._extract_audio_chunk(payload) == "UklGRg=="


def test_telephone_request_body_uses_streaming_audio_modalities() -> None:
    body = telephone._telephone_request_body(
        "你好",
        model="qwen3-omni-flash",
        voice="Ethan",
        audio_format="wav",
    )

    assert body["model"] == "qwen3-omni-flash"
    assert body["modalities"] == ["text", "audio"]
    assert body["audio"] == {"voice": "Ethan", "format": "wav"}
    assert body["stream"] is True
    assert body["stream_options"] == {"include_usage": True}


def test_synthesize_telephone_speech_falls_back_without_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        telephone,
        "load_config",
        lambda: SimpleNamespace(
            providers=SimpleNamespace(
                dashscope=SimpleNamespace(api_key=None, api_base=None)
            )
        ),
    )
    monkeypatch.setattr(telephone, "resolve_config_env_vars", lambda config: config)

    result = asyncio.run(telephone.synthesize_telephone_speech({"text": "hello"}))

    assert result["ok"] is False
    assert result["reason"] == "speech provider not configured"


def test_extract_audio_chunk_ignores_usage_only_event() -> None:
    payload = {"choices": [], "usage": {"total_tokens": 10}}

    assert telephone._extract_audio_chunk(payload) is None


def test_extract_audio_chunk_accepts_top_level_audio() -> None:
    payload = json.loads('{"audio": {"data": "QUJD"}}')

    assert telephone._extract_audio_chunk(payload) == "QUJD"
