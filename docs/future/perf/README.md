# Keep the window responsive under load

Date: October 21, 2026. Status: phases 1 to 9 built on October 22, 2026. None of the targets below
is measured yet, and phase 10 is open. Each phase's completion note says what it built, what it left,
and what still needs the owner's machine.

This programme makes the desktop window answer input and show data sooner, most of all while the
machine is busy with agents and builds. It covers the helper's connection to the Node, background
polling, process priority, blocking work on the Node, and long tasks in the renderer. Read this page
before you pick up a phase.

## What the programme delivers

At the end, these hold on the owner's machine over a working week, measured in Sentry and with the
load test from phase 1:

- A fast Node route reaches the renderer within 50 ms of the Node answering it, even while long
  requests are in flight. No renderer read times out while it waits for a connection.
- Background polling scales with what's on screen, not with the number of tasks.
- Agents, builds, and polls run at a lower CPU priority than the window, the helper, and the Node.
- No single synchronous SQLite statement on the Node runs longer than 250 ms on the owner's data.
- An agent's socket frames are applied at most once per animation frame, and no code highlighting
  runs on the main thread.
- The persisted query cache holds what the first frame needs, under 1 million characters.

These targets are proposed. The owner confirms or changes them once phase 1 has the loaded baseline:

- `ui.frame.gap.max` p95 under 120 ms while the host load is above the CPU count, against 182 ms.
- Windows with a frame gap over 250 ms under load at 0.5% or less, against 2.4%.
- Node `runtime.event_loop.max.max` p95 under 150 ms under load, against 490 ms.
- First Agent pane open p95 under 3 s, against 12.1 s.

## Starting point

Read on October 21, 2026, at `b941379bc`. Sentry org `acorn-u3`, project `acorn-development`, from
October 14 to 21. Every number is from the owner's dev app. Follow
[the sampling rules](../../telemetry/diagnosis.md) before you compare.

**The machine is often overloaded, and the window suffers most then.** It has 12 CPUs. The one-minute
load was above 12 in 17.7% of Node samples, with a p95 of 34.9 and a peak of 299. Swap averaged
16.9 GB. In the six busiest hours against twelve quiet ones:

| Measure | Busy hours | Quiet hours |
| --- | --- | --- |
| `ui.frame.gap.max` p50, p95, p99 | 46, 182, 398 ms | 28, 104, 134 ms |
| Windows with a frame gap over 250 ms | 2.4% | 0.1% |
| Node `runtime.event_loop.max.max` p50, p95 | 69, 490 ms | 26, 106 ms |
| `agent.processes.live` p50 | 5 | 2 |

**Most of the UI's waiting is in the helper, not the Node.** The helper allows four sockets to each
Node, and its 30 s deadline counts time spent waiting for one. In one `agents.sidebar.open`, trace
`daa37e1b4d108e0edfc0dd661d8e99a4`, the Node answered 117 task reads in 0 to 80 ms each, and the
renderer saw 1.1 to 3.2 s. During a busy stretch on October 21, `/v1/core/plugins` took 57 ms at the
median on the Node and 2.5 s in the renderer.

**Background polls fill those four sockets.** The rail reads each visible task's scripts every 15 s.
The task status refresh runs `git status` in every active worktree every 10 s, and again on every
`agent-session:changed` frame. Core `git.status.count` reached 39,689 a day, against 11,656 on
October 13. A paired Node that went away, `8398d286`, was still polled and timed out about 4,200
times at 30 s each.

**The Node's loop stalls on SQLite.** Over the week, 187 five-second windows held an `agents`
`sql.select` of 250 ms or more, up to 4.26 s, and 77 held a `core` one, up to 4.66 s. On October 21,
from 02:20 to 02:40 UTC, the Node's loop stalled for up to 3.9 s with utilization at 0.95.

**Background work stalls the renderer.** Of 128 `ui.stall` logs, 120 came with no interaction open.
`ws.inbound.agent` ran 100 ms or more 1,742 times, with a p95 of 808 ms. `highlight.html.render` ran on
the main thread for up to 1,051 ms, once inside a 1,471 ms navigation. The persisted cache grew to
9 million characters, against 1.9 million on October 13, and saves 2,861 times a day.

