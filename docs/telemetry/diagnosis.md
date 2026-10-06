# Diagnosis

This page covers how to use telemetry to find out why a view stopped responding or memory grew, and
what Settings → Telemetry shows. Read it when you investigate a slow or hung client. It's part of
[telemetry](../telemetry.md).

## What the page shows

Settings → Telemetry is the switch and the evidence beside it: what this Node has collected since it
started, per owner and kind, which plugins read the stream, when a batch last went to them, and how
many records were dropped. `GET /v1/core/telemetry/summary` answers it, and the page asks every five
seconds, the collector's own flush window.

It shows counters, not records. The ring is 5,000 deep and a sink may have drained it a second ago, so
a page built on the ring would show whatever the last five seconds held. Each count is one map
increment where the record is pushed. Metric counts describe records, not histogram samples. The
counts live in the collector's memory and start again with the process, and nothing persists them.

With the preference on and no sink subscribed, the page says so in those words and the count stays at
zero.

## Diagnosing an unresponsive view

The hooks tell waiting for data apart from processing it and from losing responsiveness. Collection
still needs consent. None of them add a transcript, source text, terminal output, search query, or
file path. Workload sizes are histogram values, never labels.
`telemetryFor(owner).observe(name, value, unit?, attrs?)` records a non-negative finite sample.

