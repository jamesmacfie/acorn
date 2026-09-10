# Telemetry: the seams core owns, and the plugin that ships them to Sentry

Status: proposal, 2026-09-10. Phase 0 is being built in the session that wrote this folder; nothing
else has started.

This folder is the plan for opt-in telemetry in acorn. The ask was a Sentry plugin. A plugin can only
export what core lets it see, and today core lets it see nothing: there is no logger, no error
handler, no request-scoped context, and the one timing framework (`ACORN_PERF=1`) prints and forgets.
So the work is two stages. Stage one gives core five record kinds (spans, logs, events, metrics,
errors), stamps every record with the plugin or core code that caused it, and lets a plugin subscribe
to the stream. Stage two is `plugins/sentry-telemetry` (new), a loaded plugin that turns those records
into Sentry envelopes and posts them with a DSN the user pasted into Settings.

Everything is off until the user turns it on, and off costs one boolean read per seam. The record
model borrows OpenTelemetry's field names and none of its code, so a second exporter (Better Stack,
Coralogix, and Datadog all accept OTLP) reuses every seam here. Records carry allowlisted scalars,
never the user's prompt text, file contents, request bodies, or query payloads. The same rule the
audit trail already lives by (`packages/node-core/src/server/audit.ts` § `AuditEntry.details`).

## Where this came from

