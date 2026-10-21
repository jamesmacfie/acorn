# Phase 1: measure the window under load

Date: October 21, 2026. Status: proposed. Comes first.

The window is worst when the machine is busy, and nothing reproduces that on demand. This phase adds a
load option to the replay harness and fills three gaps in the telemetry, so later phases can show what
they changed. Read [the programme](./README.md) first.

## Starting point

- [Streaming replay](../../local-development/streaming-replay.md) streams a fixed agent reply into a
  visible window and samples each process's CPU, `ui.frame.gap`, and `ui.event_loop.delay` per phase.
  `apps/desktop/scripts/agent/ui.mjs` runs the `replay` command. It has no way to load the machine.
- `broker.request` in `packages/custody/src/broker/brokerFetch.ts` times a request from before the
  helper's HTTP agent assigns a socket. A read that waited 3 s for a socket looks like a 3 s read.
- `ws.inbound.agent` spans in `packages/client-core/src/infra/node/wsClient.ts` have no children and
  no frame count, so a 150 ms dispatch can't be split into decode, store write, and reactive work.
- `ui.interaction.work` reaches Sentry only as an event beside the span
  (`packages/client-core/src/infra/telemetry/emitter.ts`), so it can't be grouped.
- 120 of 128 `ui.stall` logs from October 14 to 21 came with no interaction open, and nothing says what
  ran during them.

## Changes

### Load the machine during a replay

Add `--load <n>` to the `replay` and `replay-ab` commands. It starts `n` busy processes, each a Node
child running a tight loop, before the fixture streams, and stops them after the `hidden` phase. Use
the CPU count by default when the flag has no value. Record `n` and the one-minute load average in
the report.

Add one more fixture, `agents`, that streams the `prose` reply into three sessions at once. That's the
owner's normal case: several agents working while one is on screen.

Run the three fixtures with and without `--load`, alternating base and candidate as the replay page
describes. Record the numbers in `docs/testing/` as the programme's baseline.

### Split queue time from request time

In `BrokerFetch.fetch`, record the time from the call to the request's `socket` event as
`queue.ms` on `broker.request`. Add `pool.active` and `pool.queued` from the agent's `sockets` and
`requests` counts at the start. Phase 2 measures its effect with these.

### Say what an inbound frame cost

Give `ws.inbound.<channel>` two attributes: `frames`, the count applied in that dispatch, and
`bytes`, the frame size. Inside the agents store's `onFrame`, wrap the store write in
`measureWork('agents.frame.apply')`. Leave the reactive work outside it, so the span's remainder is
the cascade phase 7 removes.

### Group interaction work

Copy the top three `ui.interaction.work` operations onto the interaction span as `work.top1` to
`work.top3`, each as `operation:calls`. Keep the event. This follows the attribute rules, because
operation names are a closed list.

### Name what ran during a stall

On a `ui.stall`, add the inbound channels dispatched in the last second, whether a cache save was in
flight, and the count of queries fetching. These are names and counts, never keys or text.

## Tests

- `replay.test.mjs` covers the `--load` flag's parse and the busy processes' start and stop.
- A `brokerFetch` test with a one-socket agent: a second request's `queue.ms` covers the first one's
  duration.
- A `wsClient` test: a dispatch of two frames records `frames: 2`.

## Acceptance

- A dated page in `docs/testing/` records the replay fixtures with and without `--load`: frame gap
  p95 and max, event loop delay p95, renderer CPU, and `ws.inbound.agent` p95.
- One day of Sentry with the new attributes, showing `queue.ms` against total time for
  `/v1/core/plugins` and `/v1/core/tasks/:id`.
- The [Node seams](../../telemetry/runtimes.md#node-seams) table and
  [diagnosis](../../telemetry/diagnosis.md) list the new attributes.
