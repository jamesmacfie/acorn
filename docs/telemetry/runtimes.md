# Telemetry runtimes

This page covers the Node's collector, how records get an owner without threading one through every
call, the Node's seams, and how the terminal client, helper, and shell report. Read it before you add a
Node seam or change how another runtime posts. It's part of [telemetry](../telemetry.md). The renderer
has [its own page](./renderer.md).

## The collector

`packages/node-core/src/server/telemetry/collector.ts` is a module singleton, like the WebSocket hub's
channel slots, because the seam that makes the most records is module-level middleware with nowhere
to receive a handle. The Node is the only collector, and every other runtime posts to it.

It holds a ring of 5,000 records and hands them to every sink when the ring reaches 500 or every five
seconds, whichever comes first. Past 5,000 it drops the oldest and counts the drop as
`telemetry.dropped`. A flush at the record cap runs on a microtask, not where the record was emitted,
so a slow sink never adds latency to the request it describes. The collector doesn't sample. Only a
sink knows what its vendor bills for.

### Never fail what you measure

The audit trail lives by the same rule. Every emit is wrapped, so a throw inside instrumentation can't
reach the instrumented code. A sink that throws or rejects is contained, and the next sink still gets
the batch. A scrubber handed something whose `toString` throws answers with a fallback string.

## Ambient attribution

`packages/node-core/src/server/telemetry/context.ts` holds one `AsyncLocalStorage` carrying
`{ traceId, spanId, owner }`, the only async-local store in the codebase. `core/git.ts` and
`storage/sqlite.ts` are reached from every route, schedule, and plugin, and know nothing about their
caller. Without the store their histograms would all say `owner: core`. Four seams enter it:

| Seam | Enters with |
| --- | --- |
| `requestIdMiddleware` | The request's trace, and `core` or the plugin whose namespace the path is in |
| `dispatchPluginRoute` | The dispatch span, and the plugin being dispatched to |
| The scheduler's `#runOnce` | The run's span, and the owner from the key prefix |
| The hook runner's `callOne` | The chain's trace, the handler's span, and the handler's plugin |

The precedence is explicit, then ambient, then `core`. Every emit verb takes the owner first, and
`'core'` is the "nothing better to say" spelling the store may answer for. A plugin's `ctx.telemetry`
always passes its own id, so a plugin never inherits another owner from the stack.

`measure` and `recordDuration` resolve the owner from the store. `startSpan` hangs its span under the
ambient one, so a tool call during a request is a child of that request. `emitLog` and `emitError`
take the ambient trace when the caller names none. A histogram takes the owner and not the trace,
because a trace id differs on every sample and would mint a series per call.

With telemetry off the store is never entered: `runWithTelemetry` reads the switch first and calls
straight through. On, entering it cost about 0.3 microseconds per request and reading it about 8
nanoseconds, measured on September 11, 2026.

## Node seams

