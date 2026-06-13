"""Telephone-mode speech synthesis helpers for seeyouclaw WebUI."""

from __future__ import annotations

import json
import re
from typing import Any

import httpx
from loguru import logger

from nanobot.config.loader import load_config, resolve_config_env_vars

DEFAULT_DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DEFAULT_TELEPHONE_MODEL = "qwen3-omni-flash"
DEFAULT_TELEPHONE_VOICE = "Ethan"
DEFAULT_TELEPHONE_FORMAT = "wav"
MAX_TELEPHONE_SPEECH_CHARS = 1200


def _clean_text(value: Any, *, max_len: int = MAX_TELEPHONE_SPEECH_CHARS) -> str:
    if not isinstance(value, str):
        return ""
    return re.sub(r"\s+", " ", value).strip()[:max_len]


def _clean_token(value: Any, *, default: str, allowed: set[str] | None = None) -> str:
    if not isinstance(value, str):
        return default
    cleaned = re.sub(r"[^A-Za-z0-9_-]", "", value).strip()
    if not cleaned:
        return default
    if allowed is not None and cleaned not in allowed:
        return default
    return cleaned


def _fallback_response(reason: str) -> dict[str, Any]:
    return {
        "ok": False,
        "audioDataUrl": None,
        "mimeType": None,
        "reason": reason,
        "model": DEFAULT_TELEPHONE_MODEL,
        "voice": DEFAULT_TELEPHONE_VOICE,
    }


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


def _telephone_request_body(text: str, *, model: str, voice: str, audio_format: str) -> dict[str, Any]:
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

    try:
        config = resolve_config_env_vars(load_config())
        dashscope = config.providers.dashscope
        api_key = dashscope.api_key
        api_base = (dashscope.api_base or DEFAULT_DASHSCOPE_BASE_URL).rstrip("/")
    except Exception as exc:
        logger.warning("seeyouclaw telephone speech config unavailable: {}", exc)
        return _fallback_response("speech provider unavailable")

    if not api_key:
        return _fallback_response("speech provider not configured")

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
                    return _fallback_response("speech provider rejected request")

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
        return _fallback_response("speech request failed")

    if not audio_chunks:
        return _fallback_response("speech provider returned no audio")

    mime_type = f"audio/{audio_format}"
    return {
        "ok": True,
        "audioDataUrl": f"data:{mime_type};base64,{''.join(audio_chunks)}",
        "mimeType": mime_type,
        "reason": "ok",
        "model": model,
        "voice": voice,
    }
