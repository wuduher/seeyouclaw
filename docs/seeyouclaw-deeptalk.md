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

When the user asks to archive, the assistant should turn the conversation into
an OpenSpec-inspired project record.

```text
deeptalk/archive/YYYY-MM-DD-<slug>/
  proposal.md              # why this topic matters
  design.md                # current state, approach, risks, decisions
  tasks.md                 # ordered next steps
  specs/
    <topic>/
      spec.md              # concrete claims, requirements, hypotheses
  transcript.md            # optional selected notes or raw conversation summary
```

The archive step should first confirm scope briefly, especially for emotional
or personal material. If file-writing tools are not available, the assistant can
return the same structure as a written synthesis in chat.

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

DeepTalk currently enters through an explicit `DEEPTALK` toggle on the
telephone page. The toggle adds `seeyouclaw_deeptalk` metadata to user turns.
The backend then injects runtime guidance into nanobot's existing context
builder.

This design preserves nanobot compatibility:

- The same WebSocket chat id is used.
- Existing memory and context replay still work.
- Telephone spoken-reply hints still apply.
- The mode can be disabled per turn without mutating global configuration.

## Acceptance Script

Use the telephone page and turn on `DEEPTALK`.

Explore prompt:

```text
我最近在想一个科研想法：能不能让多模态助手在低成本下判断什么时候该看摄像头，但我还没想清楚研究问题怎么定。
```

Expected response shape:

- The assistant should first reflect the uncertainty or motivation.
- It should name a compact structure such as why/current shape/open question/next step.
- It should ask exactly one focused question instead of giving a flat answer.
- It should keep the response short enough to be spoken.

Follow-up prompt:

```text
我更关心它怎么像一个长期项目一样沉淀下来。
```

Expected response shape:

- The assistant should connect the follow-up to the previous structure.
- It should update the project frame instead of restarting.
- It should lead toward one next decision.

Archive prompt:

```text
把这次讨论归档成一个项目。
```

Expected response shape:

- The assistant should switch from spoken exploration to a written project record.
- The record should include `proposal.md`, `design.md`, `tasks.md`, and
  `specs/<topic>/spec.md`.

## Future Work

- Add a real archive endpoint that writes approved DeepTalk records under the
  active workspace.
- Add a compact side panel for current proposal, open questions, and tasks.
- Add opt-in visual state notes, such as "confused" or "showing an object",
  with short retention.
- Add export controls so users can clear, download, or continue a DeepTalk
  project later.
