# seeyouclaw Provider Setup

This project keeps model providers replaceable. The first competition build uses
DeepSeek for chat generation and DashScope `Qwen3-ASR-Flash` for cloud speech
transcription, while keeping secrets outside git.

## DeepSeek Flash Preset

Set the key in the terminal that starts nanobot.

Windows PowerShell:

```powershell
$env:DEEPSEEK_API_KEY = "<your-deepseek-key>"
```

macOS / Linux:

```bash
export DEEPSEEK_API_KEY="<your-deepseek-key>"
```

Merge this snippet into `~/.nanobot/config.json`:

```json
{
  "providers": {
    "deepseek": {
      "apiKey": "${DEEPSEEK_API_KEY}"
    }
  },
  "modelPresets": {
    "deepseek-flash": {
      "label": "DeepSeek V4 Flash",
      "provider": "deepseek",
      "model": "deepseek-v4-flash",
      "maxTokens": 4096,
      "contextWindowTokens": 65536,
      "temperature": 0.2,
      "reasoningEffort": "none"
    }
  },
  "agents": {
    "defaults": {
      "modelPreset": "deepseek-flash"
    }
  }
}
```

Verify:

```powershell
nanobot status
nanobot agent -m "Say hello and introduce seeyouclaw in one sentence."
```

The seeyouclaw semantic vision router looks for presets in this order:
`seeyouclaw-router`, `deepseek-v4-flash`, `deepseek-flash`, then the default
model preset. For the two-day build, `deepseek-flash` is enough. Add a separate
`seeyouclaw-router` preset later only if you want routing to use a different
temperature, model, or provider than normal chat.

## Qwen ASR Transcription

Set the DashScope key in the terminal that starts nanobot.

Windows PowerShell:

```powershell
$env:DASHSCOPE_API_KEY = "<your-dashscope-key>"
```

macOS / Linux:

```bash
export DASHSCOPE_API_KEY="<your-dashscope-key>"
```

Merge this snippet into `~/.nanobot/config.json`:

```json
{
  "providers": {
    "dashscope": {
      "apiKey": "${DASHSCOPE_API_KEY}",
      "apiBase": "https://dashscope.aliyuncs.com/compatible-mode/v1"
    }
  },
  "transcription": {
    "enabled": true,
    "provider": "dashscope",
    "model": "qwen3-asr-flash",
    "language": "zh",
    "maxDurationSec": 120,
    "maxUploadMb": 25
  }
}
```

Notes:

- `Qwen3-ASR-Flash` uses DashScope's OpenAI-compatible chat endpoint with
  `input_audio`, not Whisper's `/audio/transcriptions` path.
- When no cloud transcription provider is configured, WebUI can fall back to
  browser speech recognition for a local demo path.

## Telephone Reply Audio

The telephone page now uses a provider fallback chain:

1. Doubao V3 bidirectional WebSocket TTS, when `DOUBAO_TTS_API_KEY` is set.
2. Qwen Omni speech through DashScope, when `DASHSCOPE_API_KEY` is set.
3. Browser built-in speech synthesis, when cloud speech is unavailable.

Set the Doubao key in the terminal that starts nanobot:

Windows PowerShell:

```powershell
$env:DOUBAO_TTS_API_KEY = "<your-doubao-tts-key>"
```

macOS / Linux:

```bash
export DOUBAO_TTS_API_KEY="<your-doubao-tts-key>"
```

Defaults:

- endpoint: `wss://openspeech.bytedance.com/api/v3/tts/bidirection`
- resource id: `seed-tts-2.0`
- voice: `zh_female_xiaohe_uranus_bigtts`
- output format: `mp3`

Optional environment overrides:

```powershell
$env:DOUBAO_TTS_VOICE = "zh_female_xiaohe_uranus_bigtts"
$env:DOUBAO_TTS_RESOURCE_ID = "seed-tts-2.0"
$env:DOUBAO_TTS_FORMAT = "mp3"
```

If Doubao is not configured or returns no usable audio, the telephone page uses
the same DashScope credential and calls
`qwen3-omni-flash` with `modalities: ["text", "audio"]`,
`audio: { "voice": "Ethan", "format": "wav" }`, and `stream: true`.

The WebUI endpoint is protected by the normal WebUI API token and returns a
browser-playable audio data URL. The Telephone page displays `Doubao voice`,
`Qwen voice`, or a browser fallback reason so demo-time audio regressions are
visible.

## WebUI Gateway

For the browser demo, keep WebUI local by default:

```json
{
  "channels": {
    "websocket": {
      "enabled": true,
      "host": "127.0.0.1",
      "port": 8765,
      "path": "/",
      "tokenIssuePath": "/api/token",
      "tokenIssueSecret": "${SEEYOUCLAW_WEBUI_SECRET}"
    }
  }
}
```

Start:

```powershell
$env:SEEYOUCLAW_WEBUI_SECRET = "change-me-local-demo"
nanobot gateway
```

Then open `http://127.0.0.1:8765`.

## Swapping Providers Later

The WebUI camera router sends snapshots as normal nanobot image attachments.
To switch to a different provider, change only:

- `providers.<name>` credential and optional `apiBase`
- `modelPresets.<preset>.provider`
- `modelPresets.<preset>.model`
- `agents.defaults.modelPreset`
- `transcription.provider`
- `transcription.model`
- telephone speech env vars such as `DOUBAO_TTS_VOICE`,
  `DOUBAO_TTS_RESOURCE_ID`, or the Qwen fallback `model` / `voice` constants in
  the seeyouclaw telephone module

DeepSeek is currently used as the low-latency text provider. DashScope Qwen ASR
handles speech-to-text. The semantic router uses DeepSeek only for locally
ambiguous text turns; obvious visual requests and ordinary turns stay on the
local rule path. For stronger visual understanding, add a vision-capable
provider preset and route image-heavy turns to that preset in a later PR. Qwen
Doubao and Qwen Omni are used only for the telephone page's reply audio layer,
while the actual response still comes from nanobot's normal context-managed
agent loop.
