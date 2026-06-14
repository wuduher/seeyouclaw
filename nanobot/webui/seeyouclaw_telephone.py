"""Telephone-mode speech synthesis helpers for seeyouclaw WebUI."""

from __future__ import annotations

import asyncio
import base64
import binascii
import io
import json
import os
import re
import struct
import uuid
import wave
from dataclasses import dataclass
from typing import Any

import httpx
import websockets
from loguru import logger

from nanobot.config.loader import load_config, resolve_config_env_vars

DEFAULT_DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DEFAULT_TELEPHONE_MODEL = "qwen3-omni-flash"
DEFAULT_TELEPHONE_VOICE = "Ethan"
DEFAULT_TELEPHONE_FORMAT = "wav"
TELEPHONE_AUDIO_CHANNELS = 1
TELEPHONE_AUDIO_SAMPLE_RATE = 24_000
TELEPHONE_AUDIO_SAMPLE_WIDTH_BYTES = 2
DEFAULT_DOUBAO_TTS_ENDPOINT = "wss://openspeech.bytedance.com/api/v3/tts/bidirection"
DEFAULT_DOUBAO_TTS_RESOURCE_ID = "seed-tts-2.0"
DEFAULT_DOUBAO_TTS_LEGACY_RESOURCE_ID = "volc.service_type.10029"
DEFAULT_DOUBAO_TTS_VOICE = "zh_female_xiaohe_uranus_bigtts"
DEFAULT_DOUBAO_TTS_FORMAT = "mp3"
DEFAULT_DOUBAO_TTS_CHUNK_CHARS = 12
DEFAULT_DOUBAO_TTS_CHUNK_DELAY_SECONDS = 0.005
DOUBAO_TTS_TIMEOUT_SECONDS = 45.0

_DOUBAO_MSG_FULL_CLIENT_REQUEST = 0b0001
_DOUBAO_MSG_AUDIO_ONLY_SERVER = 0b1011
_DOUBAO_MSG_FULL_SERVER_RESPONSE = 0b1001
_DOUBAO_MSG_ERROR = 0b1111
_DOUBAO_FLAG_WITH_EVENT = 0b0100
_DOUBAO_SERIALIZATION_RAW = 0b0000
_DOUBAO_SERIALIZATION_JSON = 0b0001
_DOUBAO_EVENT_START_CONNECTION = 1
_DOUBAO_EVENT_FINISH_CONNECTION = 2
_DOUBAO_EVENT_CONNECTION_STARTED = 50
_DOUBAO_EVENT_CONNECTION_FAILED = 51
_DOUBAO_EVENT_CONNECTION_FINISHED = 52
_DOUBAO_EVENT_START_SESSION = 100
_DOUBAO_EVENT_FINISH_SESSION = 102
_DOUBAO_EVENT_SESSION_STARTED = 150
_DOUBAO_EVENT_SESSION_FINISHED = 152
_DOUBAO_EVENT_SESSION_FAILED = 153
_DOUBAO_EVENT_TASK_REQUEST = 200
_DOUBAO_CONNECTION_EVENTS = {
    _DOUBAO_EVENT_START_CONNECTION,
    _DOUBAO_EVENT_FINISH_CONNECTION,
    _DOUBAO_EVENT_CONNECTION_STARTED,
    _DOUBAO_EVENT_CONNECTION_FAILED,
    _DOUBAO_EVENT_CONNECTION_FINISHED,
}
_DOUBAO_API_KEY_ENV_NAMES = (
    "DOUBAO_TTS_API_KEY",
    "VOLCENGINE_TTS_API_KEY",
    "BYTEDANCE_TTS_API_KEY",
)
_DOUBAO_APP_ID_ENV_NAMES = (
    "DOUBAO_TTS_APP_ID",
    "DOUBAO_TTS_APP_KEY",
    "VOLCENGINE_TTS_APP_ID",
    "VOLCENGINE_TTS_APP_KEY",
)
_DOUBAO_ACCESS_KEY_ENV_NAMES = (
    "DOUBAO_TTS_ACCESS_KEY",
    "VOLCENGINE_TTS_ACCESS_KEY",
)


