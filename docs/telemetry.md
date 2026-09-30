# Telemetry

Five kinds of record, one switch that is off by default, and a stream a plugin can subscribe to and
ship anywhere. Every record says which plugin or which piece of core caused it, so "why is this
slow" and "whose fault is this" are one query rather than a bisect.

This document owns the model, the switch, the collector, and what a sink sees.
[plugin-authoring.md](./plugin-authoring.md) § Telemetry and logging owns what a plugin author
writes. [security.md](./security.md) § Telemetry sinks owns why the read token is high.
[local-development.md](./local-development.md) § Timing a cold start owns the `ACORN_PERF=1`
developer switch that prints to a terminal instead.

The node is the only collector. Every other runtime collects and posts what it collects to the
node: the renderer, the terminal client, the desktop helper, and the Rust shell through the helper.
[tui.md](./tui.md) § What the terminal client reports and [shell.md](./shell.md) § What the helper
reports own the two that are not the renderer's.

## The switch

One node preference, `telemetry.enabled`, off unless the row reads `'1'`. Off costs one boolean read
at each seam and builds no record at all.

Collection needs two things at once: the preference on, and at least one sink subscribed. Neither
alone does anything, which is what makes "nothing leaves this machine that you did not agree to"
true by construction rather than by care. With no sink there is no timer and no database read.

The collector re-reads the preference on its own five-second tick rather than being told, because
`PUT /v1/core/prefs` writes the table directly and has nothing to notify. A switch flipped in
Settings is seen within five seconds. The tick reads consent before handing over its buffered
window; observing off discards pending records and histograms.

`ACORN_PERF=1` is the third way in. It turns the collector on with no sink and no preference, and
prints to stderr. That is a developer at a terminal, not an export.

## The five kinds

Every record is a flat object with a `kind` and an `attrs` map, declared in
`packages/protocol/src/runtime/telemetry.ts`. Times are milliseconds since the epoch and durations are
milliseconds. Ids are lowercase hex, 32 characters for a trace and 16 for a span, which are the W3C
sizes, so a `traceparent` header round-trips with no conversion.

| Kind | What it is | Example |
| --- | --- | --- |
| `span` | Something that started because someone asked, and ended when the answer existed | `http.request`, `schedule.run`, `hook.run`, `plugin.dispatch` |
| `log` | A line somebody wrote, with a level and the tag that wrote it | `[schedules] github:refresh timed out` |
| `event` | Something happened, with no duration | `ws.shed`, `cache-miss` |
| `metric` | A count, a gauge, or a histogram pre-aggregated over one flush window | `git.status`, `sql.select`, `telemetry.dropped` |
| `error` | A name, a scrubbed message, and sometimes a stack | an uncaught route error, a process crash |

The field names are OpenTelemetry's and none of its code is here. That is what makes a second
exporter cheap: Better Stack, Coralogix and Datadog all take OTLP, so a sink that speaks one of them
maps these names across rather than inventing a translation.

## The admission rule for a span

A seam emits a span only if all three hold:

1. It is request-shaped. Something asked, and the span ends when the answer exists.
2. It fires fewer than about ten times a second under normal use.
3. Its name is a pattern that would read as one line for a hundred instances.

Anything else is a metric, an event, or nothing.

### Hot seams are metrics

Past about ten a second, a span per call is a payload problem before it is a vendor bill. Those
seams aggregate into one histogram per flush window: SQL statements, git spawns, process spawns,
WebSocket frames, and, in later phases, terminal frames, bridge messages and key dispatch. A
histogram carries six numbers, `count`, `sum`, `min`, `max`, `p50` and `p95`, and costs one record
every five seconds however hot the seam is.

One histogram per owner, seam and label set. Two samples share a row only when all three match,
which is what lets `ws.frame` carry the channel and `proc.spawn` the binary's name without one
channel's label describing another's timings. A window holds at most 200 of them; past that a
sample keeps its count and loses its labels, so the totals stay exact and `telemetry.truncated`
says it happened.

## The attribute vocabulary

Attributes are the only place a fact about one record goes. Keys are dotted and lowercase, at most
64 characters. A string value is cut at 512, a record keeps at most 32 attributes, and a log body is
cut at 2,000 characters. The collector truncates rather than dropping, and counts truncations as
`telemetry.truncated`, so a chatty seam is visible instead of quietly losing its tail.

Two keys are reserved and stamped by the host. An emitter that sets one is ignored, not refused,
because a plugin should not be able to fail its own route by mislabelling a span.

| Key | Values | Set where |
| --- | --- | --- |
| `owner` | `core` or a plugin id | The seam that knows. The plugin host binds it into `ctx.telemetry` and `ctx.log`; the request middleware derives it from `/v1/p/<id>` in the path; the scheduler from the schedule key; the hook runner from the handler's registration |
| `runtime` | `node`, `renderer`, `tui`, `helper` or `shell` | Whichever runtime built the batch. The node stamps its own; a posted batch names the sender, and cannot say `node`. The helper posts two batches for other runtimes: the shell's crash record, and the renderer's memory, which the shell measures from outside ([shell.md](./shell.md) § What the shell reports) |

The conventional ones, set by the seam that has the fact: `seam`, `route`, `method`, `status`,
`request.id`, `task.id`, `schedule.key`, `schedule.reason`, `hook.point`, `hook.handler`,
`hook.outcome`, `error.name`, `error.code`.

An id is always an attribute and never part of a name. A span named `http.request` with a hundred
different `route` values is one row in a vendor's transaction list; a hundred span names is a
hundred rows nobody can read.

## What never leaves the machine

The list is the same one [plugins.md](./plugins.md) § What is not an event applies to broadcasts,
plus what the audit trail refuses:

- Prompt text, agent output, file contents, diffs, terminal bytes.
- Request and response bodies, query text and bound values, WebSocket payloads.
- Absolute paths. The scrubber collapses the owner's home directory to `~` and the data root to
  `<data>`, longest prefix first, so a worktree path keeps its repo-relative tail and loses the
  person's disk layout.
- Credentials. `packages/node-core/src/server/telemetry/scrub.ts` applies the same token patterns
  the agents driver applies to provider output, strips control characters, and caps the result at
  2,000 characters. It is a copy rather than a shared module because core cannot import a plugin.
- An error message that a boundary already withholds. `onServerError` logs a name and a code and no
  message, because drivers embed bound values in `err.message`, and its error record carries the
  same and no more.
- The owner's account. The serve-then-revalidate dedupe key is `<userId>:<resource>` because
  mirrors are per-user, and the label that reaches a sink is the resource alone. A login is the
  person's identity, not a fact about the work.

The scrubber deliberately does not shorten every path-shaped string it sees. Route patterns, channel
names and plugin namespaces are all slash-shaped, and collapsing them would make every record
unreadable to buy nothing: the two paths worth hiding are named.

Stacks are opt-in per record. The logger's `describeError` leaves them off, because a stack in a log
line buries the next fifty. The crash handlers put them on, because a fatal error with no stack is
not worth sending anywhere.

## Traces

