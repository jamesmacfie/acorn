# Phase 07: session-open timeouts

Status: landed October 13, 2026. A working day in Sentry is still to compare.

## Completion note

October 13, 2026. All three changes landed together, because an agent session can't read a day of
Sentry data first.

- A `timeout` from `startAgentView` carries `visibility`, the page's `document.visibilityState` when
  the timer fired. On `agents.session.open` it also carries `claimed`. It's true once a conversation
  took the open on, and false for a selection mark that nothing claimed. Opens the conversation
  starts itself count as claimed. The terminal client has no `document`, so it sends no `visibility`.
- `markAgentSelection` takes the task ID. After the caller's writes, at the next microtask, it
  cancels an unclaimed mark whose task isn't `activeTaskId()`. A conversation on screen claims
  synchronously, and one still mounting belongs to the active task, so neither is cut short. If the
  other task's conversation mounts later, it measures its own open from the mount.
- `ready` also starts a 100 ms timer. If the page is hidden when it fires, the span ends as `ready`
  with `hidden: true`, so a hidden window no longer waits out the 30 seconds.
- The Agents dashboard's run link selected a session for a task showing the Workflows pane. Nothing
  ever drew that selection, and the task stays active, so the rule above couldn't catch it. It uses
  `restoreManagedSessionSelection` and measures no open.
- [Diagnosis](../../telemetry/diagnosis.md) lists the new attributes.

Measured: unit tests beside `agentTelemetry.ts` cover the timeout attributes, a claimed and an
unclaimed mark, a mark for a task that isn't on screen, and a hidden window. Nothing was measured in
a real window or in Sentry.

Known gaps:

- The archive page previews a task that isn't the active one. A session opened there before its
  preview mounts is cancelled, and the conversation then measures from its mount.
- A selection on the active task whose Agent pane never appears still runs to the timeout, with
  `claimed: false` and `visibility: visible`.
- The two `agents.sidebar.open` timeouts get the `visibility` tag and the hidden-window fix. Nothing
  else changes for them.

After a working day, compare these in Sentry with the
[baseline](../../testing/sentry-baseline-2026-10-13.md), and record them under `docs/testing/`:

1. `agents.session.open` and `agents.sidebar.open` grouped by `outcome`. Expect fewer timeouts and
   more `cancelled`.
2. Every remaining `timeout`, split by `claimed` and `visibility`. Acceptance wants none with
   `claimed: true` and `visibility: visible`. Any that remain point at a path this phase didn't fix.
3. How many `ready` spans carry `hidden: true`.
4. The `agents.session.open` p95 over every outcome against the p95 of `outcome: ready`, excluding
   `hidden: true`. Acceptance wants them within 20%. The baseline had 6.3 s against 1.2 s.

For later phases: judge phase 04's session-open numbers on `outcome: ready` without `hidden: true`.

## Plan

Read the [programme page](./README.md) first. This phase needs nothing else. It fixes a measurement,
not the app, so do it before you use `agents.session.open` to judge phase 04.

## Deliverable

`agents.session.open` and `agents.sidebar.open` measure only opens that drew something. A selection
that never mounts a conversation ends as `cancelled` and stays out of the latency numbers.

## The problem

The [Sentry baseline](../../testing/sentry-baseline-2026-10-13.md) shows a p95 of 6.3 s for
`agents.session.open`. Opens that finished took 163 ms at the median and 1.2 s at p95. The gap is
12 spans that ended at exactly 30 s with `outcome: timeout`.

`startAgentView` in `plugins/agents/src/client/sessions/agentTelemetry.ts` starts a 30-second timer
and ends the span as a timeout when nothing calls `ready`. Two paths can leave it waiting:

1. `selectManagedSession` in `managedSelection.ts` calls `markAgentSelection` before the selection
   is drawn. `AgentConversation` claims it with `claimAgentSelection` when its session ID changes.
   If the selected session never mounts a conversation, nothing claims the mark. A session picked
   for a task that isn't on screen is the likely case, but nobody has confirmed it. The mark waits
   for the next selection to cancel it or for the timer.
2. `ready` waits for two animation frames. A hidden or occluded window gets no animation frames, so
   an open that loads while the window is hidden times out after its data arrived.

The trace `41de71cabd856889fdb7f64d379e1e1f` fits the first path. The outer open finished in 140 ms,
and a second `agents.session.open` nested inside it ran to the timeout.

## Change

1. Tag the timeout with what was pending: whether the mark was claimed, and
   `document.visibilityState` when the timer fired. Ship this first and read a day of data.
2. For an unclaimed mark, end the span as `cancelled` when the selected task isn't the one on screen.
   Don't wait for the next selection.
3. If hidden windows explain the rest, end the span as `ready` when the data has arrived and the
   window is hidden. Use a timer fallback in place of the second frame. Tag those spans
   `hidden: true` so the p95 can exclude them.

## Implementation steps

1. Add the two attributes to the timeout outcome in `startAgentView`.
2. Read a day of timeouts and split them by attribute.
3. Fix each path the data confirms.
4. Add tests beside `agentTelemetry.ts` for an unclaimed mark and for a hidden window.

## Acceptance

- Over a working day, `agents.session.open` records no `timeout` that has a claimed mark and a
  visible window.
- The p95 over every outcome matches the p95 of `outcome: ready` within 20%.