def _clean_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return re.sub(r"\s+", " ", value).strip()


def _clean_token(value: Any, *, default: str, allowed: set[str] | None = None) -> str:
    if not isinstance(value, str):
        return default
    cleaned = re.sub(r"[^A-Za-z0-9_-]", "", value).strip()
    if not cleaned:
        return default
    if allowed is not None and cleaned not in allowed:
        return default
    return cleaned


def _fallback_response(
    reason: str,
    *,
    model: str = DEFAULT_TELEPHONE_MODEL,
    voice: str = DEFAULT_TELEPHONE_VOICE,
    provider: str | None = None,
) -> dict[str, Any]:
    return {
        "ok": False,
        "audioDataUrl": None,
        "mimeType": None,
        "reason": reason,
        "model": model,
        "provider": provider,
        "voice": voice,
    }


def _first_env(*names: str) -> str:
    for name in names:
        value = os.environ.get(name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _env_int(name: str, *, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, ""))
    except ValueError:
        return default
    return max(minimum, min(maximum, value))


def _env_float(name: str, *, default: float, minimum: float, maximum: float) -> float:
    try:
        value = float(os.environ.get(name, ""))
    except ValueError:
        return default
    return max(minimum, min(maximum, value))


def _extract_audio_chunk(payload: dict[str, Any]) -> str | None:
    containers: list[Any] = []
    for choice in payload.get("choices") or []:
        if not isinstance(choice, dict):
            continue
        delta = choice.get("delta")
        if isinstance(delta, dict):
            containers.extend(
                [
                    delta.get("audio"),
                    delta.get("output_audio"),
                    delta.get("audio_data"),
                ]
            )
        containers.extend(
            [
                choice.get("audio"),
                choice.get("output_audio"),
                choice.get("audio_data"),
            ]
        )
    containers.extend(
        [
            payload.get("audio"),
            payload.get("output_audio"),
            payload.get("audio_data"),
        ]
    )

    for item in containers:
        if isinstance(item, str) and item.strip():
            return item.strip()
        if not isinstance(item, dict):
            continue
        for key in ("data", "audio", "content", "base64", "b64_json"):
            value = item.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


def _decode_audio_base64(value: str) -> bytes:
    cleaned = re.sub(r"\s+", "", value)
    if cleaned.startswith("data:") and "," in cleaned:
        cleaned = cleaned.split(",", 1)[1]
    cleaned += "=" * (-len(cleaned) % 4)
    return base64.b64decode(cleaned, validate=False)


def _wrap_pcm_as_wav(pcm_bytes: bytes) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(TELEPHONE_AUDIO_CHANNELS)
        wav.setsampwidth(TELEPHONE_AUDIO_SAMPLE_WIDTH_BYTES)
        wav.setframerate(TELEPHONE_AUDIO_SAMPLE_RATE)
        wav.writeframes(pcm_bytes)
    return output.getvalue()


def _audio_response_payload(audio_base64: str, *, audio_format: str) -> tuple[str, str]:
    audio_bytes = _decode_audio_base64(audio_base64)
    if audio_format == "wav":
        audio_bytes = _wrap_pcm_as_wav(audio_bytes)
        mime_type = "audio/wav"
    elif audio_format == "mp3":
        mime_type = "audio/mpeg"
    else:
        mime_type = "audio/pcm"
    encoded = base64.b64encode(audio_bytes).decode("ascii")
    return f"data:{mime_type};base64,{encoded}", mime_type


def _audio_bytes_data_url(audio_bytes: bytes, *, audio_format: str) -> tuple[str, str]:
    if audio_format == "pcm":
        audio_bytes = _wrap_pcm_as_wav(audio_bytes)
        mime_type = "audio/wav"
    elif audio_format == "ogg_opus":
        mime_type = "audio/ogg"
    elif audio_format == "wav":
        mime_type = "audio/wav"
    else:
        mime_type = "audio/mpeg"
    encoded = base64.b64encode(audio_bytes).decode("ascii")
    return f"data:{mime_type};base64,{encoded}", mime_type


