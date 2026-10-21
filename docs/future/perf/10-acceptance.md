# Phase 10: acceptance

Date: October 21, 2026. Status: open. Phases 1 to 9 are built.

This phase checks the programme's targets with the
[streaming replay](../../local-development/streaming-replay.md) method, and closes the plan. Read
[the programme](./README.md) first.

## Steps

1. Run the replay fixtures, `agents` included, with and without `--load` on the same machine,
   alternating base and candidate. Use `32b2ab6c3`, the build from before the programme, as the base.
   Fill in [the baseline page](../../testing/window-under-load-2026-10-21.md) first.
2. Work a full week on a build with every shipped phase. Rerun the queries from
   [the programme's starting point](./README.md#starting-point) over the same seven days of the week.
   Compare busy hours with busy hours, using the same split by host load.
3. Rerun the open checks from the
   [October 14 list](../../testing/ui-performance-open-checks-2026-10-14.md) that still apply:
   renderer memory, `agents.snapshots.events`, and the session-open p95 gap.
4. Record everything in a dated page in `docs/testing/`, with both sets of numbers beside each other.

## Targets

| Measure | Before, October 14 to 21 | Target |
| --- | --- | --- |
| `ui.frame.gap.max` p95, load above the CPU count | 182 ms | under 120 ms |
| Frame gaps over 250 ms, load above the CPU count | 2.4% of windows | 0.5% or less |
| Node `runtime.event_loop.max.max` p95, same hours | 490 ms | under 150 ms |
| `broker.queue` p95 | not measured | under 20 ms |
| Core `git.status.count` a day | 39,689 | under 12,000 |
| `sql.select` windows of 250 ms or more, `agents` | 187 a week | under 20 |
| `ws.inbound.agent` spans of 100 ms or more | 1,742 a week | under 350 |
| `cache.characters.max` | 9 million | under 1 million |
| Agent pane first open p95 | 12.1 s | under 3 s |

## Close the plan

When the targets hold, or the owner accepts the gap, remove this folder. Add a row to
[the removed plans table](../README.md#completed-plans-removed) that names the reference pages each
phase updated and anything still open.