The owner read [Sentry's product page](https://sentry.io/welcome/) and asked what acorn would need
to support it as a plugin, and what the other vendors need, so the seams are built once.
[01-landscape.md](./01-landscape.md) is that survey. Four reads of the codebase mapped every place
acorn already logs, times, or catches, and every choke point where one hook sees everything;
[03-seams.md](./03-seams.md) is that map.

Where this folder and an owning doc under `docs/` disagree after a phase ships, the owning doc wins.

## The goals, in the order they appeared

1. **A plugin can export acorn's telemetry to Sentry.** Errors, traces, logs, metrics, and cron
   check-ins, with a DSN the user enters once. The plugin may leave this repo later, so it uses only
   the published plugin API.
2. **Slow things have an owner.** Every record says whether core or one named plugin caused it, and
   at which seam. A slow pane region, a slow plugin route, a slow schedule, and a slow page change are
   each one query away.
3. **Plugin authors get attribution for free.** A plugin that does nothing is already visible: its
   routes, schedules, hooks, frames, trees, and errors are timed and stamped by the host. Authors who
   want more get a logger and a span verb on `ctx`.
4. **Nothing leaves the machine that the user did not agree to.** One switch, off by default. Names
   are patterns, attributes are scalars, messages are scrubbed. A sink needs a permission token that
   the trust prompt renders as high.

## Decisions taken

Rows 1 to 9 were decided with the owner on 2026-09-10 and are settled. Rows 10 to 15 are the
programme's own rules, written here so a phase argues with them rather than around them.

| # | Decision | Why | What it forecloses |
| --- | --- | --- | --- |
| 1 | Signals are errors, spans, logs, metrics, and cron check-ins. Profiling is parked. Session replay and uptime are refused. | Those five map onto seams acorn has. Replay would record a screen that shows the user's code and agent transcripts. | No DOM recording, no heartbeat pings. [refused.md](./refused.md) has the arguments. |
| 2 | One node pref, `telemetry.enabled`, off by default. Sampling, which signals to export, and redaction choices live on the exporter's settings. | One switch is explainable. Every sink would otherwise re-read the same four toggles. | Core Settings gets one row. Per-signal and per-plugin consent are not built. |
| 3 | A real logger replaces `console.*`, migrated per runtime. `ctx.log` returns. | `ctx.log` was removed on 2026-08-27 because it was interchangeable with `console` and bought no attribution. It buys attribution now: the host binds the owner. | About 200 call sites move across phases 0, 1, 3, and 4. |
| 4 | An architecture rule forbids `console.*` outside the logger, as a shrinking baseline. | Migrations without a test drift back. | The baseline may only get shorter. |
| 5 | The exporter is `plugins/sentry-telemetry` (new), a loaded plugin in `BUNDLED_PLUGINS`. Its id is not `sentry`. | Ships in the app, inert until a DSN exists. `sentry` is reserved for the issue-reading integration, the Rollbar shape. | Two providers with the Sentry mark in Settings, on purpose. |
| 6 | The credential is the DSN only, stored through a connection provider with `kind: 'observability'` and `authKind: 'api-key'`. | Sending envelopes needs only the DSN. An organisation token is for releases and source maps, which are out of scope. | No release or source-map upload. No new core secret code. |
| 7 | The node gains one `AsyncLocalStorage` for ambient trace and owner, in phase 2, after measuring its cost. Phase 0 passes trace and owner by argument. | It is the first async-local store in the codebase. Git, SQLite, and process timings are unattributed without it. | Phase 0 attributes only what the seam already knows. |
| 8 | The terminal client, the desktop helper, and the Rust shell are in scope (phase 3). | A panic in the shell is a silent process death today. | Phase 3 waits on phase 1's transport. |
| 9 | The node is the collector. Every other runtime posts batches to `POST /v2/core/telemetry` (new route). Nothing rides the WebSocket or `ctx.events`. | The socket sheds under load and has no replay. `docs/plugins.md` § What is not an event refuses machine-scale streams there. | No telemetry on the invalidation channel. |
| 10 | Hot seams emit metrics, not spans. A seam that fires more than about ten times a second aggregates into one histogram per flush window. | A span per SQL statement is a payload problem before it is a Sentry bill. | SQL, WebSocket frames, terminal frames, bridge messages, and key dispatch are histograms. |
| 11 | `owner` is the one attribution key, `core` or a plugin id, stamped by the host at the seam. | Three spellings (`pluginId`, `providerId`, `plugin`) would make one query three. | An emitter cannot claim another owner. |
| 12 | Attributes are allowlisted scalars. Names are patterns. Ids ride as attributes. | The audit trail's rule, for the same reason: a record that quotes what it saw is a second copy of the thing. | No nested objects, no free text except a scrubbed message. |
| 13 | Nothing that leaves the machine is free text from the user's work. Messages pass a scrubber. A boundary that already withholds a message keeps withholding. | `onServerError` withholds `err.message` because drivers embed bound values in it. | Error records from that boundary carry a name and a code. |
| 14 | Telemetry never fails the thing it describes. | `recordAudit`'s rule. | Every emit is fire-and-forget; the ring drops oldest. |
| 15 | Sampling belongs to the sink. Core drops only at the ring cap. | Core cannot know which signals a vendor bills for. | No sample rate in core. |

## The admission rule for a span

A seam emits a span only if all three hold:

1. It is request-shaped: it starts because something asked and ends when the answer exists. HTTP
   requests, commands, page changes, schedule runs, hook runs, plugin dispatches, workflow steps,
   agent turns.
2. It fires fewer than about ten times a second under normal use. Past that it is a histogram.
3. Its name is a pattern that would read as one line for a hundred instances: `http.request` with
   `route` as an attribute, not a hundred URLs.

Anything else is a metric, an event, or nothing.

## One refusal reversed

`docs/plugins.md` § Activation and `docs/plugin-authoring.md` § The node half record that `ctx.log`
was removed on 2026-08-27: "interchangeable with `console` at every call site, so nobody reached for
it." That was true and is not anymore. A line written through `ctx.log` carries the plugin id the host
bound, reaches every sink, and is scrubbed on the way. Phase 0 puts it back and rewrites those two
paragraphs to say why.

## The files

| File | What it holds |
| --- | --- |
| [01-landscape.md](./01-landscape.md) | What Sentry, OpenTelemetry, Better Stack, Coralogix, and Datadog need from an SDK, and the five signals acorn supports. |
| [02-model.md](./02-model.md) | The record shapes, the attribute vocabulary, cardinality rules, the scrubber, the trace model. |
| [03-seams.md](./03-seams.md) | Every place a hook goes, per runtime, with what it emits and which phase adds it. |
| [04-plugin-dx.md](./04-plugin-dx.md) | What a plugin author sees at each level of effort, from nothing to writing a sink. |
| [05-sentry-exporter.md](./05-sentry-exporter.md) | Stage two: the exporter plugin, record by record. |
| [refused.md](./refused.md) | What was considered and refused, with the argument. |
| [docs-migration.md](./docs-migration.md) | Every document under `docs/` that changes, which phase changes it, and how. |

## The phases

| Phase | File | What it delivers | What it unblocks | Waits on |
| --- | --- | --- | --- | --- |
| 0 | [phase-0-node-collector.md](./phase-0-node-collector.md) | Record types in protocol; the node collector, logger, and scrubber; `ctx.telemetry`, `ctx.log`, and `ctx.core.telemetry.onBatch` behind a `telemetry` token; the `telemetry.enabled` pref; the `ACORN_PERF` console sink; request, error, schedule, hook, and dispatch instrumentation; node console migration; the console rule | Every sink. A plugin can already read a node's telemetry | Nothing |
| 1 | [phase-1-renderer.md](./phase-1-renderer.md) | The renderer emitter and its batched route; `traceparent` from the renderer; request, query, command, page-change, pane-region, frame, bridge, and tree instrumentation; an owner on every client contribution; the Settings row | Renderer-side attribution; phases 3 and 4 | 0 |
| 2 | [phase-2-node-attribution.md](./phase-2-node-attribution.md) | One `AsyncLocalStorage` so git, SQLite, and process timings carry the owner; workflow runs and agent turns as spans | "Which plugin made this git call slow" | 0 |
| 3 | [phase-3-other-runtimes.md](./phase-3-other-runtimes.md) | Terminal frame and key histograms; helper boot spans and broker health; a Rust panic record forwarded on next boot | The two runtimes with no plugins | 1 |
| 4 | [phase-4-authoring.md](./phase-4-authoring.md) | The frame SDK verb; the client export; the testkit recorder; a Settings page that shows what is being collected; the authoring docs | Stage two, and third-party sinks | 1 |
| 5 | [phase-5-sentry-exporter.md](./phase-5-sentry-exporter.md) | The exporter plugin, bundled | The thing the owner asked for | 0, 1, 4 |

## The order of work

Phase 0 stands alone and is the foundation: the record types, the collector, the two `ctx` members,
and the sink token. It also migrates the node's console sites and lands the rule that keeps them
migrated. Phase 1 is the renderer's half of the same thing and adds the one route that lets any
non-node runtime post a batch. After that, phases 2, 3, and 4 are independent of each other. Phase 5
waits on 4 because a plugin that runs only in a test needs the recorder, and on 1 because half of what
Sentry shows is renderer time.

## How to work a phase

Each phase file has the sections the client-plugins programme uses: goal, why now, scope, design
detail, code touched, tests, docs owed, doors left open, done when, verify before building.

- **Verify before building.** File and line references were checked against the tree on 2026-09-10.
  Paths rot. Run the verify list at the end of each phase file before writing code.
- **Update the owning doc in the same change.** [docs-migration.md](./docs-migration.md) says which
  document owns each behaviour afterwards. A phase is not done until that document says the new true
  thing.
- **A planned file is marked.** The documentation checker refuses a repo-rooted path in backticks
  that does not exist unless the line says `(new)`. Every file a phase adds is written that way here.
- **Never fail the thing you measure.** Every emit in every phase is wrapped so that a throwing sink,
  a full ring, or a missing pref cannot change what the measured code returns.

## What this folder is not

- It does not add an OpenTelemetry or Sentry dependency to core. The exporter may depend on what it
  likes; it is a plugin.
- It does not build the Sentry integration that reads issues into the rail. That is a second plugin,
  `sentry`, with the Rollbar shape, and `docs/future/integration-ideas.md` lists it.
- It does not build profiling, session replay, or uptime checks. [refused.md](./refused.md).
- It does not change the events model. `ctx.events` stays an invalidation channel.
- It does not schedule anything.
