# The record model

Part of [docs/future/telemetry/](./README.md). This is the contract every seam writes to and every
sink reads from. It lives in `packages/protocol/src/telemetry.ts` (new) because batches cross the
renderer-to-node boundary from phase 1, and protocol is the one package both sides import.

## The five kinds

Every record is a flat object with a `kind` discriminator and an `attrs` map. Times are milliseconds
since the epoch; durations are milliseconds. Ids are lowercase hex, 32 characters for a trace and 16
for a span, the W3C sizes, so a `traceparent` header round-trips without conversion.

```ts
type TelemetryAttrs = Record<string, string | number | boolean | null>

type TelemetrySpan = {
  kind: 'span'; traceId: string; spanId: string; parentSpanId?: string
  name: string; start: number; durationMs: number; status: 'ok' | 'error'; attrs: TelemetryAttrs
}
type TelemetryLog = {
  kind: 'log'; at: number; level: 'debug' | 'info' | 'warn' | 'error'
  logger: string; body: string; attrs: TelemetryAttrs; traceId?: string
}
type TelemetryEvent = { kind: 'event'; at: number; name: string; attrs: TelemetryAttrs }
type TelemetryMetric = {
  kind: 'metric'; at: number; name: string; type: 'count' | 'gauge' | 'histogram'
  value: number | { count: number; sum: number; min: number; max: number; p50: number; p95: number }
  unit?: string; attrs: TelemetryAttrs
}
type TelemetryError = {
  kind: 'error'; at: number; name: string; message: string; stack?: string
  level: 'error' | 'fatal'; handled: boolean; attrs: TelemetryAttrs; traceId?: string; spanId?: string
}
type TelemetryBatch = { node: string; version: string; records: TelemetryRecord[] }
```

A histogram metric is pre-aggregated by the emitter over one flush window. That is how a seam that
fires a thousand times a second costs one record every five seconds, and it is what the `ACORN_PERF`
histograms already are (`packages/node-core/src/server/perf.ts`, folded into the collector in phase 0).

## The attribute vocabulary

Attributes are the only place a fact about one record goes. Keys are dotted, lowercase, at most 64
characters; string values at most 512; at most 32 attributes on a record; a log body at most 2,000
characters. The collector truncates rather than drops, and counts truncations as a metric so a chatty
seam is visible.

Reserved, stamped by the host, refused from an emitter:

| Key | Values | Set where |
| --- | --- | --- |
| `owner` | `core` or a plugin id | The seam that knows: the plugin host binds it into `ctx.telemetry` and `ctx.log`; the request middleware derives it from `/v2/p/<id>`; the scheduler from the schedule key; the hook runner from the handler; the client registration passes from the roster row |
| `runtime` | `node`, `renderer`, `helper`, `tui`, `shell` | Stamped on the batch by whichever runtime built it; re-stamped on arrival by the node from the principal, never trusted from the body |

Conventional, set by the seam that has the fact:

| Key | Meaning | Example |
| --- | --- | --- |
| `seam` | Which choke point emitted it | `http.request`, `schedule.run`, `hook.run`, `plugin.dispatch`, `command`, `nav.change`, `pane.region`, `git`, `sql`, `ws.frame`, `tui.frame`, `bridge` |
| `route` | The matched route pattern, never the URL | `/v2/core/tasks/:id` |
| `method`, `status` | HTTP verb and status | `GET`, `200` |
| `request.id` | The node's request id | as minted by `requestIdMiddleware` |
| `task.id` | The task a record happened for | uuid |
| `pane.id`, `pane.region` | Which pane and region | `changes`, `detail` |
| `command.id` | Which command ran | `agents.new-session` |
| `schedule.key`, `schedule.reason` | The schedule and why it ran | `github:refresh`, `due` |
| `hook.point`, `hook.handler`, `hook.outcome` | Which hook, which handler, what happened | `core:before-tool-call`, `memory:recall`, `timeout` |
| `plugin.surface` | Which frame or tree surface | `pane:rollbar-issues` |
| `error.name`, `error.code` | For records that describe an error without being one | `ApiError`, `not_found` |

An id is always an attribute and never part of a name. A span named `http.request` with a hundred
different `route` values is one row in Sentry's transaction list; a hundred span names is a hundred
rows nobody can read.

## What never leaves the machine

The list is the same as `docs/plugins.md` § What is not an event, plus what the audit trail refuses:

- Prompt text, agent output, file contents, diffs, terminal bytes.
- Request and response bodies, query text and bound values, WebSocket payloads.
- Absolute paths. The scrubber collapses the home directory to `~` and the data root to `<data>`;
  a path under a worktree is reduced to its repo-relative form or dropped.
- Credentials. The scrubber applies the token patterns already in
  `plugins/agents/src/server/drivers/diagnostics.ts` (`safeProviderMessage`), strips control
  characters, and caps the result at 2,000 characters. Core's own copy lives in
  `packages/node-core/src/server/telemetry/scrub.ts` (new) because core cannot import a plugin.
- An error message that a boundary already withholds. `onServerError` logs a name and a code because
  drivers embed bound values in `err.message`; its error record carries the same and no more.

Stacks are opt-in per record. The logger's `describeError` omits them; the crash handler and the
renderer's global handlers include them, because a fatal error with no stack is not worth sending.

## The trace model

A trace is one user action or one unattended unit. The renderer starts a trace when a command runs
or a page change starts, and every request it sends while that span is open carries a `traceparent`
header naming the trace and the span. The node's request middleware reads it, makes the request span
a child, and puts the trace on the request context so an error inside the request lands in the same
trace. When the renderer span ends, the current trace clears; a request that starts later gets a
fresh trace of its own.

Unattended work starts its own trace: a schedule run, a hook chain, a workflow run, an agent turn. In
phase 0 the trace is carried by argument at seams that already pass a context. In phase 2 one
`AsyncLocalStorage` holds `{traceId, spanId, owner}` for the node so a git spawn or a SQL statement
deep in a call stack finds its owner without every caller changing.

`traceparent` is attacker-controlled input. The parser accepts exactly the W3C form, two hex digits
of version, 32 of trace id, 16 of parent id, two of flags, and returns null for anything else. The
raw header is never echoed into a log line.

## Sampling and volume

Core does not sample. The collector holds a bounded ring (5,000 records), flushes to sinks every five
seconds or at 500 records, whichever first, and drops the oldest when full, counting drops as a
metric. A sink decides what to keep, because only it knows what its vendor bills and what the user
chose on its settings page. When no sink is subscribed and the pref is off, no record is built: every
emit verb reads one boolean and returns.
