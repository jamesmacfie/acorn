# Phase 07: session-open timeouts

Status: planned, October 13, 2026.

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