| Seam | Where | What it emits |
| --- | --- | --- |
| Every HTTP request | `server/respond.ts` `requestIdMiddleware` | Span `http.request` with method, route pattern, status, bytes, and request id. Reads `traceparent`. Adds `client.gone: true` when the caller closed the connection before the handler finished |
| Every uncaught route error | `server/respond.ts` `onServerError` | An error with a name and a code, no message or stack |
| Every scheduled run | `server/schedules/scheduler.ts` | Span `schedule.run`, owner from the key prefix, with the period and timeout in milliseconds |
| Every hook handler | `server/pluginHost/hooks.ts` | Span `hook.run`, owner from the handler's registration |
| Every plugin route dispatch | `server/pluginHost/dispatch.ts` | Span `plugin.dispatch`, owner from the plugin dispatched to |
| Every background refresh failure | `server/background.ts` | A handled error naming the resource, never the account |
| Every Git spawn | `server/core/git.ts` | Histogram `git.<subcommand>` |
| Every SQL statement | `server/storage/sqlite.ts` | Histogram `sql.<verb>` |
| Every process spawn | `server/core/proc.ts` | Histogram `proc.spawn` with the binary's base name. Events `proc.timeout` and `proc.truncated` |
| Every measured call of 100 ms or more | `server/telemetry/collector.ts` `measure()` | A span named for the seam with `slow: true`, under the ambient trace, up to 20 per flush window ([hot seams](./model.md#hot-seams-are-metrics)) |
| Every wait of 10 ms or more for a repository | `server/core/checkoutAdmission.ts` | Span `checkout.admission.wait` under the waiting request, owner from the ambient store |
| Every serve-then-revalidate decision | `server/sync/engine.ts` | Count `sync.fresh`, `sync.stale`, or `sync.cold` with the resource |
| Every outbound WebSocket frame | `server/transport/wsHub.ts` | Histogram `ws.frame` with the channel prefix. Event `ws.shed` when a socket falls behind |
| Every agent tool call | `server/routes/plugins/agentTools.ts` | Span `tool.call`, owner from the plugin that contributed the tool |
| Every tool availability check | `server/routes/plugins/agentTools.ts` `available()` | Span `tool.availability` with `tool` and `available`, owner from the contributing plugin, once per check per request |
| Every archive dialog check | `server/pluginHost/taskChecks.ts` | Span `task.check` with `check` and `outcome`, owned by the plugin |
| Task archiving | `server/storage/archive.ts` | Span `task.archive` with `task.id`, and `task.archive.phase` children ([task archiving](#task-archiving)) |
| Task worktree preparation | `server/worktrees/taskWorktree.ts`, `worktrees.ts` | Spans `task.prepare`, `task.prepare.wait`, and `task.prepare.phase` ([task preparation](#task-preparation)) |
| Every audit row | `server/audit.ts` | Event `audit.<action>` with the actor and none of the row's details |
| Uncaught exception or rejection | `apps/node/src/composition/crash.ts` | A fatal error with its stack, then exit 1 |
| Runtime pressure | `server/telemetry/runtimePressure.ts` | Event loop, CPU, and memory gauges every five seconds, with the host's `host.load.1m`, `host.memory.free`, and, on macOS once a minute, `host.swap.used` ([diagnosis](./diagnosis.md#is-it-acorn-or-the-mac)) |
| The Node's boot, once per launch | `apps/node/src/composition/bootTimer.ts` | Span `node.boot` with a `node.boot.mark` child per boot mark, carrying `mark` ([Node boot](./node-boot.md)) |
| The app's shipped bytes, once per launch | `server/telemetry/installedBytes.ts` | Gauges `app.startup.bytes` and `app.bundle.bytes` ([shipped bytes](#shipped-bytes)) |
| Console lines | Everywhere under `packages/node-core/src` and `apps/node/src` | Log records ([logging](./logging.md)) |

Git and SQL histograms take their owner from the ambient store. A loaded plugin's HTTP routes need
nothing extra, because the request span already names the plugin from `/v1/p/<id>/`.

Every Node span carries `suspended`, true when the runtime pressure sampler saw the process suspended
between the span's start and its end ([sleep and hidden windows](./diagnosis.md#sleep-and-hidden-windows)).

Plugins add their own spans through `ctx.telemetry`:

| Span | Plugin | What it carries |
| --- | --- | --- |
| `agents.usage.collect` | agents | One harness account's plan usage read, with `provider`, the account's folder name as `account`, and `outcome` |
| `agents.usage.wait` | agents | A usage read waiting on another read's refresh |
| `github.api`, `linear.api`, `rollbar.api` | github, linear, rollbar | One API call, with `method`, `status`, and an `operation` from a fixed list. Never the URL or the query. A GitHub call adds `ratelimit.low: true` when under 10% of its rate limit is left |

### Task preparation

`task.prepare` measures a task's worktree preparation attempt, including file copying and setup
admission. It carries `task.id` and `shared: false`. A caller joining an in-flight preparation raises
`task.prepare.wait` with the same task ID and `shared: true`, in that caller's trace. Cached roots
produce neither span.

Child `task.prepare.phase` spans label `git.fetch`, `git.worktree.add`, `worktree.validate`,
`files.copy`, or `setup.admit`. The setup phase waits for hook admission, not script completion.
Each phase retains the requesting plugin's owner and enters the ambient trace, so hook spans nest
under preparation. Git command errors mark their phase as failed even when the resolver converts
the error into a worktree-unavailable result. Paths, branch names, commands, and file contents stay
out of these attributes.

Compare the request's `route` and `owner` with preparation spans to find availability checks that
trigger worktree creation. Use `task.id` to connect shared waiters to the creator when Sentry's task-ID
setting allows it. Git and process histograms remain aggregated across traces.

Installing a crash handler changes what Node does. With any `uncaughtException` listener registered,
Node stops printing the stack and stops exiting, so `installCrashHandlers` does both itself, with one
flush in between and a one-second window for asynchronous sinks. A crash must not become a hang
because an exporter waits on a socket. It's installed from the two process entries, not from
`startServiceRuntime`, which a test boots three times in one process.

### Task archiving

`task.archive` covers one archive request, including its subtasks, and ends `error` when the archive
refused or failed. Each step that ran is a `task.archive.phase` child labelled by `phase`:

| Phase | What it waits for |
| --- | --- |
| `admit.wait` | The repository's admission queue |
| `worktree.wait` | A worktree creation still in progress for the task |
| `teardown` | The project's teardown script. Ends `error` on a non-zero exit |
| `hooks` | The `core:task-archiving` hook chain |
| `checks` | The plugin cleanups the owner ticked. Ends `error` when one failed |
| `worktree.aside` | Moving the worktree out of the way. Ends `error` when Git refused |
| `sessions.drop` | Stopping the task's terminal sessions |
| `worktree.discard` | Deleting the set-aside worktree |

## Shipped bytes

The desktop build writes `helper/size-report.json` with `apps/desktop/scripts/size-report.mjs`
([profiling](../local-development/profiling.md#measuring-shipped-bytes)). A minute after the Node
boots, `server/telemetry/installedBytes.ts` reads that report and emits byte gauges with unit `byte`:

| Gauge | `method` | One per |
| --- | --- | --- |
| `app.startup.bytes` | `build` | Runtime and phase from the report: `startup.runtime` is `renderer`, `node`, or `tui`, and `phase` is `startup` or `registration` |
| `app.bundle.bytes` | `build` | Component as the build counted it, with `artifact: 'build'` |
| `app.bundle.bytes` | `walk` | Component as installed on this machine, with `artifact: 'installed'` |
| `app.bundle.bytes` | `stat` | The bundled Node executable, as `component: 'native-runtime'`, in a packaged app only |

Every gauge carries `release`, `platform`, `arch`, and `installation`, which is `packaged` or
`development`. `complete: false` marks a build that missed a component, or a walk that hit its limit
of 200,000 files or 32 levels. The walk stays under the resource root, follows no symlink, and skips
the data root, `.git` folders, source maps, and the report itself.

Only the desktop app reports, because only it hands the Node a resource directory, as the parent of
`bundledPluginsDir`. With telemetry off, the Node checks again every ten minutes until it has reported
once. Compressed installer sizes aren't here. CI's packaging run writes them to
`dist/release-size-report.json`, which you join to these gauges by `release`.

## Other runtimes

`POST /v1/core/telemetry` is where every runtime that isn't the Node posts its batches
(`server/routes/telemetry.ts`). It's device-only, because everything admitted there reaches every sink
and a sink can send it off the machine.

The body is `{ runtime, records }`. The Node stamps `runtime` from the batch onto every record, scrubs
each log body, error message, and stack again, and applies its own attribute caps. `runtime` can't
say `node`, because a posted batch that could claim it would look like the Node's own at a sink.
`owner` comes from the record, because only the emitting runtime knows which pane or frame caused it.
A batch is refused whole for one malformed record, and refused over a mebibyte. When nothing collects,
the route answers `202` with `{ accepted: 0 }`, and the sender stops when it next reads the preference.

| Runtime | Emitter | How a batch leaves | What it adds |
| --- | --- | --- | --- |
| Terminal client | client-core's, with `runtime: 'tui'` | client-core's poster, over the platform seam | `tui.frame` and `tui.key` histograms, a `tui.boot` span, and the renderer seams it shares |
| Desktop helper | The Node's collector, in the helper's process | Its own poster, over the broker with the device token | `helper.boot` spans, `broker.*` health, `node.crash`, and its log lines |
| Rust shell | None. A panic hook writes a file, and the helper asks for memory numbers | The helper forwards the file on the next boot, and posts the numbers when they arrive | One fatal error with `runtime: shell`, and the renderer's and helper's `runtime.memory.footprint` |

[What the terminal client reports](../tui/reporting.md#what-the-terminal-client-reports) and
[what the helper reports](../shell/node-child.md#what-the-helper-reports) own the detail.

The terminal client runs client-core in process, so it reuses the renderer's emitter and changes only
the poster. The helper already depends on `@acorn/node-core`, so it reuses the collector. The terminal
client also holds custody, so both emitters are on its startup graph, about 13 KB of collector it can't
collect with, and the seams inside custody report in the helper and nowhere in the terminal.

The helper has no database, so it asks for the preference over the broker once a minute while off.
While on, the collector's five-second tick joins that read
(`packages/custody/src/telemetry.ts`). Each helper request captures its Node at admission, and an
adoption change or consent revocation cancels only that generation's requests and discards its queue.
A failed post retries only failed and unattempted batches, up to 500 held records, and re-enabling
can't replay an earlier consent window. Requests have a ten-second deadline. Disposal attempts the
final buffered window once, with a five-second deadline, and failed final delivery never restores a
queue.
