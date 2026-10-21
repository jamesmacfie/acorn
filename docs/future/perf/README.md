# Keep the window responsive under load

Date: October 21, 2026. Status: phases 1 to 9 built October 21 and 22, 2026, and their plans removed.
Acceptance, in [phase 10](./10-acceptance.md), and the work listed under [still open](#still-open)
remain.

This programme makes the desktop window answer input and show data sooner, most of all while the
machine is busy with agents and builds. The reference pages below own what shipped. This page keeps
the starting numbers that acceptance compares against, and the work that's left.

## What shipped

| Phase | What changed | Owner |
| --- | --- | --- |
| 1 | `--load` and the `agents` fixture for the replay harness. Telemetry for the helper's queue wait (`broker.queue`), frame size, interaction work, and what ran during a stall. | [Streaming replay](../../local-development/streaming-replay.md), [diagnosis](../../telemetry/diagnosis.md), and [the baseline page](../../testing/window-under-load-2026-10-21.md), whose tables are still empty |
| 2 | 16 sockets per loopback Node and 6 per remote one, a separate pool of four for long requests, a deadline that starts at the socket, one retry and never after a timeout, and no reads to an offline Node. | [Connection broker](../../shell/bridge-and-broker.md#connection-broker) |
| 3 | One batched scripts read for the rail, status reads for the tasks on screen only, Docker's last list served at once, and no refetch on window focus by default. | [Renderer query cache](../../caching.md#renderer-query-cache), [task script snapshots](../../caching.md#task-script-snapshots), [schedules](../../schedules.md), and [Docker](../../docker.md) |
| 4 | Agents at nice 5. Background Git, Docker polls, and setup and teardown scripts at nice 10. | [Process and paths](../../security/process-and-paths.md) and [agent operations](../../managed-agents/operations.md) |
| 5 | The command settle, `#session` references, the usage source, record triggers, dataset pages, and the trigger list read through indexes or read less. | [Storage and memory](../../managed-agents/operations.md#storage-and-memory), [data layer](../../data-layer.md), and [triggers](../../workflows/triggers.md) |
| 6 | Reads of an existing worktree skip checkout admission, and creation holds the queue only around `git worktree add`. | [Worktrees](../../workspaces-and-tasks/worktrees.md) |
| 7 | Agent frames apply once per animation frame, and each session has its own signal. | [The transcript store](../../managed-agents/transcript-store.md) |
| 8 | Markdown fences highlight in the worker, the cache persists an allowlist, and the composer, rail, dashboards, apps, and hidden terminals do less on the main thread. | [Persisted query cache](../../caching/persisted-query-cache.md), [Markdown renders block by block](../../ui-design/kit-internals.md#markdown-renders-block-by-block), [composer](../../managed-agents/composer.md), [rail and routing](../../frontend/rail-and-routing.md), [views](../../dashboards/views.md), [app runtime](../../agent-built-apps/runtime.md), and [the terminal client](../../terminal/client.md) |
| 9 | Each dashboard panel draws on its own and reads its sources together. The editor draws kept text first. The composer reuses its context, and a reply's first chunk goes out at once. Cold starts prepare in parallel, and usage answers from its last snapshot. | [Placements](../../dashboards/placements.md), [the editor pane](../../editor/editor-pane.md), [the transcript store](../../managed-agents/transcript-store.md), and [plan usage](../../managed-agents/providers.md#plan-usage) |

## Still open

- **Measurements.** No replay under `--load` has run, because an agent-launched window is hidden and
  the replay refuses it. No week of Sentry has been read. [Phase 10](./10-acceptance.md) owns both.
- **The paged transcript.** The Agent pane still pages a whole transcript before it draws. Reading the
  newest page first needs a design for a projection that doesn't start at the first event: tool cards
  whose opening row is missing, card counts, and the scroll when older pages arrive. It's the change
  most likely to move the 12.1 s first open.
- **Cold starts in the shared queue pass.** `queueCoordinator.ts` still awaits each cold start inside a
  pass shared by the whole Node. Moving it out needs a record of failed starts that outlives one scan,
  or a failed start retries in a loop.
- **Launch restore.** `App.tsx` still waits for this launch's prefs read, because restoring from the
  cached copy opened the wrong place after a quick quit. Measure `renderer.startup.usable` first.
- **Agent events only to viewers that hold the session.** The `agent:attach` and `agent:detach`
  protocol change is built only if `ws.inbound.agent` stays above target. It would go in the Node's
  `sessionFrames.ts`, with a reattach hook in `wsChannels.ts`.
- **A pushed `task-scripts:changed` frame.** The rail polls its one batched read every 15 seconds. A
  frame with a 60-second backstop needs a protocol change.
- **The first boot after the upgrade.** Migration `0022` builds two partial indexes over every agent
  event, about 830,000 on the owner's machine. Watch that boot's `migrate` mark.
- **The read worker.** A second, read-only `DatabaseSync` in a worker for data sources, search,
  export, and usage stays an option if a read still passes 250 ms.

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

## Out of scope

- Agent processes' own memory. They peaked at 13 GB on October 21, against 8 GB on October 13, and
  swap explains part of the load. [Idle stop](../../managed-agents/operations.md#idle-stop) owns
  that. Revisit its 4 GB limit separately.
- Shrinking `agents.sqlite`. The programme's reads use indexes and don't change storage.
- The remote preview proxy, which shares the broker's sockets.
  [The split programme](../split/10-remote-preview-proxy.md) owns it.
- Cold launch work the October 19 perf plan finished. Phase 9 touches launch only where restore waits
  on a fresh prefs read.