A trace ties the records of one action together. The node's request middleware reads a
`traceparent` header, makes the request span a child of what the caller named, and puts the trace on
the request context so an error raised inside the request lands in the same trace rather than
starting a second one.

`traceparent` is attacker-controlled input. The parser accepts exactly the W3C form, two hex digits
of version, 32 of trace id, 16 of parent id, two of flags, and returns null for anything else,
including the all-zero ids the specification calls invalid. The raw header is never echoed into a
log line.

Unattended work starts its own trace, because nobody asked and there is no caller's trace to join: a
schedule run, a hook chain, a plugin dispatch. A hook chain is one trace and not one per handler:
three handlers answering one question are one thing that happened.

## Ambient attribution

`packages/node-core/src/server/telemetry/context.ts` holds one `AsyncLocalStorage` carrying
`{traceId, spanId, owner}`, the only async-local store in the codebase.

It exists because `core/git.ts` and `storage/sqlite.ts` are reached from every route, every
schedule and every plugin, and know nothing about their caller. Without it their histograms all say
`owner: core`, which answers "the node spent four seconds in git" and not whose four seconds.
Threading an owner down to them would change hundreds of signatures. Four seams enter the store
instead:

| Seam | Enters with |
| --- | --- |
| `requestIdMiddleware` | the request's trace, and `core` or the plugin whose namespace the path is in |
| `dispatchPluginRoute` | the dispatch span, and the plugin being dispatched to |
| The scheduler's `#runOnce` | the run's span, and the owner off the key prefix |
| The hook runner's `callOne` | the chain's trace, the handler's span, and the handler's plugin |

The precedence is explicit, then ambient, then `core`. Every emit verb still takes the owner as its
first argument, and `'core'` is the "I have nothing better to say" spelling that the store is
allowed to answer for. A plugin's `ctx.telemetry` closes over its own id and so always passes one,
which is what stops a plugin inheriting core's name, or another plugin's, from whatever happens to
be on the stack.

Four things read the store. `measure` and `recordDuration` resolve the owner. `startSpan` hangs its
span under the ambient one, so a tool call made during a request is a child of that request rather
than the root of a trace of its own. `emitLog` and `emitError` take the ambient trace when the
caller names none.

A histogram is the one record that takes the owner and not the trace. A histogram is one row per
label set per flush window, and a trace id is different on every sample, so putting one in a label
would mint a series per call. The owner answers the question the histogram is for; the trace is
carried by the span and the error beside it.

Off, the store is never entered: `runWithTelemetry` reads the switch first and calls straight
through. On, entering it costs about 0.3 microseconds per request, measured on 2026-09-11.
Reading it costs about 8 nanoseconds, which is why a SQL statement can afford to ask per call.

The renderer has no equivalent and gets none. It has no `AsyncLocalStorage`, and its interaction
trace is a module variable for the reasons § One trace per interaction gives.

## The collector

`packages/node-core/src/server/telemetry/collector.ts`. A module singleton, like the WebSocket hub's
channel slots and the hook maps beside it, and for the same reason: the seam that produces the most
records is a module-level middleware with nowhere to receive a handle.

It holds a ring of 5,000 records and hands them to every sink when the ring reaches 500 or every
five seconds, whichever comes first. Past 5,000 it drops the oldest and counts the drop as
`telemetry.dropped`.

A flush at the record cap is scheduled on a microtask rather than run where the record was emitted.
A sink called from inside `emit` would run on the stack of the code being measured, and a slow sink
would then add its own latency to the request it is describing.

The collector does not sample. Only a sink knows what its vendor bills for and what the owner chose
on its settings page, so sampling is the sink's.

### Never fail what you measure

This is the rule the audit trail already lives by. Every emit is wrapped, so a throw inside
instrumentation cannot reach the instrumented code. A sink that throws is contained and the next
sink still gets the batch. A sink that hands back a rejected promise is contained too. A scrubber
handed something whose `toString` throws answers with a fallback string.

The one place this shows in the type system is `ctx.telemetry` and `ctx.log`: they are the two
members of a plugin context that the host's revocation pass deliberately skips, because a logger
that throws after a reload breaks the rule.

## Writing telemetry from a plugin

`ctx.telemetry` and `ctx.log` are on both tiers and need no permission. Measuring your own work
reads nobody else's. See [plugin-authoring.md](./plugin-authoring.md) § Telemetry and logging for
the verbs.

The owner on every record those produce is bound by the host from the plugin id, not passed by the
plugin, so a package cannot file a record under another package's name any more than it can mount a
route under one.

Two compiled plugins already do this, and core adds nothing plugin-shaped for either: workflows
raises `workflow.run` and `workflow.step` ([workflows.md](./workflows.md) § What a run reports),
and agents raises `agent.session` and `agent.turn`, plus the `agent.processes.*` gauges
([managed-agents.md](./managed-agents.md) § What a session reports).

A plugin's client half has no `ctx.telemetry`, because a client context is contribution points and
nothing else. It calls `telemetryFor('<plugin id>')` from `@acorn/plugin-api/client` instead, which
is the same six verbs against the renderer's emitter, and `createLogger(tag, '<plugin id>')` for a
line. The id is an argument there rather than a binding, and the same is true of the node's
`createLogger`, which a compiled plugin's module-level code reaches for when no `ctx` is in hand.
That is the compiled tier's bargain everywhere: it is code in this process, and least privilege
there is a convention rather than a wall.

### A frame's own records

A sandboxed frame has no context to bind and no host module to import, so it posts a `telemetry`
message over the bridge and the host stamps the owner from the binding
(`packages/client-core/src/host/frames/frameTelemetry.ts`). The frame's SDK spells it as
`bridge.telemetry` and `bridge.log`, the same two names the node half has.

Three things are the host's rather than the frame's, and each is a thing a frame cannot be trusted
or able to state:

- The owner, from the binding. A frame that named `github` in the message is ignored, not refused.
- The ids. A span arrives finished, with the duration the frame measured, and the host hangs it
  under whatever interaction is open. A frame that could name a trace could hang its work under
  somebody else's click, and has no way to know a trace id in the first place.
- Admission. A malformed record is dropped rather than answered, because the verb has no id and no
  reply. A frame emitting in a loop trips the bridge's rate window and loses its port, which is the
  same answer every other verb gets.

## Writing a sink

A plugin that wants to read the stream declares one token:

```json
{ "permissions": { "node": { "core": ["telemetry"] } } }
```

```ts
export function init(ctx: NodePluginContext) {
  ctx.core.telemetry.onBatch((batch) => queue.push(batch))
}
```

A sink sees everything from every owner, which is why it is a token and not a default, and why the
trust prompt draws it high. [security.md](./security.md) § Telemetry sinks has that argument.

A sink must return quickly. The collector calls sinks in order on its timer, awaits none of them and
contains a throw or a rejection. Buffering, retry and sampling are the sink's job. The returned
`Disposable` lets a reload drop the subscription, and the host clears sinks for a plugin whose
registrations it rolls back.

## The first sink

`plugins/sentry-telemetry` is the one that ships, and it is the thing this whole document was built
for. It is a loaded plugin in the bundled roster, so it is installed on every machine and does
nothing at all until two things are true: the switch above is on, and a Sentry DSN is connected in
Settings → Integrations. [integrations.md](./integrations.md) § Sentry owns the connection and the
two-plugin split.

