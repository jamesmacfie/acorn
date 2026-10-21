# Phase 1: measure the window under load

## Completion note

Landed October 21, 2026, on branch `phase-1-measure-under-load`. The code and its tests are done. The
replay numbers and the day of Sentry aren't taken, and need the owner at the machine.

What landed:

- The replay harness takes `--load [N]` on `replay` and `replay-ab`, in
  `apps/desktop/scripts/agent/replay-load.mjs`. The report records `replay.load`, and each phase's
  one-minute `loadAverage`. A busy process exits on its own if the harness dies.
- The `agents` fixture streams `prose` into three sessions, with the flow in
  `flows/streaming-replay-agents.json`. `waitTurn` takes `sessions`, and checks each digest.
- The helper records a `broker.queue` histogram, the wait for a socket, with the same labels as
  `broker.request`. A `broker.request` of 100 ms or more in a renderer trace is also a span, with
  `route`, `queue.ms`, `pool.active`, and `pool.queued`.
- A slow `ws.inbound.<prefix>` span carries `bytes`. The agents store times its event write as
  `agents.frame.apply`.
- An interaction span carries `work.top1` to `work.top3`, and the `ui.interaction.work` events stay.
- `ui.stall` carries `inbound`, `cache.saving`, and `queries.fetching`.
- The replay page, the helper's seam table, the telemetry model, renderer, runtimes, and diagnosis
  pages, and [the dated baseline page](../../testing/window-under-load-2026-10-21.md).

Decisions and deviations:

1. `queue.ms` isn't a label on the `broker.request` histogram. A value that differs per request would
   make a series per request. The p95 that phases 2 and 10 ask for is the `broker.queue` histogram.
   The per-request numbers sit on the slow span. Both `measure` functions take an optional
   `slowAttrs`, which only the slow span carries.
2. The helper enters the trace named by the request's `traceparent` header, so its slow span hangs in
   the renderer's trace beside the Node's `http.request`. Before this, the helper never sent a slow
   span, because it had no ambient trace. The span carries `route`, the namespace from
   `apiRouteNamespace`, because the Sentry exporter keeps an `api.request` only past one second, and
   a per-route query can't lean on the parent. A request that never got a socket counts its whole
   time as queue time.
3. No `frames` attribute. Every dispatch applies exactly one frame until phase 7 queues them, so the
   count would always be 1. The doc's test of a two-frame dispatch can't exist against this code. The
   `wsClient` test checks `bytes` instead.
4. `bytes` is the UTF-8 size of the frame encoded again as JSON, computed only for a slow dispatch, at
   most 20 a flush. It isn't the wire size.
5. `agents.frame.apply` uses the store's `agentTelemetry.measure`, the file's own convention, not the
   kit's `measureWork`, which would file it under `core`. It isn't a child span of `ws.inbound.agent`,
   because renderer spans hang under the interaction, not under an enclosing measure. Compare the two
   histograms' sums.
6. "In the last second" on `ui.stall` means since the previous one-second tick, which includes the
   stall. The desktop entry hands the monitor the active cache, the way it hands `startPageFacts` the
   client. The cache lifecycle gained `saving()`.
7. The `agents` flow starts the first two sessions in the `open` stage, so the `streaming` phase
   doesn't count opening them. `startSession` waits until the Stop button is disabled, because a
   streaming session's composer stays on screen until the new one opens.

Not done:

- The replay runs. An agent-launched window is always hidden, and the replay refuses it. The `agents`
  flow and `--load` pass their unit tests but haven't run against a real window, so the wait for a
  new idle session is unverified. The baseline page has the commands and empty tables.
- The day of Sentry with the new attributes.
- The programme README still lists this phase. Trim it when the programme closes.

For later phases:

- Phase 2: read the queue from `broker.queue`. Add `timeout.kind` to the slow `broker.request` span
  through `slowAttrs`, the way `queue.ms` goes.
- Phase 7: add `frames` to the drain's `ws.inbound` span through `slowAttrs`. The gap between
  `ws.inbound.agent` and `agents.frame.apply` sums is the cascade to remove.
- The helper can send up to 20 `broker.request` spans every five seconds to Sentry. Watch the volume.
- The Node service bundle is 1,930,648 bytes against a ceiling of 1,931,900.

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
