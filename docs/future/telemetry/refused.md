# Refused: what was considered and set aside, with the argument

Part of [docs/future/telemetry/](./README.md). Each of these will be asked for again, and the
request will sound reasonable. This file exists so the argument is had once.

## The OpenTelemetry SDK as a core dependency

It would give spans, context propagation, and OTLP export for free. Refused. The SDK is a
process-wide singleton that assumes it owns the host's async context and instruments `http`,
`fetch`, and `fs` by monkey-patching, which is exactly the kind of ambient behaviour the process
broker and the plugin containment exist to refuse. Its API package alone is a peer of two lockfile
entries and a dependency of none. acorn borrows the field names, so an OTLP exporter is a serialiser,
and takes none of the code.

## Riding the WebSocket, or `ctx.events`

The node already broadcasts to every client and `onWsBroadcast` lets a plugin hear all of it with no
core change. Refused as the telemetry path, for three reasons the events design already wrote down:
the socket sheds under load (`ws:shed`) and has no replay, so telemetry would be lost exactly when it
matters; payloads there are state to re-read, not deltas; and `docs/plugins.md` § What is not an
event refuses per-render, per-step, and machine-scale streams by name. Batches go over HTTP.

## A general topic or subscription model

Refused in `docs/performance.md` § What was refused with an exit condition that needs a second
machine, and nothing here changes that. Sinks subscribe to the whole stream and filter; there are no
topics.

## Session replay

Sentry's headline feature after errors. Refused. Replay records the DOM, and acorn's DOM is the
user's code, their diffs, their agent transcripts, and their terminal. Masking text by default, which
Sentry does, leaves a replay of nothing useful. A user who wants to see what happened has the
transcript.

## Profiling

Parked, not refused. Continuous CPU profiling would answer "where did the node spend its time" better
than a histogram. It needs a per-runtime profiler (`--cpu-prof` or the inspector on the node, the
browser's profiler in the renderer), a format per vendor, and a sampling story of its own. The exit
condition: a slow-render or slow-request report that the spans and histograms here cannot attribute.

## Uptime monitoring

A local-first node has nothing to be up for when the laptop is closed. A heartbeat from the node
would alert on every sleep. Refused. The crash budget and the `node.crash` event are the health
signal.

## Per-keystroke, per-render, per-agent-step records

Refused for the same reason `runtime:focus-changed` is coarse on purpose: a per-keystroke feed is the
most surveillance-shaped thing a stream could carry, and a per-render feed is a payload problem. Key
dispatch and frame paint are histograms with no content.

## A console tap instead of a logger

Wrapping `console.*` once per runtime and parsing the `[tag]` prefix would have captured every line
with no call-site changes. The owner chose the logger on 2026-09-10: a tap keeps the free-text habit,
loses the attributes, and leaves the plugin author with `console`, which is the state that got
`ctx.log` removed in the first place. The migration is about 200 sites and a rule holds it.

## Exporting from the renderer

The renderer could post to Sentry directly, as the browser SDK does. Refused. The DSN is a
credential and lives on the node behind the connection seam; egress from the renderer is the policy
`docs/security.md` § The renderer's policy and its dangerous sinks spends a section closing; and the
node is the only runtime that sees every other runtime's records, so it is the only place a trace
that spans the renderer and the node can be assembled.

## Persisting telemetry in SQLite

A `telemetry` table would let a sink catch up after a restart and let Settings show history.
Refused. The audit trail is the durable record, with a closed vocabulary because durability is what
makes free text dangerous. Telemetry is a ring in memory; a restart loses what was not flushed and
the exporter says so once. If a local telemetry view earns its keep, it reads the ring.

## The Sentry integration in the same plugin

One plugin, one Sentry mark, one DSN and one auth token. Refused. The exporter needs a DSN and reads
acorn; the integration needs an organisation token and reads Sentry. They have different permission
lines, different trust sentences, and different reasons to be installed. Two plugins, two providers.

## On by default

Refused. The trust story for a local-first tool is that nothing leaves the machine unless the user
said so, and `docs/security.md` § Credential handling spends its length on that. One switch, off.

## Sampling in core

A `telemetry.sampleRate` pref beside the switch. Refused. Core cannot know which signals a vendor
bills for or which the user cares about; a rate in core would under-sample for one sink and
over-sample for another. Core drops only at the ring cap and says how many it dropped.
