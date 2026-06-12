# seeyouclaw Provider Setup

This project keeps model providers replaceable. The first competition build uses
DeepSeek through nanobot's existing `deepseek` OpenAI-compatible provider, and
keeps the API key outside git.

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
nanobot agent -m "你好，用一句话介绍 seeyouclaw"
```

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

DeepSeek is currently used as the low-latency text provider. For stronger visual
understanding, add a vision-capable provider preset and route image-heavy turns
to that preset in a later PR.

