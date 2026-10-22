# Window under load baseline, October 21, 2026

This page is the baseline for keeping the window responsive under load, a plan deleted October 22, 2026.
Every later phase compares against it. The numbers aren't taken yet. An agent-launched desktop window
is always hidden, and the replay refuses a hidden window, so the runs below need the owner at the
machine with the window in front. Fill in the tables, keep this method, and date any rerun.

## Machine and method

- Host: macOS on an Apple M2 Pro with 12 CPUs, at base `32b2ab6c3`.
- Build: the debug desktop build that `pnpm dev:agent` stages, without `--vite`.
- Fixtures: `prose`, `code`, `tools`, and `agents`, which streams `prose` into three sessions at once
  ([streaming replay](../local-development/streaming-replay.md#run-one-fixture)).
- Load: none, then `--load`, which starts one busy process per CPU, 12 here
  ([load the machine](../local-development/streaming-replay.md#load-the-machine)).
- Order: run each fixture twice in each mode, alternating unloaded and loaded, so a drift in the
  machine shows as a gap between the two runs of one mode. Close other agents and builds first, and
  record each phase's `loadAverage` from the report beside its numbers.

```sh
pnpm dev:agent -- --session load-baseline --fixture streaming-replay --telemetry on --seed 1
pnpm dev:agent:ui -- --session load-baseline replay agents
pnpm dev:agent:ui -- --session load-baseline replay agents --load
pnpm dev:agent:ui -- --session load-baseline replay agents
pnpm dev:agent:ui -- --session load-baseline replay agents --load
# The same four for prose, code, and tools.
pnpm dev:agent:ui -- --session load-baseline stop
```

Read these from the `streaming` phase of each report:

| Number | Where in the report |
| --- | --- |
| Frame gap p95 and max | The `ui.frame.gap` telemetry row |
| Event loop delay p95 | The `ui.event_loop.delay` telemetry row |
| Renderer CPU | `processes.renderer.cpuPercent` |
| `ws.inbound.agent` p95 | The `ws.inbound.agent` telemetry row |
| Load average | `loadAverage` |

## Replay results

Still to be taken. One row for each run.

| Fixture | Load | Run | Frame gap p95 | Frame gap max | Event loop p95 | Renderer CPU | `ws.inbound.agent` p95 | Load average |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `agents` | none | 1 | | | | | | |
| `agents` | 12 | 1 | | | | | | |
| `agents` | none | 2 | | | | | | |
| `agents` | 12 | 2 | | | | | | |

Add the same four rows for `prose`, `code`, and `tools`.

## A day of Sentry

Still to be taken. Once a build with the new attributes has run for a working day, record these from
Sentry org `acorn-u3`, project `acorn-development`, following
[the sampling rules](../telemetry/diagnosis.md):

- `broker.queue` p50 and p95 beside `broker.request` p50 and p95, by `node.id`. Phase 2's target is a
  `broker.queue` p95 under 20 ms.
- Slow `broker.request` spans for `route:/v1/core/plugins` and `route:/v1/core/tasks`: the median and
  p95 of `queue.ms` against the span's duration, and the `pool.active` and `pool.queued` they saw.
- `ws.inbound.agent` count and sum beside `agents.frame.apply` count and sum. The gap is the reactive
  work phase 7 removes. From phase 7 the first count is drains, not frames, so compare the sums.
- `ui.stall` grouped by `inbound`, `cache.saving`, and whether an interaction was open.