Its own settings page holds what the one switch does not, and every choice there is the sink's
because only it knows what its vendor bills for: a sample rate for traces, which of the five kinds
to send, whether to include stacks, and whether to send `task.id` as a tag.

What a batch becomes:

| Record | Sentry item |
| --- | --- |
| A span with no parent, plus every span beneath it in the batch | one `transaction` with a flat `spans[]` |
| A span whose parent is in another batch | its own `transaction`, still naming `parent_span_id`, and Sentry stitches the two by trace id |
| A `schedule.run` span | two `check_in` items, `in_progress` then `ok` or `error`, sharing one id |
| A log, and an event other than `ui.interaction.work` | entries in one batched `log` item |
| An event, again | a breadcrumb on the error that followed it |
| A metric | entries in one batched `trace_metric` item; a histogram goes as `p50`, `p95` and `max` gauges plus a `count` counter |
| An error | an `event` with `exception.values[0]` and, when stacks are on, parsed frames |

Three of those are decisions worth knowing about rather than details.

**A flush is several envelopes, not one.** Most Sentry item types may appear at most once per
envelope, and `event` and `transaction` are mutually exclusive because the envelope header carries
the single `event_id` they share. So the exporter builds one envelope per error, per transaction and
per check-in, plus one for the batched logs and one for the batched metrics.

**Transactions are assembled from the batch, never from a store.** Holding spans back to wait for a
root is the persistence this programme refuses, under another name. A span whose parent has already
gone out becomes a transaction of its own with the parent named, which is what an SDK does anyway
when a trace crosses a process.

**Routine requests are sampled by value before trace sampling.** A request trace stays complete when
the same batch contains a command, navigation, render, or other meaningful span. A failed request is
always retained. Outside those traces, Sentry keeps renderer requests taking at least one second and
node requests taking at least 250 ms. Successful `/v1/core/telemetry` and `/v1/core/prefs` spans are
never exported: those routes describe the reporting machinery itself and were the overwhelming
majority of stored spans. The collector still exposes the complete stream to local and other sinks.
The configured trace sample rate is applied after this gate.

`ui.interaction.work` remains a breadcrumb on a later error, where its bounded operation counts help
explain the failure. It is not also sent as a standalone info log, which avoids multiplying every
interaction into several log rows.

**The exporter is the last gate before the network.** Core scrubs every log body, error message,
stack and string attribute at the ingest door, so this pass is a check rather than a clean-up, and
it covers what core takes on trust as a pattern: a span name, a metric name, an event name, a logger
tag. `scrub` is on the plugin API for this, rather than copied into the plugin, because there are
already two copies of those token patterns in this repository.

Delivery is a queue of 200 envelopes that drops the oldest, exponential backoff from one second to
two minutes on a network failure or a 5xx, and `X-Sentry-Rate-Limits` honoured per category. A
refused envelope is dropped rather than retried, because a 400 is a shape Sentry will refuse again.
Connection and consent are checked before every delivery attempt, including retries. The privileged
`ctx.core.telemetry.enabled()` facet reads the collector’s consent (updated within five seconds);
a plugin’s namespaced prefs cannot read the node’s consent row. Disconnecting,
changing the target, or disabling telemetry discards the queued envelopes at the next attempt.
Each HTTP attempt has a ten-second deadline, and disposing the plugin cancels its request and
backoff. Conversion holds at most 200 pending batches as well as the 200-envelope delivery queue.
Nothing persists across a restart: both the collector window and the queued envelopes are lost. The one thing the exporter
emits about itself is a `sentry.dropped` counter, with the reason and the category.

## What the page shows

Settings → Telemetry is the switch and the evidence beside it: what this node has collected since
it started, per owner and kind, which plugins are reading the stream, when a batch last went to
them, and how many records were dropped. `GET /v1/core/telemetry/summary` answers it and the page
asks every five seconds, which is the collector's own flush window, so the numbers move while
somebody watches.

Counters, not records. The ring is 5,000 deep and a sink may have drained it a second ago, so a
page built on the ring would answer "what is this collecting" with whatever the last five seconds
held. Each count is one map increment where the record is pushed.

The page is where "the switch alone collects nothing" stops being a claim. With the preference on
and no sink subscribed it says so in those words, and the count stays at zero.

## Logging

`packages/node-core/src/server/telemetry/logger.ts` is the only file that may call `console.*` under
`packages/node-core/src`, `apps/node/src`, `packages/custody/src` and `apps/desktop/src/helper`, and
`packages/client-core/src/infra/telemetry/logger.ts` is the only one under
`packages/client-core/src`, `apps/desktop/src/client`, `apps/desktop/src/shell` and `apps/tui/src`.
`tools/arch/boundaries.test.ts` holds both there with a shrinking baseline.

A third rule covers `plugins/*/src`, and its baseline is empty rather than shrinking. A plugin has
no reason to be an exception: the arguments the other two make for their entries, that stdout is a
wire, that the file is the logger, that `kit/` may import nothing, are true of no file under
`plugins/`. A plugin writes through `ctx.log` where a context is in reach, and through
`createLogger(tag, '<plugin id>')` from `@acorn/plugin-api` where one is not.

Everything else in that baseline writes something that is not a log line. `apps/node/src/entries/standalone.ts`
and `apps/desktop/src/helper/helperMain.ts` write handshake JSON a launcher parses off stdout.
`apps/node/src/entries/standalone.ts`, `apps/tui/src/node/pair.ts` and `apps/tui/src/node/open.ts`
print a pairing banner a person at that terminal is there to read. `apps/tui/src/platform.ts` prints
the data-root path, which is what "open the data folder" means in a terminal.

`createLogger('schedules').warn('github:refresh timed out')` prints `[schedules] github:refresh
timed out`, which is what the hand-written prefix printed before. Attributes render as `key=value`
on the end of the line, so a line stays one line and stays greppable.

Everything goes to stderr, `info` and `debug` included, because stdout is a wire in the standalone
entry and in the desktop helper. `console.error` and `console.warn` rather than
`process.stderr.write`, because thirty-one node tests spy on those two and a logger writing
underneath them would pass every one of those tests vacuously.

The client's logger writes to the devtools console instead, which is the thing a developer already
has open, and keeps `console.warn` and `console.error` for the two levels that console filters on.
It takes a second argument the node's does not: half the renderer's log sites pass a caught error to
get the console's expandable object, and the record takes that error's name and message as two
attributes, because a record cannot carry an object.

`ctx.log` was removed on 2026-08-27 for being interchangeable with `console`. It is back because it
is not interchangeable any more: a line written through it carries the plugin id the host bound,
reaches every sink, and is scrubbed on the way.

## Node seams

