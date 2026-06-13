# seeyouclaw DeepTalk Mode

DeepTalk is a telephone-mode extension for long, high-context conversations:
emotional reflection, research exploration, essay/blog shaping, and project
planning. The goal is not a louder assistant. The goal is a better host: active
listening, careful confirmation, and a durable structure that can be archived.

## Product Shape

DeepTalk has two behaviors.

### Explore

The assistant keeps the conversation moving as a guided session.

- Reflect the user's current state and intent before moving forward.
- Ask one focused question at a time.
- Track assumptions, open questions, decisions, and next steps.
- Use multimodal cues only for the current interaction context.
- Avoid sensitive or permanent profiling unless the user explicitly approves it.
- Keep spoken replies short enough for video-call playback.

### Archive

DeepTalk maintains an OpenSpec-inspired project record while the call continues:

```text
.seeyouclaw/deeptalk/projects/<timestamp>-<slug>/
  project.json             # sidecar metadata and compact summary
  proposal.md              # why this topic matters
  design.md                # current state and runtime approach
  tasks.md                 # ordered next steps
  specs/
    main/
      spec.md              # concrete requirements and scenarios
  notes.md                 # selected turn notes from the call
  archive/
    <timestamp>/
      ...                  # point-in-time snapshot
```

The archive step is explicit. The user can press the archive button in the
Telephone sidebar, or ask the assistant to summarize/archive the discussion.
The current PR implements the file-writing sidecar and archive button; richer
LLM-authored project diffs can be layered on later.

## OpenSpec Influence

OpenSpec separates proposed changes from durable specs:

- `proposal.md` explains why a change exists.
- `design.md` captures approach, trade-offs, and current state.
- `tasks.md` gives execution order.
- `specs/<capability>/spec.md` stores concrete behavior.
- `changes/archive/<date>-<id>/` preserves completed change context.

DeepTalk borrows that shape without adding OpenSpec as a runtime dependency.
This keeps telephone latency low and keeps seeyouclaw's implementation modular.

## Runtime Integration

DeepTalk enters through an explicit `DEEPTALK` toggle on the telephone page.
The toggle adds `seeyouclaw_deeptalk` metadata to user turns, so the backend
injects runtime guidance into nanobot's existing context builder.

In parallel, the frontend calls protected WebUI APIs:

- `/api/seeyouclaw/deeptalk/ensure`
- `/api/seeyouclaw/deeptalk/update`
- `/api/seeyouclaw/deeptalk/read`
- `/api/seeyouclaw/deeptalk/archive`

This design preserves nanobot compatibility:

- The same WebSocket chat id is used.
- Existing memory and context replay still work.
- Telephone spoken-reply hints still apply.
- The project sidecar is opt-in and can be disabled per call.
- Sidecar updates are short and deterministic, so they do not add cloud-token
  cost or block the live call loop.

## Current Limitations

- The project sidecar is deterministic. It records compact state, but it does
  not yet run a separate LLM spec-diff agent.
- It stores selected turn snippets, not the full nanobot transcript.
- Archive creates a point-in-time snapshot; it does not yet ask a model to
  rewrite the project into a polished final document.

## Acceptance Script

Open `#/telephone`, start a call, and turn on `DEEPTALK`.

Explore prompt:

```text
我最近在想一个科研想法：能不能让多模态助手在低成本下判断什么时候该看摄像头，但我还没想清楚研究问题怎么定。
```

Expected result:

- The assistant should reflect the uncertainty or motivation.
- It should name a compact project frame, such as why/current shape/open
  question/next step.
- It should ask exactly one focused question.
- The right sidebar should show a DeepTalk project with Why, Current,
  Questions, and Tasks.

Follow-up prompt:

```text
我更关心它怎么像一个长期项目一样沉淀下来。
```

Expected result:

- The assistant should connect the follow-up to the previous structure.
- The DeepTalk project panel should update instead of restarting.
- `notes.md`, `proposal.md`, `design.md`, `tasks.md`, and `specs/main/spec.md`
  should exist under `.seeyouclaw/deeptalk/projects/...`.

Archive prompt:

```text
把这次讨论归档成一个项目。
```

Expected result:

- The assistant should move toward written synthesis.
- Pressing the archive button should create an `archive/<timestamp>/` snapshot.

## Future Work

- Replace the deterministic updater with a separate low-cost DeepTalk sidecar
  agent that proposes structured spec diffs.
- Add user-approved export controls for saving selected DeepTalk projects into
  a public `docs/deeptalk/` folder.
- Add opt-in visual state notes, such as "confused" or "showing an object",
  with short retention.
- Add controls to clear, download, or continue a DeepTalk project later.
