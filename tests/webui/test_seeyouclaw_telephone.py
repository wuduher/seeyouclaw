from __future__ import annotations

import asyncio
import base64
import io
import json
from types import SimpleNamespace
import wave

import pytest

from nanobot.webui import seeyouclaw_telephone as telephone


def _clear_doubao_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (
        *telephone._DOUBAO_API_KEY_ENV_NAMES,
        *telephone._DOUBAO_APP_ID_ENV_NAMES,
        *telephone._DOUBAO_ACCESS_KEY_ENV_NAMES,
        "DOUBAO_TTS_ENDPOINT",
        "DOUBAO_TTS_FORMAT",
        "DOUBAO_TTS_RESOURCE_ID",
        "DOUBAO_TTS_VOICE",
        "VOLCENGINE_TTS_ENDPOINT",
        "VOLCENGINE_TTS_FORMAT",
        "VOLCENGINE_TTS_RESOURCE_ID",
        "VOLCENGINE_TTS_VOICE",
    ):
        monkeypatch.delenv(name, raising=False)


class _FakeDoubaoWebSocket:
    def __init__(self) -> None:
        self.closed = False
        self.sent: list[bytes] = []
        self._incoming = [
            telephone._doubao_pack_message(
                connect_id="conn",
                event=telephone._DOUBAO_EVENT_CONNECTION_STARTED,
                msg_type=telephone._DOUBAO_MSG_FULL_SERVER_RESPONSE,
                payload=b"{}",
            ),
            telephone._doubao_pack_message(
                event=telephone._DOUBAO_EVENT_SESSION_STARTED,
                msg_type=telephone._DOUBAO_MSG_FULL_SERVER_RESPONSE,
                payload=b"{}",
                session_id="session",
            ),
            telephone._doubao_pack_message(
                event=352,
                msg_type=telephone._DOUBAO_MSG_AUDIO_ONLY_SERVER,
                payload=b"mp3-audio",
                serialization=telephone._DOUBAO_SERIALIZATION_RAW,
                session_id="session",
            ),
            telephone._doubao_pack_message(
                event=telephone._DOUBAO_EVENT_SESSION_FINISHED,
                msg_type=telephone._DOUBAO_MSG_FULL_SERVER_RESPONSE,
                payload=b'{"status_code":20000000,"message":"ok"}',
                session_id="session",
            ),
            telephone._doubao_pack_message(
                connect_id="conn",
                event=telephone._DOUBAO_EVENT_CONNECTION_FINISHED,
                msg_type=telephone._DOUBAO_MSG_FULL_SERVER_RESPONSE,
                payload=b"{}",
            ),
        ]

    async def close(self) -> None:
        self.closed = True

    async def recv(self) -> bytes:
        return self._incoming.pop(0)

    async def send(self, data: bytes) -> None:
        self.sent.append(data)


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
    assert body["enable_thinking"] is False


def test_audio_response_payload_wraps_pcm_as_wav() -> None:
    pcm = b"\x00\x00\x01\x00\xff\xff"
    data_url, mime_type = telephone._audio_response_payload(
        base64.b64encode(pcm).decode("ascii"),
        audio_format="wav",
    )

    assert mime_type == "audio/wav"
    assert data_url.startswith("data:audio/wav;base64,")
    wav_bytes = base64.b64decode(data_url.split(",", 1)[1])
    assert wav_bytes.startswith(b"RIFF")
    with wave.open(io.BytesIO(wav_bytes), "rb") as wav:
        assert wav.getnchannels() == 1
        assert wav.getframerate() == 24_000
        assert wav.getsampwidth() == 2
        assert wav.readframes(wav.getnframes()) == pcm


def test_synthesize_telephone_speech_falls_back_without_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _clear_doubao_env(monkeypatch)
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


def test_doubao_message_roundtrip_with_audio_payload() -> None:
    frame = telephone._doubao_pack_message(
        event=352,
        msg_type=telephone._DOUBAO_MSG_AUDIO_ONLY_SERVER,
        payload=b"audio",
        serialization=telephone._DOUBAO_SERIALIZATION_RAW,
        session_id="session-1",
    )

    message = telephone._doubao_unpack_message(frame)

    assert message.type == telephone._DOUBAO_MSG_AUDIO_ONLY_SERVER
    assert message.event == 352
    assert message.session_id == "session-1"
    assert message.payload == b"audio"


def test_synthesize_telephone_speech_prefers_doubao_when_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _clear_doubao_env(monkeypatch)
    fake_websocket = _FakeDoubaoWebSocket()

    async def fake_connect(endpoint: str, headers: dict[str, str]) -> _FakeDoubaoWebSocket:
        assert endpoint == telephone.DEFAULT_DOUBAO_TTS_ENDPOINT
        assert headers["X-Api-Key"] == "doubao-test-key"
        assert headers["X-Api-Resource-Id"] == telephone.DEFAULT_DOUBAO_TTS_RESOURCE_ID
        return fake_websocket

    monkeypatch.setenv("DOUBAO_TTS_API_KEY", "doubao-test-key")
    monkeypatch.setattr(telephone, "_doubao_connect_websocket", fake_connect)

    result = asyncio.run(telephone.synthesize_telephone_speech({"text": "hello"}))

    assert result["ok"] is True
    assert result["provider"] == "doubao"
    assert result["mimeType"] == "audio/mpeg"
    assert base64.b64decode(result["audioDataUrl"].split(",", 1)[1]) == b"mp3-audio"
    sent_events = [
        telephone._doubao_unpack_message(frame).event for frame in fake_websocket.sent
    ]
    assert telephone._DOUBAO_EVENT_TASK_REQUEST in sent_events
    assert fake_websocket.closed is True


def test_extract_audio_chunk_ignores_usage_only_event() -> None:
    payload = {"choices": [], "usage": {"total_tokens": 10}}

    assert telephone._extract_audio_chunk(payload) is None


def test_extract_audio_chunk_accepts_top_level_audio() -> None:
    payload = json.loads('{"audio": {"data": "QUJD"}}')

    assert telephone._extract_audio_chunk(payload) == "QUJD"