def _telephone_request_body(
    text: str,
    *,
    model: str,
    voice: str,
    audio_format: str,
) -> dict[str, Any]:
    return {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a speech renderer for a video-call interface. "
                    "Speak the user's provided text naturally and do not add extra words."
                ),
            },
            {"role": "user", "content": text},
        ],
        "modalities": ["text", "audio"],
        "audio": {"voice": voice, "format": audio_format},
        "stream": True,
        "stream_options": {"include_usage": True},
        "enable_thinking": False,
    }


@dataclass(frozen=True)
class _DoubaoTTSConfig:
    access_key: str
    api_key: str
    app_id: str
    audio_format: str
    chunk_chars: int
    chunk_delay_seconds: float
    endpoint: str
    emotion: str
    emotion_scale: int | None
    legacy_resource_id: str
    resource_id: str
    sample_rate: int
    speech_rate: int | None
    voice: str

    @property
    def configured(self) -> bool:
        return bool(self.api_key or (self.app_id and self.access_key))

    @property
    def model_label(self) -> str:
        return self.resource_id if self.api_key else self.legacy_resource_id

    @property
    def headers(self) -> dict[str, str]:
        headers = {"X-Api-Connect-Id": str(uuid.uuid4())}
        if self.api_key:
            headers.update(
                {
                    "X-Api-Key": self.api_key,
                    "X-Api-Resource-Id": self.resource_id,
                }
            )
        else:
            headers.update(
                {
                    "X-Api-App-Key": self.app_id,
                    "X-Api-Access-Key": self.access_key,
                    "X-Api-Resource-Id": self.legacy_resource_id,
                }
            )
        return headers


@dataclass(frozen=True)
class _DoubaoMessage:
    connect_id: str
    error_code: int
    event: int
    flag: int
    payload: bytes
    session_id: str
    type: int


class _DoubaoTTSProtocolError(RuntimeError):
    pass


def _doubao_tts_config_from_env() -> _DoubaoTTSConfig:
    api_key = _first_env(*_DOUBAO_API_KEY_ENV_NAMES)
    app_id = _first_env(*_DOUBAO_APP_ID_ENV_NAMES)
    access_key = _first_env(*_DOUBAO_ACCESS_KEY_ENV_NAMES)
    return _DoubaoTTSConfig(
        access_key=access_key,
        api_key=api_key,
        app_id=app_id,
        audio_format=_clean_token(
            os.environ.get("DOUBAO_TTS_FORMAT") or os.environ.get("VOLCENGINE_TTS_FORMAT"),
            default=DEFAULT_DOUBAO_TTS_FORMAT,
            allowed={"mp3", "ogg_opus", "pcm"},
        ),
        chunk_chars=_env_int(
            "DOUBAO_TTS_CHUNK_CHARS",
            default=DEFAULT_DOUBAO_TTS_CHUNK_CHARS,
            minimum=1,
            maximum=80,
        ),
        chunk_delay_seconds=_env_float(
            "DOUBAO_TTS_CHUNK_DELAY_SECONDS",
            default=DEFAULT_DOUBAO_TTS_CHUNK_DELAY_SECONDS,
            minimum=0.0,
            maximum=0.25,
        ),
        emotion=_clean_token(
            os.environ.get("DOUBAO_TTS_EMOTION") or os.environ.get("VOLCENGINE_TTS_EMOTION"),
            default="",
        ),
        emotion_scale=(
            _env_int("DOUBAO_TTS_EMOTION_SCALE", default=4, minimum=1, maximum=5)
            if _first_env("DOUBAO_TTS_EMOTION_SCALE", "VOLCENGINE_TTS_EMOTION_SCALE")
            else None
        ),
        endpoint=(
            _first_env("DOUBAO_TTS_ENDPOINT", "VOLCENGINE_TTS_ENDPOINT")
            or DEFAULT_DOUBAO_TTS_ENDPOINT
        ),
        legacy_resource_id=(
            _first_env("DOUBAO_TTS_LEGACY_RESOURCE_ID", "VOLCENGINE_TTS_LEGACY_RESOURCE_ID")
            or DEFAULT_DOUBAO_TTS_LEGACY_RESOURCE_ID
        ),
        resource_id=(
            _first_env("DOUBAO_TTS_RESOURCE_ID", "VOLCENGINE_TTS_RESOURCE_ID")
            or DEFAULT_DOUBAO_TTS_RESOURCE_ID
        ),
        sample_rate=_env_int(
            "DOUBAO_TTS_SAMPLE_RATE",
            default=TELEPHONE_AUDIO_SAMPLE_RATE,
            minimum=8_000,
            maximum=48_000,
        ),
        speech_rate=(
            _env_int("DOUBAO_TTS_SPEECH_RATE", default=0, minimum=-50, maximum=100)
            if _first_env("DOUBAO_TTS_SPEECH_RATE", "VOLCENGINE_TTS_SPEECH_RATE")
            else None
        ),
        voice=(
            _first_env("DOUBAO_TTS_VOICE", "VOLCENGINE_TTS_VOICE")
            or DEFAULT_DOUBAO_TTS_VOICE
        ),
    )