| Seam | Where | What it emits |
| --- | --- | --- |
| Every HTTP request | `server/respond.ts` `requestIdMiddleware` | span `http.request` with method, route pattern, status, bytes and request id; reads `traceparent` |
| Every uncaught route error | `server/respond.ts` `onServerError` | error with a name and a code, no message and no stack |
| Every scheduled run | `server/schedules/scheduler.ts` | span `schedule.run`, owner from the key prefix, with the run's period and timeout in milliseconds so a sink can describe the schedule |
| Every hook handler | `server/pluginHost/hooks.ts` | span `hook.run`, owner from the handler's registration |
| Every plugin route dispatch | `server/pluginHost/dispatch.ts` | span `plugin.dispatch`, owner from the plugin being dispatched to |
| Every background refresh failure | `server/background.ts` | a handled error naming the resource, never the account whose mirror it was |
| Every git spawn | `server/core/git.ts` | histogram `git.<subcommand>`, owner from the ambient context |
| Every SQL statement | `server/storage/sqlite.ts` | histogram `sql.<verb>`, owner from the ambient context |
| Every process spawn | `server/core/proc.ts` | histogram `proc.spawn` with the binary's base name; events `proc.timeout` and `proc.truncated` |
| Every serve-then-revalidate decision | `server/sync/engine.ts` | count `sync.fresh`, `sync.stale` or `sync.cold` with the resource |
| Every outbound WebSocket frame | `server/transport/wsHub.ts` | histogram `ws.frame` with the channel prefix; event `ws.shed` when a socket falls behind |
| Every agent tool call | `server/routes/plugins/agentTools.ts` | span `tool.call`, owner from the plugin that contributed the tool |
| Every audit row | `server/audit.ts` | event `audit.<action>` with the actor, and none of the row's details |
| Uncaught exception, unhandled rejection | `apps/node/src/composition/crash.ts` | a fatal, unhandled error with its stack, then exit 1 |
| Console lines | everywhere under `packages/node-core/src` and `apps/node/src` | log records |
| Telemetry from another runtime | `server/routes/telemetry.ts` | nothing of its own; it admits what the renderer collected |

A loaded plugin's HTTP routes need nothing extra: they are served under `/v1/p/<id>/`, so the
request middleware's span already names the plugin.

Installing a crash handler changes what Node does. With any `uncaughtException` listener registered,
Node stops printing the stack and stops exiting, so `installCrashHandlers` does both itself, with
one flush in between and a one-second window for asynchronous sinks to post it. Returning from
the collector flush only acknowledges handoff, so the process does not exit immediately after it. A crash must not become a hang because somebody's
exporter is waiting on a socket. It is installed from the two process entries and not from
`startServiceRuntime`, which boots three times in one process in its own test.

## The renderer

The renderer collects the same five kinds with the same verbs
(`packages/client-core/src/infra/telemetry/emitter.ts`) and posts them to the node. It holds at most
1,000 records and flushes at 500 or every five seconds, whichever comes first. A post that fails
puts its records back at the front of the queue, so an unreachable node costs the oldest records
first. Switching off discards the queue; a late failure cannot restore records from the previous
consent period. Posts are split by encoded UTF-8 bytes to fit the one-mebibyte route limit. A single
oversized record is replaced with a drop counter. If a later part fails, retrying the window may
deliver an earlier part again; delivery is best effort, without deduplication.

There is no scrubber in the renderer. A browser cannot know this machine's home directory or its
data root, which are the two prefixes worth collapsing, so the node re-scrubs every posted record as
it arrives. One scrubber, in the process that knows the paths.

### One trace per interaction

A command or a page change opens an interaction, and every request the renderer sends while one is
open carries a `traceparent`. So a click, the requests it caused, and what the node did for each of
them are one trace: the command span is the root, the renderer's `api.request` span is its child,
and the node's `http.request` span is a child of that.

A lifecycle operation caused by an open interaction joins it as a child rather than replacing the
ambient trace. The same operation opened directly becomes the interaction root, so requests and
render probes still correlate. Agent center, sidebar, session, and subagent view lifecycles use this
seam; a session selection that mounts a sidebar therefore stays one trace instead of producing two
overlapping traces.

The interaction is a module variable rather than an async context, because the renderer has no
`AsyncLocalStorage` and nothing worth polyfilling one for. Work that continues after the span ends
gets no parent. That is a known imprecision and it is written down rather than papered over.

A request made outside an interaction still carries a `traceparent`, naming its own `api.request`
span. Sending nothing would leave the node's request span with no link back to the window that
asked for it.

### An owner on a contribution that never declared one

Eight client contribution types carry no plugin id: a pane, a source, a slot, a reference panel, a
settings page, and the rest. `Registry` in `packages/client-core/src/kit/lib/state/registry.ts` keeps the
owner in a side-map instead, filled by the three passes that know it, and `ownerOf(id)` answers for
the seams. A field on each type would have meant changing every registration site to add something
only telemetry reads.

Compiled plugins are stamped by `makeContext`, loaded plugins by the descriptor pass in
`host/chrome/chromeRegister.ts` and the frame pass in `host/frames/register.ts`. Core registers
without one, and `ownerOf` answers `undefined`, which the seams read as `core`.

### Renderer seams

| Seam | Where | What it emits |
| --- | --- | --- |
| Every request that leaves the renderer | `infra/node/apiClient.ts` `send()` | span `api.request` with method, route namespace and status; sets `traceparent` and `x-request-id` |
| Slow renderer-helper calls | `apps/desktop/src/shell/bridge.ts` `call()` | a `bridge.call` histogram for every call and a console diagnostic above one second, splitting helper handling, delivery queue, JSON parse and promise-continuation time; node fetches name their coarse API route and request id; body decoding logs above 250 ms |
| Every failed query and mutation | `infra/node/fleet.ts` `clientFor` | a handled error, with the first two segments of the key |
| Every inbound WebSocket frame | `infra/node/wsClient.ts` `dispatch` | histogram `ws.inbound.<channel prefix>` |
| Every command | `host/registries/commands/commands.ts` `executeCommand` | span `command`, owner from `ownerId`; opens an interaction |
| Every page change | `features/tasks/pageChange.ts` | span `nav.change`, ended on the second animation frame; opens an interaction |
| Consequential view lifecycle | `infra/telemetry/emitter.ts` `startOperation` | child span under an open interaction, or an interaction root when opened directly |
| Opted-in state transitions | `infra/telemetry/emitter.ts` `startRenderTransition` | one `ui.render` child span with current-turn, first-frame and paint-frame durations; only under an open interaction |
| Opted-in initial list construction | `infra/telemetry/emitter.ts` `measureRenderBatch` | one `ui.render.batch` span per operation and JavaScript turn, with factory-call count, inclusive factory time and wall time to the microtask checkpoint |
| Every pane region | `host/registries/panes/panes.ts` `drawLayout` | span `pane.region`, from the host asking for the region to the child's mount |

