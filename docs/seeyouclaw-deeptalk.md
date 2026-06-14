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

## Subagent and DeepResearch Gate

DeepTalk should not spawn research work just because the conversation is deep.
The main live conversation remains the host for emotional reflection, personal
meaning-making, early project framing, and synthesis.

A subagent or deepresearch-style task becomes useful when the user needs a
bounded evidence-gathering job that can run in parallel:

- literature, papers, citations, or source review
- benchmark, competitor, or market checks
- codebase-wide investigation
- current facts or external evidence that would change the project direction

When this gate is met, DeepTalk should name the research question and expected
evidence before spawning a subagent. The subagent returns evidence; the main
DeepTalk voice remains responsible for synthesis and next-question hosting.

## Spoken Guidance Moves

The practical weakness in voice mode is that structure can stay hidden in the
prompt or sidecar files. DeepTalk needs audible hosting moves: short reusable
turn patterns that the user can hear without seeing markdown.

The current project sidecar records these moves in `summary.guidance_moves`,
shows them in the telephone panel, and writes them into `proposal.md` and
`design.md`.

- Mirror: name the user's felt state or core idea in one warm sentence.
- Frame: say the project shape out loud with Why, Current, and Next labels.
- Offer lanes: when the user is vague, offer two or three paths and ask them to choose.
- Research gate: ask what external evidence would change the decision before spawning a subagent.
- Archive checkpoint: confirm scope, then preserve proposal, design, tasks, and specs.
- One-question close: end with exactly one concrete confirming question.

For speech, this should sound like a light hosting loop, not a written outline:
"I hear the uncertainty. I can hold this as either an emotional reflection, a
research direction, or a blog argument; which lane should we take first?"

DeepTalk should not collapse back into ordinary telephone acknowledgements.
For every substantive turn, a warm reflection alone is not enough: the assistant
should name the emotional variable, offer lanes, update the project frame, or
propose the next archiveable artifact before asking its one focused question.

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

- Hook nudges are represented in the API/schema; timer and agent-hook wiring
  are planned follow-ups.
- Archive creates a point-in-time snapshot; it does not yet ask a model to
  rewrite the project into a polished final document.
- Multimodal `observationText` is not yet fed from multi-frame capture.

The telephone UI now feeds compact `observationText` summaries when DeepTalk
captures a vision frame (two snapshots when possible). A pause hook sends
`hookText` after ~28s of listening silence.

## Project Sidecar Updater

Turn updates now prefer a low-cost LLM sidecar (`seeyouclaw_deeptalk_updater`)
that synthesizes OpenSpec-style artifacts from recent notes plus the latest
turn. It uses the same preset chain as the vision router (`seeyouclaw-router`,
`deepseek-v4-flash`, then default).

The updater returns structured fields for:

| Field | Written to |
|-------|------------|
| `why`, `open_questions` | `proposal.md` |
| `current`, `design_notes` | `design.md` |
| `tasks` | `tasks.md` |
| `spec_body` | `specs/main/spec.md` |
| `lane` | `proposal.md` Lane section |

Keyword-only rules remain as fallback when the updater is unavailable. The
sidecar should synthesize meaning instead of copying ASR transcripts or
writing generic DeepTalk boilerplate into user artifacts.

The telephone UI waits until assistant streaming completes before syncing
assistant text to the sidecar, so notes and synthesis use full replies rather
than first-token fragments.

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
- It uses an audible guidance move: mirror, frame, offer lanes, research gate,
  archive checkpoint, or one-question close.
- It does not answer substantive turns with only "I am listening" style passive
  acknowledgement.
- It asks exactly one focused question.
- The right sidebar shows Why, Current, Questions, Moves, Signals, and Tasks.
- If external papers, citations, benchmarks, or codebase evidence become
  necessary, Signals should surface a deepresearch/subagent gate rather than
  spawning one for ordinary emotional reflection.

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

- Add an explicit UI affordance for approving a focused research subagent when
  the deepresearch gate is met.
- Feed `observationText` from multi-frame or short-video analysis.
- Feed `hookText` from pause, drift, unresolved-question, and follow-up hooks.
- Add user-approved export controls for saving selected DeepTalk projects into
  a public `docs/deeptalk/` folder.
- Add controls to clear, download, or continue a DeepTalk project later.