def _doubao_pack_message(
    *,
    connect_id: str = "",
    event: int,
    msg_type: int,
    payload: bytes,
    serialization: int = _DOUBAO_SERIALIZATION_JSON,
    session_id: str = "",
) -> bytes:
    header = bytes(
        [
            0b0001_0001,
            (msg_type << 4) | _DOUBAO_FLAG_WITH_EVENT,
            serialization << 4,
            0,
        ]
    )
    parts = [header, struct.pack(">i", event)]
    if event not in _DOUBAO_CONNECTION_EVENTS:
        session_id_bytes = session_id.encode("utf-8")
        parts.append(struct.pack(">I", len(session_id_bytes)))
        parts.append(session_id_bytes)
    elif connect_id:
        connect_id_bytes = connect_id.encode("utf-8")
        parts.append(struct.pack(">I", len(connect_id_bytes)))
        parts.append(connect_id_bytes)
    parts.append(struct.pack(">I", len(payload)))
    parts.append(payload)
    return b"".join(parts)


def _doubao_unpack_message(data: bytes) -> _DoubaoMessage:
    if len(data) < 4:
        raise _DoubaoTTSProtocolError("doubao frame too short")
    header_size = (data[0] & 0b0000_1111) * 4
    if header_size < 4 or len(data) < header_size:
        raise _DoubaoTTSProtocolError("doubao frame has invalid header")

    msg_type = data[1] >> 4
    flag = data[1] & 0b0000_1111
    offset = header_size
    event = 0
    session_id = ""
    connect_id = ""
    error_code = 0

    if msg_type == _DOUBAO_MSG_ERROR:
        if len(data) < offset + 4:
            raise _DoubaoTTSProtocolError("doubao error frame missing code")
        error_code = struct.unpack(">I", data[offset : offset + 4])[0]
        offset += 4
    elif flag == _DOUBAO_FLAG_WITH_EVENT:
        if len(data) < offset + 4:
            raise _DoubaoTTSProtocolError("doubao frame missing event")
        event = struct.unpack(">i", data[offset : offset + 4])[0]
        offset += 4
        if event not in _DOUBAO_CONNECTION_EVENTS:
            if len(data) < offset + 4:
                raise _DoubaoTTSProtocolError("doubao frame missing session id size")
            session_id_size = struct.unpack(">I", data[offset : offset + 4])[0]
            offset += 4
            session_id = data[offset : offset + session_id_size].decode("utf-8", "ignore")
            offset += session_id_size
        elif event in {
            _DOUBAO_EVENT_CONNECTION_STARTED,
            _DOUBAO_EVENT_CONNECTION_FAILED,
            _DOUBAO_EVENT_CONNECTION_FINISHED,
        }:
            if len(data) >= offset + 4:
                connect_id_size = struct.unpack(">I", data[offset : offset + 4])[0]
                offset += 4
                connect_id = data[offset : offset + connect_id_size].decode("utf-8", "ignore")
                offset += connect_id_size

    if len(data) < offset + 4:
        raise _DoubaoTTSProtocolError("doubao frame missing payload size")
    payload_size = struct.unpack(">I", data[offset : offset + 4])[0]
    offset += 4
    payload = data[offset : offset + payload_size]
    if len(payload) != payload_size:
        raise _DoubaoTTSProtocolError("doubao frame payload is truncated")
    return _DoubaoMessage(
        connect_id=connect_id,
        error_code=error_code,
        event=event,
        flag=flag,
        payload=payload,
        session_id=session_id,
        type=msg_type,
    )


