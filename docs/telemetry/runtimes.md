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
| Every HTTP request | `server/respond.ts` `requestIdMiddleware` | Span `http.request` with method, route pattern, status, bytes, and request id. Reads `traceparent` |
| Every uncaught route error | `server/respond.ts` `onServerError` | An error with a name and a code, no message or stack |
| Every scheduled run | `server/schedules/scheduler.ts` | Span `schedule.run`, owner from the key prefix, with the period and timeout in milliseconds |
| Every hook handler | `server/pluginHost/hooks.ts` | Span `hook.run`, owner from the handler's registration |
| Every plugin route dispatch | `server/pluginHost/dispatch.ts` | Span `plugin.dispatch`, owner from the plugin dispatched to |
| Every background refresh failure | `server/background.ts` | A handled error naming the resource, never the account |
| Every Git spawn | `server/core/git.ts` | Histogram `git.<subcommand>` |
| Every SQL statement | `server/storage/sqlite.ts` | Histogram `sql.<verb>` |
| Every process spawn | `server/core/proc.ts` | Histogram `proc.spawn` with the binary's base name. Events `proc.timeout` and `proc.truncated` |
| Every serve-then-revalidate decision | `server/sync/engine.ts` | Count `sync.fresh`, `sync.stale`, or `sync.cold` with the resource |
| Every outbound WebSocket frame | `server/transport/wsHub.ts` | Histogram `ws.frame` with the channel prefix. Event `ws.shed` when a socket falls behind |
| Every agent tool call | `server/routes/plugins/agentTools.ts` | Span `tool.call`, owner from the plugin that contributed the tool |
| Every audit row | `server/audit.ts` | Event `audit.<action>` with the actor and none of the row's details |
| Uncaught exception or rejection | `apps/node/src/composition/crash.ts` | A fatal error with its stack, then exit 1 |
| Runtime pressure | `server/telemetry/runtimePressure.ts` | Event loop, CPU, and memory gauges every five seconds ([diagnosis](./diagnosis.md)) |
| Console lines | Everywhere under `packages/node-core/src` and `apps/node/src` | Log records ([logging](./logging.md)) |

Git and SQL histograms take their owner from the ambient store. A loaded plugin's HTTP routes need
nothing extra, because the request span already names the plugin from `/v1/p/<id>/`.

Installing a crash handler changes what Node does. With any `uncaughtException` listener registered,
Node stops printing the stack and stops exiting, so `installCrashHandlers` does both itself, with one
flush in between and a one-second window for asynchronous sinks. A crash must not become a hang
because an exporter waits on a socket. It's installed from the two process entries, not from
`startServiceRuntime`, which a test boots three times in one process.

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

[What the terminal client reports](../tui.md#what-the-terminal-client-reports) and
[what the helper reports](../shell.md#what-the-helper-reports) own the detail.

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
