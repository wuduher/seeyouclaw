# seeyouclaw DeepTalk Mode

DeepTalk is a telephone-mode extension for long, high-context conversations:
emotional reflection, research exploration, essay/blog shaping, and project
planning. The goal is not a louder assistant. The goal is a better host:
active listening, careful confirmation, proactive questions, and durable
project structure that can be archived.

## Core Bet

DeepTalk has two equally important jobs.

1. Projectize the conversation.
2. Generate useful initiative without turning into an interrogation.

The current PR implements the first durable scaffold and enough proactive state
to make the product direction visible. A later sidecar LLM can replace the
deterministic updater without changing the file shape or panel contract.

## OpenSpec Influence

The local reference for the structure is `D:\MyStudy\Project\OpenSpec`.
DeepTalk does not import OpenSpec at runtime, but borrows its SDD habit:
separate exploration, proposal, design, tasks, concrete specs, and archive.

DeepTalk maps conversation insights like this:

| Insight | Captured In |
|---------|-------------|
| Motivation, scope, why now | `proposal.md` |
| Current shape, trade-off, design decision | `design.md` |
| Concrete claim, behavior, hypothesis, scenario | `specs/<topic>/spec.md` |
| New work or follow-up | `tasks.md` |
| Raw selected turn context | `notes.md` |
| Frozen checkpoint | `archive/<timestamp>/` |

The first implementation writes:

```text
.seeyouclaw/deeptalk/projects/<timestamp>-<slug>/
  project.json
  proposal.md
  design.md
  tasks.md
  specs/
    main/
      spec.md
  notes.md
  archive/
    <timestamp>/
```

## Proactivity Sources

DeepTalk should feel active for three reasons.

### 1. SDD Questions

The assistant asks OpenSpec-inspired questions around:

- why this matters
- what changed in scope
- what requirement or claim is emerging
- what scenario would prove it
- what design trade-off is being chosen
- what task or artifact should exist next

These questions are not a rigid checklist. They are a conversation lens.

### 2. Curiosity, Empathy, and Multimodal Observation

DeepTalk also asks from the human situation:

- What seems emotionally loaded or uncertain?
- What is the user trying to protect, express, or discover?
- What did the user's recent state suggest, if they opted into camera context?

For DeepTalk, multimodal input should be an observation window: several frames
or a short video-derived summary over time. It should not be treated as one
captured keyframe that permanently defines the user's state.

The current sidecar accepts compact `observationText` summaries. A later PR can
feed that field from a multi-frame or short-video analysis route.

### 3. Hook-Driven Nudges

Some initiative should come from hooks rather than the main model prompt:

- long pause
- repeated uncertainty
- topic drift
- stale open question
- archive readiness
- scheduled follow-up

The current sidecar accepts compact `hookText` nudges and records them as
proactive signals. A later PR can wire these from nanobot hooks or WebUI timers.

## Runtime Integration

DeepTalk enters through an explicit `DEEPTALK` toggle on the telephone page.
The toggle adds `seeyouclaw_deeptalk` metadata to user turns, so the backend
injects runtime guidance into nanobot's existing context builder.

In parallel, the frontend calls protected WebUI APIs:

- `/api/seeyouclaw/deeptalk/ensure`
- `/api/seeyouclaw/deeptalk/update`
- `/api/seeyouclaw/deeptalk/read`
- `/api/seeyouclaw/deeptalk/archive`

The `update` payload can carry four compact lanes:

- `userText`
- `assistantText`
- `observationText`
- `hookText`

This preserves nanobot compatibility:

- The same WebSocket chat id is used.
- Existing memory and context replay still work.
- Telephone spoken-reply hints still apply.
- The project sidecar is opt-in and can be disabled per call.
- Sidecar updates are short and deterministic, so they do not add cloud-token
  cost or block the live call loop.

## Current Limitations

- The project sidecar is deterministic. It records compact state, but it does
  not yet run a separate LLM spec-diff agent.
- Multimodal observation windows are represented as text summaries; multi-frame
  capture and video analysis are planned follow-ups.
- Hook nudges are represented in the API/schema; timer and agent-hook wiring
  are planned follow-ups.
- Archive creates a point-in-time snapshot; it does not yet ask a model to
  rewrite the project into a polished final document.

## Acceptance Script

Open `#/telephone`, start a call, and turn on `DEEPTALK`.

Explore prompt:

```text
I am thinking about a research idea: can a multimodal assistant decide when it
should spend vision budget, while still feeling emotionally present?
```

Expected result:

- The assistant reflects the uncertainty or motivation.
- It names a compact project frame, such as why/current shape/open question/next step.
- It asks exactly one focused question.
- The right sidebar shows Why, Current, Questions, Signals, and Tasks.

Follow-up prompt:

```text
I care most about making the conversation settle into a long-running project,
not just a nicer prompt.
```

Expected result:

- The assistant connects the follow-up to the previous structure.
- The project panel updates instead of restarting.
- `notes.md`, `proposal.md`, `design.md`, `tasks.md`, and `specs/main/spec.md`
  exist under `.seeyouclaw/deeptalk/projects/...`.

Archive prompt:

```text
Archive this discussion as a project.
```

Expected result:

- The assistant moves toward written synthesis.
- Pressing the archive button creates an `archive/<timestamp>/` snapshot.

## Future Work

- Replace the deterministic updater with a separate low-cost DeepTalk sidecar
  agent that proposes structured spec diffs.
- Feed `observationText` from multi-frame or short-video analysis.
- Feed `hookText` from pause, drift, unresolved-question, and follow-up hooks.
- Add user-approved export controls for saving selected DeepTalk projects into
  a public `docs/deeptalk/` folder.
- Add controls to clear, download, or continue a DeepTalk project later.
