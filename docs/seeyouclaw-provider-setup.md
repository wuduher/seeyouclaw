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

## Qwen Omni Telephone Audio

The telephone page uses the same DashScope credential and calls
`qwen3-omni-flash` with `modalities: ["text", "audio"]`,
`audio: { "voice": "Ethan", "format": "wav" }`, and `stream: true`.

No extra secret is needed beyond `DASHSCOPE_API_KEY`. The WebUI endpoint is
protected by the normal WebUI API token and returns a browser-playable audio
data URL. If the provider is unavailable, the telephone page falls back to the
browser's built-in speech synthesis.

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
- telephone speech `model` / `voice` constants in the seeyouclaw telephone
  module, if the audio voice provider changes

DeepSeek is currently used as the low-latency text provider. DashScope Qwen ASR
handles speech-to-text. The router uses DeepSeek only for locally ambiguous
text turns; obvious visual requests and ordinary turns stay on the local rule
path. For stronger visual understanding, add a vision-capable provider preset
and route image-heavy turns to that preset in a later PR. Qwen Omni is used only
for the telephone page's reply audio layer, while the actual response still
comes from nanobot's normal context-managed agent loop.