def _doubao_payload_message(message: _DoubaoMessage) -> str:
    if not message.payload:
        return ""
    try:
        payload = json.loads(message.payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return message.payload[:180].decode("utf-8", "replace")
    if isinstance(payload, dict):
        value = payload.get("message") or payload.get("error") or payload.get("status_text")
        if isinstance(value, str) and value.strip():
            return value.strip()
    return json.dumps(payload, ensure_ascii=False)[:180]


async def _doubao_connect_websocket(
    endpoint: str,
    headers: dict[str, str],
) -> Any:
    return await websockets.connect(
        endpoint,
        additional_headers=headers,
        max_size=10 * 1024 * 1024,
    )


async def _doubao_send_event(
    websocket: Any,
    *,
    event: int,
    payload: bytes = b"{}",
    session_id: str = "",
) -> None:
    await websocket.send(
        _doubao_pack_message(
            event=event,
            msg_type=_DOUBAO_MSG_FULL_CLIENT_REQUEST,
            payload=payload,
            session_id=session_id,
        )
    )


async def _doubao_receive_message(websocket: Any) -> _DoubaoMessage:
    data = await websocket.recv()
    if not isinstance(data, bytes):
        raise _DoubaoTTSProtocolError("doubao websocket returned text frame")
    message = _doubao_unpack_message(data)
    if message.type == _DOUBAO_MSG_ERROR:
        detail = _doubao_payload_message(message)
        raise _DoubaoTTSProtocolError(f"doubao error {message.error_code}: {detail}")
    return message


async def _doubao_wait_for_event(websocket: Any, event: int) -> _DoubaoMessage:
    message = await asyncio.wait_for(
        _doubao_receive_message(websocket),
        timeout=DOUBAO_TTS_TIMEOUT_SECONDS,
    )
    if message.type != _DOUBAO_MSG_FULL_SERVER_RESPONSE or message.event != event:
        detail = _doubao_payload_message(message)
        raise _DoubaoTTSProtocolError(
            f"unexpected doubao event {message.event} type {message.type}: {detail}"
        )
    return message


def _doubao_text_chunks(text: str, *, chunk_chars: int) -> list[str]:
    return [text[index : index + chunk_chars] for index in range(0, len(text), chunk_chars)]


def _doubao_session_payload(
    *,
    config: _DoubaoTTSConfig,
    event: int,
    text: str | None = None,
) -> bytes:
    audio_params: dict[str, Any] = {
        "format": config.audio_format,
        "sample_rate": config.sample_rate,
    }
    if config.emotion:
        audio_params["emotion"] = config.emotion
        if config.emotion_scale is not None:
            audio_params["emotion_scale"] = config.emotion_scale
    if config.speech_rate is not None:
        audio_params["speech_rate"] = config.speech_rate

    req_params: dict[str, Any] = {
        "speaker": config.voice,
        "audio_params": audio_params,
        "additions": json.dumps({"disable_markdown_filter": False}),
    }
    if text is not None:
        req_params["text"] = text

    payload = {
        "event": event,
        "namespace": "BidirectionalTTS",
        "req_params": req_params,
        "user": {"uid": str(uuid.uuid4())},
    }
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


async def _doubao_send_text_stream(
    websocket: Any,
    *,
    config: _DoubaoTTSConfig,
    session_id: str,
    text: str,
) -> None:
    for chunk in _doubao_text_chunks(text, chunk_chars=config.chunk_chars):
        await _doubao_send_event(
            websocket,
            event=_DOUBAO_EVENT_TASK_REQUEST,
            payload=_doubao_session_payload(
                config=config,
                event=_DOUBAO_EVENT_TASK_REQUEST,
                text=chunk,
            ),
            session_id=session_id,
        )
        if config.chunk_delay_seconds:
            await asyncio.sleep(config.chunk_delay_seconds)
    await _doubao_send_event(
        websocket,
        event=_DOUBAO_EVENT_FINISH_SESSION,
        session_id=session_id,
    )


async def _synthesize_doubao_speech(text: str, *, config: _DoubaoTTSConfig) -> dict[str, Any]:
    if not config.configured:
        return _fallback_response(
            "doubao provider not configured",
            model=config.model_label,
            provider="doubao",
            voice=config.voice,
        )

    websocket = None
    send_task: asyncio.Task[None] | None = None
    audio_chunks: list[bytes] = []
    try:
        websocket = await _doubao_connect_websocket(config.endpoint, config.headers)
        await _doubao_send_event(websocket, event=_DOUBAO_EVENT_START_CONNECTION)
        await _doubao_wait_for_event(websocket, _DOUBAO_EVENT_CONNECTION_STARTED)

        session_id = str(uuid.uuid4())
        await _doubao_send_event(
            websocket,
            event=_DOUBAO_EVENT_START_SESSION,
            payload=_doubao_session_payload(
                config=config,
                event=_DOUBAO_EVENT_START_SESSION,
            ),
            session_id=session_id,
        )
        await _doubao_wait_for_event(websocket, _DOUBAO_EVENT_SESSION_STARTED)

        send_task = asyncio.create_task(
            _doubao_send_text_stream(
                websocket,
                config=config,
                session_id=session_id,
                text=text,
            )
        )
        while True:
            message = await asyncio.wait_for(
                _doubao_receive_message(websocket),
                timeout=DOUBAO_TTS_TIMEOUT_SECONDS,
            )
            if message.type == _DOUBAO_MSG_AUDIO_ONLY_SERVER and message.payload:
                audio_chunks.append(message.payload)
                continue
            if (
                message.type == _DOUBAO_MSG_FULL_SERVER_RESPONSE
                and message.event == _DOUBAO_EVENT_SESSION_FAILED
            ):
                detail = _doubao_payload_message(message)
                raise _DoubaoTTSProtocolError(f"doubao session failed: {detail}")
            if (
                message.type == _DOUBAO_MSG_FULL_SERVER_RESPONSE
                and message.event == _DOUBAO_EVENT_SESSION_FINISHED
            ):
                break

        await send_task
        send_task = None

        if not audio_chunks:
            return _fallback_response(
                "doubao provider returned no audio",
                model=config.model_label,
                provider="doubao",
                voice=config.voice,
            )

        audio_data_url, mime_type = _audio_bytes_data_url(
            b"".join(audio_chunks),
            audio_format=config.audio_format,
        )
        return {
            "ok": True,
            "audioDataUrl": audio_data_url,
            "mimeType": mime_type,
            "provider": "doubao",
            "reason": "ok",
            "model": config.model_label,
            "voice": config.voice,
        }
    except Exception as exc:
        logger.warning("seeyouclaw doubao telephone speech failed: {}", exc)
        return _fallback_response(
            "doubao speech request failed",
            model=config.model_label,
            provider="doubao",
            voice=config.voice,
        )
    finally:
        if send_task is not None and not send_task.done():
            send_task.cancel()
        if websocket is not None:
            try:
                await _doubao_send_event(websocket, event=_DOUBAO_EVENT_FINISH_CONNECTION)
                await _doubao_wait_for_event(websocket, _DOUBAO_EVENT_CONNECTION_FINISHED)
            except Exception:
                pass
            try:
                await websocket.close()
            except Exception:
                pass


async def _synthesize_qwen_speech(
    text: str,
    *,
    audio_format: str,
    model: str,
    voice: str,
) -> dict[str, Any]:
    if not text:
        return _fallback_response("empty text")

    try:
        config = resolve_config_env_vars(load_config())
        dashscope = config.providers.dashscope
        api_key = dashscope.api_key
        api_base = (dashscope.api_base or DEFAULT_DASHSCOPE_BASE_URL).rstrip("/")
    except Exception as exc:
        logger.warning("seeyouclaw telephone speech config unavailable: {}", exc)
        return _fallback_response(
            "speech provider unavailable",
            model=model,
            provider="qwen",
            voice=voice,
        )

    if not api_key:
        return _fallback_response(
            "speech provider not configured",
            model=model,
            provider="qwen",
            voice=voice,
        )

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    body = _telephone_request_body(
        text,
        model=model,
        voice=voice,
        audio_format=audio_format,
    )
    audio_chunks: list[str] = []

    try:
        timeout = httpx.Timeout(connect=10.0, read=45.0, write=10.0, pool=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                f"{api_base}/chat/completions",
                headers=headers,
                json=body,
            ) as response:
                if response.status_code >= 400:
                    detail = (await response.aread()).decode("utf-8", errors="replace")
                    logger.warning(
                        "seeyouclaw telephone speech failed: HTTP {} {}",
                        response.status_code,
                        detail[:180],
                    )
                    return _fallback_response(
                        "speech provider rejected request",
                        model=model,
                        provider="qwen",
                        voice=voice,
                    )

                async for line in response.aiter_lines():
                    line = line.strip()
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if not data or data == "[DONE]":
                        continue
                    try:
                        event = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    chunk = _extract_audio_chunk(event)
                    if chunk:
                        audio_chunks.append(chunk)
    except Exception as exc:
        logger.warning("seeyouclaw telephone speech request failed: {}", exc)
        return _fallback_response(
            "speech request failed",
            model=model,
            provider="qwen",
            voice=voice,
        )

    if not audio_chunks:
        return _fallback_response(
            "speech provider returned no audio",
            model=model,
            provider="qwen",
            voice=voice,
        )

    try:
        audio_data_url, mime_type = _audio_response_payload(
            "".join(audio_chunks),
            audio_format=audio_format,
        )
    except (binascii.Error, ValueError) as exc:
        logger.warning("seeyouclaw telephone speech returned invalid audio: {}", exc)
        return _fallback_response(
            "speech provider returned invalid audio",
            model=model,
            provider="qwen",
            voice=voice,
        )

    return {
        "ok": True,
        "audioDataUrl": audio_data_url,
        "mimeType": mime_type,
        "provider": "qwen",
        "reason": "ok",
        "model": model,
        "voice": voice,
    }


async def synthesize_telephone_speech(payload: dict[str, Any]) -> dict[str, Any]:
    text = _clean_text(payload.get("text"))
    if not text:
        return _fallback_response("empty text")

    model = _clean_token(payload.get("model"), default=DEFAULT_TELEPHONE_MODEL)
    voice = _clean_token(payload.get("voice"), default=DEFAULT_TELEPHONE_VOICE)
    audio_format = _clean_token(
        payload.get("format"),
        default=DEFAULT_TELEPHONE_FORMAT,
        allowed={"wav", "mp3", "pcm"},
    )

    doubao_config = _doubao_tts_config_from_env()
    doubao_result: dict[str, Any] | None = None
    if doubao_config.configured:
        doubao_result = await _synthesize_doubao_speech(text, config=doubao_config)
        if doubao_result.get("ok"):
            return doubao_result

    qwen_result = await _synthesize_qwen_speech(
        text,
        audio_format=audio_format,
        model=model,
        voice=voice,
    )
    if qwen_result.get("ok"):
        return qwen_result
    if (
        doubao_result is not None
        and qwen_result.get("reason") == "speech provider not configured"
    ):
        return doubao_result
    return qwen_result
