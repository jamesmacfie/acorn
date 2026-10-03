# The telemetry model

This page covers the telemetry contract: the switch, the five kinds of record, which seams may emit a
span, the attribute vocabulary, what never leaves the machine, and traces. Read it before you add a
seam or an attribute. It's part of [telemetry](../telemetry.md).

## The switch

One Node preference, `telemetry.enabled`, is off unless the row reads `'1'`. Off costs one boolean
read at each seam and builds no record.

Collection needs two things at once: the preference on, and at least one sink subscribed. Neither
alone does anything, so "nothing leaves this machine that you didn't agree to" is true by
construction. With no sink there's no timer and no database read.

The collector reads the preference again on its own five-second tick, because `PUT /v1/core/prefs`
writes the table directly and has nothing to notify. A switch flipped in Settings is seen within five
seconds. The tick reads consent before it hands over its buffered window, and seeing off discards
pending records and histograms. Restart, stop, the last sink leaving, and an explicit preference
update invalidate older answers. `startTelemetry` returns a disposable preference-reader lease, and
disposing it detaches only that boot's reader.

`ACORN_PERF=1` is the third way in. It turns the collector on with no sink and no preference and
prints to stderr ([profiling](../local-development/profiling.md#timing-a-cold-start)).

## The five kinds

Every record is a flat object with a `kind` and an `attrs` map, declared in
`packages/protocol/src/runtime/telemetry.ts`. Times are milliseconds since the epoch, and durations
are milliseconds. Ids are lowercase hex, 32 characters for a trace and 16 for a span, the W3C sizes,
so a `traceparent` header round-trips with no conversion.

| Kind | What it is | Example |
| --- | --- | --- |
| `span` | Something that started because someone asked, and ended when the answer existed | `http.request`, `schedule.run`, `hook.run`, `plugin.dispatch` |
| `log` | A line somebody wrote, with a level and the tag that wrote it | `[schedules] github:refresh timed out` |
| `event` | Something happened, with no duration | `ws.shed`, `cache-miss` |
| `metric` | A count, a gauge, or a histogram aggregated over one flush window | `git.status`, `sql.select`, `telemetry.dropped` |
| `error` | A name, a scrubbed message, and sometimes a stack | an uncaught route error, a process crash |

The field names are OpenTelemetry's, and none of its code is here. Better Stack, Coralogix, and
Datadog all take OTLP, so a second exporter maps these names across rather than inventing a
translation.

## The admission rule for a span

A seam emits a span only if all three hold:

1. It's request-shaped. Something asked, and the span ends when the answer exists.
2. It fires fewer than about ten times a second under normal use.
3. Its name is a pattern that reads as one line for a hundred instances.

Anything else is a metric, an event, or nothing.

### Hot seams are metrics

Past about ten a second, a span per call is a payload problem before it's a vendor bill. Those seams
aggregate into one histogram per flush window: SQL statements, Git spawns, process spawns, WebSocket
frames, terminal frames, bridge messages, and key dispatch. A histogram carries `count`, `sum`, `min`,
`max`, `p50`, and `p95`, and costs one record every five seconds however hot the seam is.

Each emitter admits at most 200 histogram series per flush window, across all names, owners, label
sets, and units. Node durations are milliseconds, and client workload samples keep their own units.
Samples share a series only when those dimensions and the typed label values match. Label order
doesn't matter, and a delimiter inside a name or label can't merge distinct series.

At capacity, admitted series keep exact count, sum, minimum, and maximum. A new series is refused,
never stripped of labels or merged into another. The count metric `telemetry.histogram.refused`
reports refused samples apart from histogram totals, record drops, and truncations, uses no series
slot, and saturates at `Number.MAX_SAFE_INTEGER`. A flush resets capacity and the refusal count.

## The attribute vocabulary

Attributes are the only place a fact about one record goes. Keys are dotted and lowercase, at most 64
characters. A string value is cut at 512 characters, a record keeps at most 32 attributes, and a log
body is cut at 2,000 characters. The collector truncates rather than drops, and counts truncations as
`telemetry.truncated`. Keys and string values pass through the scrubber and are formatted onto one
line.

Two keys are reserved and stamped by the host. An emitter that sets one is ignored, not refused, so a
plugin can't fail its own route by mislabelling a span.

| Key | Values | Set where |
| --- | --- | --- |
| `owner` | `core` or a plugin id | The seam that knows: the plugin host binds it into `ctx.telemetry` and `ctx.log`, the request middleware derives it from `/v1/p/<id>`, the scheduler from the schedule key, and the hook runner from the handler's registration |
| `runtime` | `node`, `renderer`, `tui`, `helper`, or `shell` | The runtime that built the batch. A posted batch names its sender and can't say `node` |

The conventional keys, set by the seam that has the fact: `seam`, `route`, `method`, `status`,
`request.id`, `task.id`, `schedule.key`, `schedule.reason`, `hook.point`, `hook.handler`,
`hook.outcome`, `error.name`, and `error.code`.

An id is always an attribute, never part of a name. A span named `http.request` with a hundred `route`
values is one row in a vendor's list. A hundred span names is a hundred rows nobody can read.

## What never leaves the machine

This list matches what [lifecycle events](../plugins/events.md#shipped-first-party-events) keep out of broadcasts, plus
what the audit trail refuses:

- Prompt text, agent output, file contents, diffs, and terminal bytes.
- Request and response bodies, query text and bound values, and WebSocket payloads.
- Absolute paths. The scrubber collapses the owner's home directory to `~` and the data root to
  `<data>`, longest prefix first, so a worktree path keeps its repository-relative tail.
- Credentials. `packages/node-core/src/server/telemetry/scrub.ts` applies the token patterns the agents
  driver applies to provider output, strips control characters, and caps the result at 2,000
  characters. It's a copy, because core can't import a plugin.
- An error message a boundary already withholds. `onServerError` logs a name and a code, because
  drivers embed bound values in `err.message`, and its record carries the same.
- The owner's account. The serve-then-revalidate dedupe key is `<userId>:<resource>`, and only the
  resource reaches a sink.

The scrubber doesn't shorten every path-shaped string. Route patterns, channel names, and plugin
namespaces are slash-shaped, and collapsing them would make every record unreadable. The two paths
worth hiding are named.

Stacks are opt-in per record. The logger's `describeError` leaves them off, because a stack in a log
line buries the next fifty. The crash handlers put them on.

Pattern redaction recognizes known credential shapes. It can't recognize every credential or make
arbitrary private content safe to log, so a boundary that knows a credential's value withholds it or
redacts it exactly.

## Traces

A trace ties the records of one action together. The Node's request middleware reads a `traceparent`
header, makes the request span a child of the caller's, and puts the trace on the request context, so
an error inside the request lands in the same trace.

`traceparent` is attacker input. The parser accepts exactly the W3C form, two hex digits of version,
32 of trace id, 16 of parent id, and two of flags, and returns null for anything else, including the
all-zero ids the specification calls invalid. The raw header never reaches a log line.

Unattended work starts its own trace, because there's no caller's trace to join: a schedule run, a hook
chain, or a plugin dispatch. A hook chain is one trace, not one per handler, because three handlers
answering one question are one thing that happened. The renderer opens one trace per interaction
([the renderer](./renderer.md#one-trace-per-interaction)).