`@acorn/protocol/telemetry` owns `apiRouteNamespace`. The renderer request seam and desktop
bridge both use it to group `/v1/p/<plugin>` requests by plugin without recording full paths.
| Every pane model build | `host/registries/panes/paneModels.ts` | span `pane.model`; a cache hit is not timed |
| Every plugin frame boot | `host/frames/PluginFrame.tsx` | span `frame.boot`, ended on the frame's first message; an error record on the ten-second deadline |
| Every bridge message | `host/frames/broker.ts` | histogram `bridge.message.<kind>`; event `bridge.overbudget` when the rate limiter trips |
| Every remote tree apply | `host/tree/treeState.ts` | histogram `tree.apply`, owned by the plugin whose tree it is |
| Every plugin channel frame | `host/plugins/pluginChannel.ts` | histogram `plugin.frame` |
| Every contribution that throws while rendering | `kit/components/content/ContributionBoundary.tsx` | a handled error with its stack, contribution id, and owner |
| Every place a followed timeline puts the reader | `kit/components/content/Timeline.tsx` | event `ui.scroll.place` with the cause, the turn the reader is anchored to, the offsets it moved between, the list and viewport heights, and whether it was following. `opened` is a list mounting or swapping, which is the only trace a remount leaves; `unasked` is a move neither the reader nor the timeline made; `took` is the reader's place changing without the reader, which happens only when the turn they were on has left the list |
| Every large diff or timeline becoming ready or going away | `kit/lib/telemetry/surfaceHealth.ts`, installed by `infra/telemetry/emitter.ts` | histograms `ui.surface.*`, labelled only by surface kind and checkpoint. See [Rendered-surface health](#rendered-surface-health) |
| Page counts, every 30 seconds while visible | `infra/telemetry/pageFacts.ts` | gauges `ui.page.*`. See [Memory over a day](#memory-over-a-day) |
| Every diff segment cache access and change | `features/diff/segmentCache.ts` and `segmentLoader.ts` | histograms `diff.segment_cache.hit` and `.miss` (segments that entered a pane's range, found or not), `.insert` (segments per batch), `.evict`, `.evicted_rows` and `.evicted_bytes` labelled only by `reason` (`budget`, `superseded` or `node-drop`), `.oversize`, and the resident `.documents`, `.segments`, `.rows`, `.plain_bytes` and `.enrichment_bytes` after each insert. No key, path, revision or text. See [diff-rendering.md](./diff-rendering.md) § Resident segments |
| A diff pane's first plain rows | `features/diff/DiffPane.tsx` | histogram `diff.first_plain`, the milliseconds from mount to the first segment on screen, labelled only by `cache` (`hit` or `miss`) |
| Every delivered notice | `features/notifications/deliver.ts` | event `notice.delivered` with the kind and whether it landed read |
| The boot account | `apps/desktop/src/client/boot.ts` | span `renderer.boot` from navigation to `nodeReady`, with a `renderer.boot.mark` child per mark. Built after the fact, once the switch is on and the node is ready, because the switch is not known while the marks are taken |
| Uncaught error, unhandled rejection | `apps/desktop/src/client/index.tsx` | a fatal, unhandled error with its stack |
| Console lines | everywhere under `packages/client-core/src`, `apps/desktop/src/client` and `apps/desktop/src/shell` | log records through `createLogger(tag)` |

`kit/` is the exception to the console rule's remedy. It may import `kit/` and the highlighter and
nothing else, because it is what `@acorn/plugin-api/ui` re-exports, so a boundary in there cannot
reach the emitter. `kit/lib/telemetry/contributionErrors.ts` is the seam: the boundary reports through it, and
the client's telemetry start-up installs the handler.

### The page change is a signal write, not a navigation

Routes mount a no-op component and `App.tsx` draws from `selectedSource()` and `activeTaskId()`, so
there is no router event to hang a span on. `nav.change` starts where the signal is written and ends
on the second `requestAnimationFrame`, which is the boot marks' pattern: the first frame is the one
the browser was already going to paint, and the second is the first with the new content in it.

Two writes inside one change collapse into one span. Opening a task writes both signals, and two
spans would report one click as a navigation to nothing followed by a navigation to the task. A
region that is still fetching at that second frame is not covered by this; `pane.region` measures
that to content.

### Rendered-surface health

A large diff or timeline keeps numbers about itself, so a regression in how much it mounts, measures,
queues, or holds can be shown without hand-added logging. One registry owns them:
`packages/client-core/src/kit/lib/telemetry/surfaceHealth.ts`. A surface registers when it mounts, hands over a
reader, and disposes the registration when it unmounts. Two surfaces register today:

- The shared diff viewer, as `diff` (`packages/client-core/src/features/diff/diffHealth.ts`). Its
  layout counts measurement and corrections in `features/diff/diffLayout.ts` and
  `kit/diff/measureScheduler.ts`.
- Every `Timeline`, as `timeline` (`packages/client-core/src/kit/components/content/Timeline.tsx`).
  A caller passes `total`, the number of turns in its list, drawn or not, and `hidden`, the older turns
  its window is not drawing. The agent transcript passes its projected card count and its window's
  start.

The reader runs only when someone asks for a snapshot. An open surface pays nothing between
requests. Disposal takes one final reading after the surface's own cleanups have run and keeps it as
that kind's `retired` entry. That reading shows whether observers, frames, and queued work reached
zero, without waiting on garbage collection.

| Group | Fields | Meaning |
| --- | --- | --- |
| `topology` | `files`, `segments`, `fixedRows`, `dynamicBlocks`, `ready`, `lateSourceBlocks` | The document as a whole. Fixed rows are code and structural rows with exact heights. Segments are the diff document's bounded pieces. Dynamic blocks are the source's threads a diff places in some segment, and the projected turns in a timeline. `ready` means the source-owned structure is complete: for a diff, its topology and its threads have both arrived. `lateSourceBlocks` counts source threads that arrived after that. |
| `mounted` | `segments`, `fixedRows`, `dynamicBlocks`, `blankBlocks`, `uncoveredRanges`, `bodies` | What is in the DOM now: segment items in the virtual range, and the rows drawn in them. A blank block is a visible mounted item with neither a placeholder nor content. An uncovered range is visible space that no mounted item covers, measured from real rects. `bodies` is deferred content a timeline has built: disclosures that have been opened, and turn bodies drawn once their turn came near the viewport. |
| `work` | `queuedSegments`, `queuedEnrichment`, `furthestQueueDistance`, `unvisitedSegments`, `scheduledFrames`, `heldPublications`, `prepareMs` | Work still owed. For a diff, queued and loading segments, segments loaded but not yet coloured, and how far, in segments, the furthest queued one is from the ones on screen, never by path. `unvisitedSegments` counts held segments the reader has never had on screen, which is the runway the loader keeps and should stay a few segments. `prepareMs` sums the time spent building segments' rows and applying their colour. |
| `measurement` | `candidates`, `reads`, `commits`, `maxCommitsInFrame`, `readMs`, `commitMs`, `fixedRebuilds`, `activeObservers`, `observedElements` | Size reads and the geometry commits they caused, counted since mount. A candidate is a dirty block a pass looked at, and a commit is one batch of changed heights. `commitMs` is the time spent applying commits. `fixedRebuilds` counts rebuilds of the exact fixed geometry, which only a change to the list of items may cause. Observers count up when created and down when disconnected, and observed elements are what they watch. |
| `correction` | `count`, `failed`, `substituted`, `maxPixels`, `maxAnchorDrift` | Scroll writes made to keep a reading place. `failed` counts corrections whose anchor had gone and that fell back to the live end. `substituted` counts places whose anchor had gone and a neighbour stood in. `maxAnchorDrift` is the furthest the browser left the view from the place it was put back at. |
| `resident` | `documents`, `segments`, `rows`, `estimatedBytes`, `plainBytes`, `enrichmentBytes`, `hits`, `misses`, `inserts`, `evictions`, `oversize`, `rowCeiling`, `byteCeiling` | Parsed content held in memory. For a diff, this is the node's segment cache, shared by every diff on the node: the distinct patches, segments, and rows it holds, its estimated bytes split into plain rows and colour, and the two ceilings they are held under. `inserts`, `evictions`, and `oversize` count since the cache was made. `hits` and `misses` are this pane's own since mount: segments that came into its range already held, or that it had to ask for. The bytes are the cache's budget estimate, not the heap. |
| `window` | `hiddenEarlier`, `expansions`, `trims`, `pinned` | A timeline drawn through a fixed window (`kit/lib/timeline/timelineWindow.ts`). `hiddenEarlier` is the older turns not drawn now. `expansions` counts the window growing since mount, whether from **Show earlier**, a reveal, or a caller drawing everything. `trims` counts the window handing its oldest turns back while the reader followed the live end. `pinned` is how many turns the last trim kept past its page because they held the reader's selection or focus. |

A field a surface has no concept of stays zero. The timeline has no segments and rebuilds no fixed
geometry. The diff has no window and builds no deferred bodies. The diff has no live end, so it
never fails a correction; it substitutes instead. `heldPublications` is always zero for the diff now: nothing is held
back during a scroll, because a segment publishes when it arrives and it only arrives if it is near.

The snapshot holds numbers, one boolean, and the two kind labels. The registry copies only the fields
the template names and only when they are finite numbers, so a reader that returned a path, a line
of code, a comment, or an ID would lose it before it left. `surfaceHealth.test.ts` and the diff
probe test feed canary strings through both paths and check that none comes out.

Telemetry gets a fixed handful of these numbers as histograms at two checkpoints: a diff's `ready`,
and any surface's `teardown`. The seams are `ui.surface.topology.fixed_rows`,
`ui.surface.mounted.fixed_rows`, `ui.surface.mounted.dynamic_blocks`,
`ui.surface.measurement.max_commits_in_frame`, `ui.surface.measurement.active_observers`,
`ui.surface.correction.max_pixels`, `ui.surface.work.prepare_ms`, and
`ui.surface.resident.estimated_bytes`. Their only labels are `surface` and `checkpoint`.

The whole snapshot is a local read on the performance timeline. Dispatch an `acorn:surface-health`
event on `window`, then read the `detail` of the one `acorn:surface.health` mark:

```js
dispatchEvent(new Event('acorn:surface-health'))
performance.getEntriesByName('acorn:surface.health').at(-1).detail
```

The desktop answers that request from boot, whatever the `acorn.perf` switch says
(`packages/client-core/src/infra/telemetry/surfaceHealth.ts`). It does not wait for that switch
because the automation window shares WebKit storage with a developer's own app, so turning the
switch on for one would turn it on for both. Each answer replaces the previous
mark, so a long automated loop leaves one entry. Nothing is put on `window`, and no HTTP route
exposes it. The large-surface flow reads it this way ([local-development.md](./local-development.md)
§ Large-surface flow).

What the numbers say about the diff: its topology is complete before any row loads, its queue is
only ever the segments on screen and the two either side, and a pane left open settles with nothing
queued, so the queue distance stays at a few segments however large the document is.

#### Timeline

Read a timeline's numbers this way:

- `topology.dynamicBlocks` is the caller's logical turns and `mounted.dynamicBlocks` the turns in the
  DOM. With a window, the two differ by `window.hiddenEarlier`. The large-surface flow counts a
  timeline as mounted when every turn is drawn or hidden, and asserts the 400-turn ceiling on open.
- A followed transcript opens on 200 turns and trims back to 200 once it draws 400 while following, so
  `mounted.dynamicBlocks` stays under 400 unless the reader pressed **Show earlier**, went to the top,
  or held a selection or focus. `window.pinned` says how many turns a hold kept.
- `mounted.bodies` grows as disclosures open and as deferred turn bodies come near, never with the
  length of the list.
- `correction.substituted` counts reading places whose turn left the list, so a neighbour stood in. A
  turn the window hides is revealed instead and never counts here. `maxAnchorDrift` is the distance a
  correction was left from its place when the list refused to move any further.
- `measurement.activeObservers` is 2 on a followed timeline, plus 1 while any turn has a deferred body,
  and 0 after teardown.

#### Diff measurement

The diff measures only its dynamic blocks, threads and whatever a line draws under itself, through one
observer ([diff-rendering.md](./diff-rendering.md) § Row geometry). Read its numbers this way:

- `activeObservers` is 1 while the pane is mounted and 0 after, and `observedElements` is the
  scroller plus the mounted blocks, so it tracks `mounted.dynamicBlocks` rather than the document.
- `candidates` and `reads` grow with blocks mounted and resized, not with rows. A read that finds the
  height the geometry holds commits nothing.
- `maxCommitsInFrame` stays at 1: a pass that would be a frame's second commit waits for the next.
- `fixedRebuilds` rises when the list of items changes (the first topology, a collapsed file, an
  opened gap, the other projection) and never when a block resizes.
- `correction.count` and `maxPixels` are the scroll writes that kept the reader's row in place as
  blocks above it changed height. A commit while the reader scrolls never needs one, because blocks
  above the reader wait until the scroll settles. `substituted` rises when a collapsed file takes the
  reader's item away. `maxAnchorDrift` should stay under a pixel; more means the browser refused a
  correction the layout asked for.
- `mounted.blankBlocks` and `uncoveredRanges` are measured from real rects, so a fixed row height
  that `diff.css` stopped honouring shows up there first: the layout does not measure code rows, and
  a row one pixel taller than it counts leaves items overlapping.

## The terminal client, the helper, and the shell

Three runtimes carry no plugins and report anyway. Each has its own section in the document that
owns it, because what shapes each one is a fact about that runtime rather than about telemetry:
[tui.md](./tui.md) § What the terminal client reports, and [shell.md](./shell.md) § What the helper
reports. In short:

| Runtime | Emitter | How a batch leaves | What it adds |
| --- | --- | --- | --- |
| Terminal client | client-core's, with `runtime: 'tui'` | client-core's poster, over the platform seam | `tui.frame` and `tui.key` histograms, a `tui.boot` span, and every renderer seam it shares |
| Desktop helper | the node's collector, in the helper's process | its own poster, over the broker with the device token | `helper.boot` spans, `broker.*` health, `node.crash`, and its log lines |
| Rust shell | none. A panic hook writes a file, and the helper asks for memory numbers | the helper forwards the file on the next boot, and posts the numbers when they arrive | one fatal error with `runtime: shell`, and the renderer's and the helper's `runtime.memory.footprint` |

Two things are worth reading across from here.

**Two emitters, chosen per runtime rather than shared.** The terminal client runs client-core in
process, so it reuses the renderer's emitter and changes only the poster. The helper is a Node
process that already depends on `@acorn/node-core`, so it reuses the collector: the same verbs, a
logger that writes to stderr, and no package that draws on its graph. One consequence is measurable:
the terminal client also holds custody, so both emitters are on its startup graph, about 13 KB of
collector it can never collect with. That is written down rather than hidden, and the seams inside
custody report in the helper and report nowhere in the terminal client.

**A switch read over the wire.** The preference lives on the node, and the helper has no database.
It asks over the broker, once a minute while off and every five seconds once on, and tells the
collector the answer through `setTelemetryPref` rather than waiting for the collector's own tick.
Without that, the first five seconds after the switch turns on would build nothing, and a helper's
boot spans are all inside those five seconds.

## Other runtimes

`POST /v1/core/telemetry` is where every runtime that is not the node posts its batches. Device
principals only, because everything admitted there reaches every sink and a sink can post it off the
machine, so a task-scoped agent must not be able to put words in one.

The body is `{ runtime, records }`. The node re-stamps `runtime` from the batch onto every record,
re-scrubs each log body, error message and stack, and puts the records through the same attribute
caps as its own. `runtime` cannot say `node`: the collector stamps that on records it built, and a
posted batch that could claim it would be indistinguishable from one at a sink. `owner` is taken
from the record, because only the runtime that emitted it knows which pane or which frame caused it.

A batch is refused whole for one malformed record, and refused at a mebibyte. Nothing collecting
answers `202` with `{ accepted: 0 }` rather than an error: the switch being off is not the sender's
failure to handle, and the sender stops on its own when it next reads the preference.

## Diagnosing an unresponsive view

The collector distinguishes waiting for data from processing it and losing responsiveness. Collection
still requires consent. No transcript, source text, terminal output, search query, or file path is added
by these hooks. Workload sizes are histogram values, **not labels**. `telemetryFor(owner).observe(name,
value, unit?, attrs?)` records a non-negative finite sample; the histogram count also counts calls.
Fixed operation/outcome labels keep the number of series bounded.

| Question | Hooks |
| --- | --- |
| Did the renderer stop responding? | `ui.event_loop.delay`, `ui.frame.gap`, and `ui.stall` in the focused, visible renderer. `ui.hang.suspected` and `ui.hang.recovered` come independently from the desktop helper. |
| Which browser phase held the interaction? | `ui.render` carries `phase.turn_ms`, `phase.frame_wait_ms`, and `phase.paint_wait_ms`. Navigation, non-resize pane-layout actions, managed-agent session selection, and snapshot display opt in. Snapshot display adds event, turn, and request counts. |
| Which agent view was opening? | `agents.center.open`, `agents.sidebar.open`, and `agents.session.open` span loading through two animation frames after readiness. Outcomes are `ready`, `error`, `cancelled`, or `timeout` (30 seconds). Initial selection begins before its signal write; `agents.subagent.open` covers selecting an already-loaded child transcript. |
| Was the response cheap to fetch but expensive to process? | `api.request` carries `responseBytes`; `api.response.bytes` and `api.decode` measure JSON reads after transport delivery. |
| Is history size driving the cost? | `agents.snapshot.merge`, `agents.snapshot.index`, `agents.transcript.project`, `agents.transcript.visible`, with event/item counts. `agents.center.rows`, `agents.center.filter`, and `agents.sidebar.rows` cover roster work. |
| Are cheap updates repeating too often? | `agents.snapshot.load` and `agents.roster.load` distinguish inflight/cache hits from misses, and a snapshot read that resumed from the events the store holds reports `resume`. Session updates, appended events, cache actions, `rows.reconcile`, `rows.item.mount`, and `pane.region.mount` count churn. `ui.interaction.work` reports up to five most frequently observed operations per interaction with trace IDs and call counts. |
| Is rendering the content expensive? | `agents.transcript.cards` emits one initial `ui.render.batch` span with visible-card count, summed factory time, and wall time to the turn checkpoint. `markdown.parse`, `markdown.render`, `highlight.html.render`, and their character counts/cache outcomes cover shared markdown and code fences. `diff.segments.load` (one batch of segments from the source), `diff.segments.enrich` (one segment's colour), the `diff.segments.requested` batch size, and the `diff.files` and `diff.document.segments` counts at each revision cover diff preparation; the parse itself is on the node. `editor.language.load`, `editor.state.create`, `editor.view.create`, and document character counts cover the shared editor; `editor.state.skipped` counts responses discarded after the pane unmounts. |
| Does a large diff or timeline do work in proportion to its size? | `ui.surface.*` at a diff's `ready` and every surface's `teardown`, and the exact local snapshot in [Rendered-surface health](#rendered-surface-health): mounted versus total rows, queue distance, commits per frame, observers left at teardown. |
| Is a worker falling behind or falling back? | `highlight.pending`, `highlight.queue.wait`, `highlight.worker.execute`, `highlight.timeout`, `highlight.result`, and `highlight.fallback`; `highlight.main_thread` measures the fallback. Worker execution includes grammar-loading waits; queue time is measured from posting to worker receipt. |
| Is the client cache responsible? | `cache.read`, `cache.deserialize`, `cache.serialize`, `cache.write`, cache character/entry counts, and `cache.restore_to_hydrated` on the desktop. `cache.updates` labels only the fixed query-cache action, never query keys. |
| Is a plugin flooding the UI? | Existing `tree.apply` plus `tree.queue.wait`, `tree.batch.operations`, `tree.batch.merged`, `tree.nodes`, and `tree.batch.refused`, attributed to the owning plugin. |
| Is terminal output flooding its parser? | `terminal.output.size`, `terminal.pending.size`, `terminal.write` (through xterm's completion callback), and `terminal.fit`. Sizes count supplied string code units or binary bytes, without copying output to measure it. |
| Is the backend or helper under pressure? | `runtime.event_loop.p95`, `runtime.event_loop.max`, `runtime.event_loop.utilization`, `runtime.cpu`, `runtime.memory.rss`, and `runtime.memory.heap`. CPU is consumed CPU time / elapsed time; memory is bytes. `runtime.suspended` is time the process was not running, kept apart from delay. |
| Where is the memory going? | See [Memory over a day](#memory-over-a-day): `runtime.memory.footprint` for the renderer and the helper, the `ui.page.*` counts beside it, and `agent.processes.*` on the node. |

A measured client operation taking at least 100 ms can also produce a detailed span under its
original interaction, capped at 20 exemplars per flush. Histograms retain every sample even after
that cap. These are inclusive operation timings, not CPU profiles; overlapping/nested durations must
not be added together. The ambient renderer interaction remains an approximation for concurrent
background work, while slow spans capture their parent at the start of the measured operation.

`ui.render` is deliberately smaller than a profiler. It creates one span for a deliberate state
transition and no global observer: the current-turn duration runs from immediately before the signal
write to the next microtask checkpoint, the frame wait runs from there to the next animation frame,
and the paint wait is the following frame. It does not walk the DOM or instrument component mounts.
Outside an open interaction it is inert, and pane resizing is excluded because it fires on every
pointer move. Callers may attach bounded numeric workload counts, never source or transcript content.

`ui.render.batch` applies the same constraint to repeated synchronous factories. Calls with the same
owner and operation during one JavaScript turn produce one span rather than one record per item. Its
`work.ms` is the sum of time inside the wrapped factories, while `wall.ms` includes other synchronous
work between the first factory and the microtask checkpoint. The agent transcript uses it only for
its initial visible cards; streaming additions stay off the instrumentation path.

The node and the helper share one runtime pressure sampler, in
`packages/node-core/src/server/telemetry/runtimePressure.ts`. It reads a five-second window. On
macOS the monotonic clock keeps running while the machine sleeps, so a sleep or a dark wake reaches
the delay histogram as one long stall, and comparing it with the wall clock shows nothing. Only
running code can hold the event loop, so a window whose longest delay exceeds its active time by
more than a second, or whose idle time runs more than a second past the interval, is treated as a
suspend. That window reports `runtime.suspended`, the lost time to within one window, instead of the delay,
utilization and CPU numbers, which it would distort. A real block is active time and still reports,
however long it is. A block and a suspend in the same window report only the suspend.

The desktop responsiveness pulse crosses the platform seam and the authenticated helper socket once
per second while the window is focused and visible, and immediately when the interaction changes.
The helper validates bounded operation names and trace IDs. It retains the last interaction with
`contextAgeMs` and `operationActive`, so historical context is not mistaken for currently running work.
It reports once after five seconds without
a pulse, and reports recovery if a pulse returns. Blur, hidden state, consent revocation, socket close,
and a helper timer gap over five seconds disarm the observation; another active pulse re-arms it.
This is a local responsiveness check, not an uptime ping. A suspected hang can also indicate a delayed
local transport, so it is a diagnostic lead rather than proof of a JavaScript deadlock. The helper can
report while the renderer is permanently blocked, but cannot recover its JavaScript stack or report
if the helper and renderer both stop. No durable hang record is promised across a process restart.

To investigate: select the affected release and runtime, find `ui.hang.suspected` / `ui.stall`, then
follow the recorded interaction trace. Compare API time with decode, merge, projection, row mounting,
and highlighting. Check workload counts and `ui.interaction.work` before assuming an individual
operation is slow. Compare runtime pressure and queue age when several surfaces degrade together.
A frame gap is a paint-opportunity measurement, not a guarantee that the compositor presented pixels.
Collection that is still off during startup does not retrospectively measure cache hydration. The
boot account is the exception: its marks are kept and sent as spans once collection turns on.

Local tests exercise a renderer that never answers, recovery, sleep, consent changes, failed diagnostic
transport, cancellation, delayed readiness, bounded workload series, slow trace attribution, and
highlight fallback without content. Before relying on Sentry, perform the live ingestion smoke in
Verification below, then reproduce opening a large agent history with collection enabled.

### Memory over a day

The desktop renderer is the WebKit web content process, and most of what it holds is WebKit's own
memory rather than the page's JavaScript heap. The page cannot read that process's memory, so these
gauges come from three places and are meant to be read against each other. All of them are gauges,
so each keeps its name in Sentry with no `.p50` or `.max` suffix.

| Metric | Unit | Attributes | Rate | Where |
| --- | --- | --- | --- | --- |
| `runtime.memory.footprint` | bytes | `runtime: renderer`, `owner: core` | 30 s | The shell reads the main window's web content process. macOS only |
| `runtime.memory.footprint` | bytes | `runtime: helper`, `owner: core` | 30 s | The shell reads the helper's process. macOS only |
| `ui.page.elements` | count | `runtime: renderer`, `owner: core` | 30 s, visible window only | `document.getElementsByTagName('*').length` |
| `ui.page.timeline_turns` | count | the same | the same | Drawn timeline turns, most of them agent transcript turns |
| `ui.page.query_entries` | count | the same | the same | Query cache entries for the active node |
| `ui.page.diff_cache.rows`, `ui.page.diff_cache.bytes` | count, bytes | the same | the same | The active node's diff segment cache, when a diff has been opened. The bytes are the cache's own estimate, not the heap |
| `ui.page.workers.tree`, `.highlight`, `.word_diff` | count | the same | the same | Live plugin tree workers, and the highlighter and word-diff workers, each 0 or 1. A worker module that has not loaded reports nothing |
| `agent.processes.live`, `.idle` | count | `runtime: node`, `owner: agents` | 60 s | Provider processes, and those the idle rules would stop now |
| `agent.processes.memory` | bytes (the record names no unit) | the same | 60 s | Resident bytes summed over each provider's process tree. Left out when `ps` fails |

The footprint is the physical footprint, which is what `footprint` and Activity Monitor's Memory
column show. Resident size undercounts on macOS because compressed pages leave it. That makes the
footprint and `runtime.memory.rss` two different measures, and the helper reports both. The node has
no footprint: only the shell can read one, and a batch the helper posts cannot claim the node's
runtime. Agent memory is resident size, because it is counted with `ps`.

The shell looks up the web content process's pid on every sample, so a renderer WebKit replaced
after a crash is measured under its new pid. A sample taken while the replacement is starting has no
process to read and reports nothing.

The helper asks the shell only while the switch is on, the page counts only while it is on and the
window is visible, and the agent count skips its `ps` while it is off. Off, each costs one boolean
read per tick. No count carries a name, a path, a key, or a query.

## What this is not

It is not an OpenTelemetry or Sentry dependency in core. An exporter is a plugin and may depend on
what it likes.

It is not the events model. `ctx.events` stays an invalidation channel, and nothing here rides the
WebSocket.

## Deliberate limits

Session replay is refused because the screen contains source code, diffs, agent transcripts and
terminal output. Uptime pings are refused because sleeping laptops are normal for a local node. Active-window
responsiveness checks exclude suspend gaps as described above.
Profiling remains deferred until a slow request or render cannot be attributed with spans and
histograms; it needs a separate profiler and sampling design for each runtime.

Core takes no OpenTelemetry SDK dependency or automatic monkey-patching. Exporters own vendor
formats and sampling. Telemetry uses HTTP batches, never the lossy WebSocket invalidation channel,
and has no general topic model or durable SQLite queue. The audit trail remains the durable record.
Key dispatch and paint paths report aggregate histograms without content, never per-keystroke feeds.
A logger and architecture rules replace console interception so ownership stays explicit.

Export happens on the node, which holds the encrypted DSN and sees every runtime. The separate
Sentry issue-reading integration would need an organisation token and different permissions; it
is not part of this exporter. Collection remains off by default, with one node switch rather than
per-signal consent in core.

## Verification

Automated coverage exercises the collector, runtime transport, redaction, attribution, permission
checks, exporter settings, envelope shapes, rate limits, retries, consent revocation and queue races.
The plugin integration tests run through a real host context and connection store with a mocked
HTTP endpoint. A live Sentry project smoke has **not** been completed: no project DSN was supplied
for the final review. Before relying on the exporter operationally, connect a test project and
confirm errors, linked transactions, logs, metrics and schedule check-ins appear there. This remains
an external verification gap, not a claim that the mocked endpoint proves Sentry ingestion.