| Question | Hooks |
| --- | --- |
| Did the renderer stop responding? | `ui.event_loop.delay`, `ui.frame.gap`, and `ui.stall` in the focused, visible renderer. `ui.hang.suspected` and `ui.hang.recovered` come from the desktop helper. |
| Which browser phase held the interaction? | `ui.render` carries `phase.turn_ms`, `phase.frame_wait_ms`, and `phase.paint_wait_ms`. Navigation, pane-layout actions other than resize, session selection, and snapshot display opt in. |
| Which agent view was opening? | `agents.center.open`, `agents.sidebar.open`, `agents.session.open`, and `agents.subagent.open`, with outcome `ready`, `error`, `cancelled`, or `timeout` (30 seconds). |
| Why is an agent connecting slowly? | `agent.session.start`, its provider-only child `agent.session`, and `agent.session.phase`, grouped by `phase` and provider. [Session phases](../managed-agents/session-events.md#what-a-session-reports) distinguish preparation, protocol initialization, session creation, and metadata. |
| Is a task waiting for its worktree? | `task.prepare`, `task.prepare.wait`, and `task.prepare.phase`. [Task preparation](./runtimes.md#task-preparation) separates a creator from callers sharing its wait, with Git fetch, worktree creation, copy, and setup-admission phases. |
| Was the response cheap to fetch but expensive to process? | `api.request` carries `responseBytes`. `api.response.bytes` and `api.decode` measure JSON reads. |
| Is history size driving the cost? | `agents.snapshot.merge`, `agents.snapshot.index`, `agents.transcript.project`, and `agents.transcript.visible`, with counts. `agents.center.rows`, `agents.center.filter`, and `agents.sidebar.rows` cover rosters. |
| Are cheap updates repeating too often? | `agents.snapshot.load` and `agents.roster.load` tell cache hits from misses, and `resume` marks a snapshot read resumed from held events. `rows.reconcile`, `rows.item.mount`, and `pane.region.mount` count churn. `ui.interaction.work` reports up to five most frequent operations per interaction. |
| Is rendering the content expensive? | `agents.transcript.cards`, `markdown.parse`, `markdown.render`, `highlight.html.render`, `diff.segments.load`, `diff.segments.enrich`, `diff.segments.requested`, and `editor.language.load`, `editor.state.create`, and `editor.view.create`. |
| Does a large diff or timeline work in proportion to its size? | `ui.surface.*`, and the local snapshot in [surface health](./surface-health.md). |
| Is a worker falling behind or falling back? | `highlight.pending`, `highlight.queue.wait`, `highlight.worker.execute`, `highlight.timeout`, `highlight.result`, `highlight.fallback`, and `highlight.main_thread`. |
| Is the client cache responsible? | `cache.read`, `cache.deserialize`, `cache.serialize`, `cache.write`, `cache.dehydrate`, and `cache.restore_to_hydrated`. `cache.updates` labels only the query-cache action, never a key. |
| Is a plugin flooding the UI? | `tree.apply`, `tree.queue.wait`, `tree.batch.operations`, `tree.batch.merged`, `tree.nodes`, and `tree.batch.refused`, by owning plugin. |
| Is terminal output flooding its parser? | `terminal.output.size`, `terminal.pending.size`, `terminal.write`, and `terminal.fit`. |
| Is the Node or helper under pressure? | `runtime.event_loop.p95`, `.max`, and `.utilization`, `runtime.cpu`, `runtime.memory.rss`, `runtime.memory.heap`, and `runtime.suspended`. |
| Where is the memory going? | [Memory over a day](#memory-over-a-day). |

A measured client operation of at least 100 ms can also produce a detailed span under its original
interaction, up to 20 per flush. Histograms keep every sample past that cap. These are inclusive
timings, not CPU profiles, so don't add overlapping durations together.

`ui.render` is smaller than a profiler. It makes one span for a deliberate state transition and adds
no global observer, DOM walk, or component instrumentation. Outside an open interaction it's inert, and
pane resizing is excluded because it fires on every pointer move. `ui.render.batch` folds repeated
synchronous factories with one owner and operation in one turn into one span. Its `work.ms` sums time
inside the factories, and `wall.ms` includes other work up to the microtask checkpoint.

The Node and the helper share one runtime pressure sampler,
`packages/node-core/src/server/telemetry/runtimePressure.ts`, over a five-second window. On macOS the
monotonic clock runs while the machine sleeps, so a sleep reaches the delay histogram as one long
stall. Only running code can hold the event loop, so a window whose longest delay exceeds its active
time by more than a second, or whose idle time runs a second past the interval, counts as a suspend.
It reports `runtime.suspended` instead of the delay, utilization, and CPU numbers it would distort.

The desktop's responsiveness pulse crosses the platform seam and the helper socket once a second while
the window is focused and visible, and at once when the interaction changes. The helper keeps the last
interaction with `contextAgeMs` and `operationActive`. It reports once after five seconds without a
pulse, and reports recovery if one returns. Blur, a hidden window, consent revocation, a closed socket,
or a helper timer gap over five seconds disarms it. A suspected hang can also mean a delayed local
transport, so it's a lead rather than proof of a deadlock, and the helper can't recover a blocked
renderer's stack.

To investigate:

1. Select the affected release and runtime, and find `ui.hang.suspected` or `ui.stall`.
2. Follow the recorded interaction trace.
3. Compare API time with decode, merge, projection, row mounting, and highlighting.
4. Check workload counts and `ui.interaction.work` before assuming one operation is slow.
5. Compare runtime pressure and queue age when several surfaces degrade together.

A frame gap is a paint-opportunity measurement, not proof the compositor presented pixels. Collection
that's off during startup doesn't measure cache hydration after the fact. The boot account is the
exception: its marks are kept and sent once collection turns on.

### Find slow connections in Sentry

In **Traces**, filter `span.op:agent.session.start` and sort duration descending. Open a slow trace,
then compare `agent.session` with `agent.session.phase`. Filter `span.op:agent.session.phase` and group
by `phase` and `provider` to find a recurring slow stage. Parallel metadata durations overlap.

For task delays, filter `span.op:task.prepare` or `span.op:task.prepare.wait`. Follow the requesting
HTTP route and the creator's phase spans. A long `setup.admit` does not measure the setup script's
whole execution. Client cache processing retains its `cache.serialize` and `cache.dehydrate`
histograms, with detailed spans for slow operations under the interaction that scheduled the save.

Automatic session selection restoration raises no additional opening span. The mounted conversation
owns its content-to-paint timing, avoiding an unclaimed second span that times out after 30 seconds.

## Memory over a day

The desktop renderer is the WebKit web content process, and most of what it holds is WebKit's memory,
not the page's heap. The page can't read that process, so these gauges come from three places and are
read against each other. Each keeps its name in Sentry with no suffix.

| Metric | Unit | Attributes | Rate | Where |
| --- | --- | --- | --- | --- |
| `runtime.memory.footprint` | bytes | `runtime: renderer` | 30 s | The shell reads the main window's web content process. macOS only |
| `runtime.memory.footprint` | bytes | `runtime: helper` | 30 s | The shell reads the helper's process. macOS only |
| `ui.page.elements` | count | `runtime: renderer` | 30 s, visible window only | `document.getElementsByTagName('*').length` |
| `ui.page.timeline_turns` | count | the same | the same | Drawn timeline turns |
| `ui.page.query_entries` | count | the same | the same | Query cache entries for the active Node |
| `ui.page.diff_cache.rows`, `.bytes` | count, bytes | the same | the same | The active Node's diff segment cache, by its own estimate |
| `ui.page.workers.tree`, `.highlight`, `.word_diff` | count | the same | the same | Live plugin tree workers, and the highlighter and word-diff workers |
| `agent.processes.live`, `.idle` | count | `runtime: node`, `owner: agents` | 60 s | Provider processes, and those the idle rules would stop |
| `agent.processes.memory` | bytes | the same | 60 s | Resident bytes over each provider's process tree. Left out when `ps` fails |

The footprint is the physical footprint, which Activity Monitor's Memory column shows. Resident size
undercounts on macOS because compressed pages leave it, so the footprint and `runtime.memory.rss` are
different measures. The Node has no footprint, because only the shell can read one. The shell looks up
the web content process's pid on every sample, so a replaced renderer is measured under its new pid.
Off, each gauge costs one boolean read per tick.

## Deliberate limits

- No session replay, because the screen holds source code, diffs, transcripts, and terminal output.
- No uptime pings, because a sleeping laptop is normal for a local Node.
- No profiler until a slow request or render can't be attributed with spans and histograms.
- No OpenTelemetry SDK or automatic monkey-patching in core. An exporter is a plugin.
- No telemetry on the WebSocket, no general topic model, and no durable SQLite queue. The audit trail
  is the durable record.
- No per-keystroke feeds. Key dispatch and paint report aggregate histograms.
- One Node switch, off by default, rather than per-signal consent in core.