**Opening things is slow at the tail.** The Agent pane's first open had a p50 of 1.5 s and a p95 of
12.1 s, the editor's a p95 of 8.8 s, and the pull request pane's a p95 of 7.8 s.
`renderer.startup.usable` had a p50 of 1.8 to 2.7 s over 29 visible launches, against 1.3 s on
October 13. `/v1/p/agents/usage` took 8.4 s at the median.

## The phases

| Phase | What changes |
| --- | --- |
| [1](./01-measure-under-load.md) | A load test for the replay harness, and the telemetry that splits queue time from work. |
| [2](./02-helper-connections.md) | The helper stops queuing fast reads behind slow ones, and stops polling a dead Node. |
| [3](./03-fewer-background-reads.md) | Rail, status, and Docker polling scale with the screen, and focus stops refetching everything. |
| [4](./04-process-priority.md) | Agents, task scripts, and background polls run at a lower CPU priority than the window. |
| [5](./05-node-sqlite-stalls.md) | The SQLite reads that stall the Node's loop use their indexes, or read less. |
| [6](./06-checkout-admission-reads.md) | Reads of an existing worktree stop waiting behind another task's Git writes. |
| [7](./07-agent-frames.md) | Agent frames are applied once per animation frame, and each session wakes only its readers. |
| [8](./08-main-thread-work.md) | Code highlighting, cache saves, typing, the rail, dashboards, and hidden terminals do less on the main thread. |
| [9](./09-faster-opens.md) | The Agent pane, dashboards, the editor, the composer, and launch draw before every read finishes. |
| [10](./10-acceptance.md) | The load test and a working week in Sentry, compared with phase 1. |

## Order and dependencies

Phase 1 comes first and is small. Every later phase compares against it.

Phases 2 and 3 have the largest measured effect, and they help each other. Phase 2 lets fast reads
through, and phase 3 sends fewer of them. Do 2 before 3, so the drop in queue time shows separately
from the drop in requests.

Phase 4 needs nothing else. It targets the busy-machine case directly, so ship it soon after phase 1.

Phases 5 and 6 are on the Node and can run beside phases 7 and 8 in the renderer. Phase 9 comes after
phase 2, because many of its waits are queue waits that phase 2 removes. Measure again before you
build each part of it. Phase 10 comes last.

## What holds across every phase

- Measure before and after with the same method, and record both. A change with no measured gain gets
  reverted.
- Compare a visible window with a visible window. A `pnpm dev:agent` window is hidden unless the
  replay harness shows it, so use a hidden one for counts, not for times.
- A request that waits less must not answer differently. Freshness rules, write ordering, and the
  data a reader sees stay as they are unless the phase says otherwise.
- Persisted data keeps its shape, or gets a migration in the same change.
- New spans and attributes follow
  [the admission rule](../../telemetry/model.md#the-admission-rule-for-a-span), and each updates its
  seams table in the same change.
- When a phase ships, document the behavior in its owning page and trim the phase here.

## Out of scope

- Agent processes' own memory. They peaked at 13 GB on October 21, against 8 GB on October 13, and
  swap explains part of the load. [Idle stop](../../managed-agents/operations.md#idle-stop) owns
  that. Revisit its 4 GB limit separately.
- Shrinking `agents.sqlite`. Phase 5 adds reads that use indexes. It doesn't change storage.
- The remote preview proxy, which shares the broker's sockets.
  [The split programme](../split/10-remote-preview-proxy.md) owns it.
- Cold launch work the October 19 perf plan finished. Phase 9 touches launch only where restore waits
  on a fresh prefs read.

## Why

Two earlier programmes cut payloads and Git calls, and the October 13 targets mostly held. The window
still feels slow, because the remaining time sits in queues and on a shared CPU. The four-socket
queue turns a 10 ms read into a 3 s one, and nothing in the repository sets a process priority, so a
build at load 30 competes with the window as an equal. Fixing those two gains more than any single
faster query. The rest of the programme removes the work that fills the queue and the main thread.
