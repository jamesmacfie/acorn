# Plugins and sinks

This page covers how a plugin writes telemetry, how a sandboxed frame does, how a plugin reads the
stream as a sink, and the Sentry sink that ships. Read it before you instrument a plugin or write an
exporter. It's part of [telemetry](../telemetry.md).
[The node half](../plugin-authoring/the-node-half.md#telemetry-and-logging) owns the verbs a plugin author calls.

## Writing telemetry from a plugin

`ctx.telemetry` and `ctx.log` are on both tiers and need no permission. Measuring your own work reads
nobody else's. The host binds the owner on every record from the plugin id, so a package can't file a
record under another package's name any more than it can mount a route under one.

Two compiled plugins do this. Workflows raises `workflow.run` and `workflow.step`
([what a run reports](../workflows/execution.md#what-a-run-reports)), and agents raises `agent.session`, `agent.turn`, and the
`agent.processes.*` gauges ([what a session reports](../managed-agents.md#what-a-session-reports)).

A plugin's client half has no `ctx.telemetry`, because a client context holds contribution points and
nothing else. It calls `telemetryFor('<plugin id>')` from `@acorn/plugin-api/client`, the same six
verbs against the renderer's emitter, and `createLogger(tag, '<plugin id>')` for a line. The id is an
argument there rather than a binding, as it is for the Node's `createLogger` in a compiled plugin's
module-level code. A compiled plugin is code in this process, so least privilege there is a
convention, not a wall.

`ctx.telemetry` and `ctx.log` are the two context members the host's revocation pass skips, because a
logger that throws after a reload would break the rule that instrumentation never fails what it
measures.

### A frame's own records

A sandboxed frame has no context to bind and no host module to import. It posts a `telemetry` message
over the bridge, which its SDK spells `bridge.telemetry` and `bridge.log`, and the host stamps the
owner from the binding (`packages/client-core/src/host/frames/frameTelemetry.ts`). Three things are the
host's, not the frame's:

- **The owner**, from the binding. A frame that names `github` in the message is ignored, not refused.
- **The ids.** A span arrives finished, with the duration the frame measured, and the host hangs it
  under whatever interaction is open. A frame that could name a trace could hang its work under
  someone else's click.
- **Admission.** A malformed record is dropped rather than answered, because the verb has no reply. A
  frame emitting in a loop trips the bridge's rate window and loses its port.

## Writing a sink

A plugin that reads the stream declares one grant:

```json
{ "permissions": { "node": { "core": ["telemetry"] } } }
```

```ts
export function init(ctx: NodePluginContext) {
  ctx.core.telemetry.onBatch((batch) => queue.push(batch))
}
```

A sink sees everything from every owner, which is why it's a grant and not a default, and why the trust
prompt draws it high ([telemetry sinks](../security/plugin-node-realm.md#telemetry-sinks)).

A sink must not block. The collector calls sinks in order on its timer, awaits none of them, and
contains a throw or a rejection. Buffering, retry, and sampling are the sink's job, because only the
sink knows what its vendor bills for. The returned `Disposable` lets a reload drop the subscription,
and the host clears the sinks of a plugin whose registrations it rolls back.

## The Sentry sink

`plugins/sentry-telemetry` is the sink that ships. It's a loaded plugin in the bundled roster, so it's
on every machine and does nothing until the switch is on and a Sentry DSN is connected in Settings →
Services. [integrations.md](../integrations.md#sentry) owns the connection. Its settings page holds
what only it can decide: a trace sample rate, which of the five kinds to send, whether to include
stacks, and whether to send `task.id` as a tag.

| Record | Sentry item |
| --- | --- |
| A span with no parent, plus every span under it in the batch | One `transaction` with a flat `spans[]` |
| A span whose parent is in another batch | Its own `transaction`, naming `parent_span_id`, stitched by trace id |
| A `schedule.run` span | Two `check_in` items, `in_progress` then `ok` or `error`, sharing one id |
| A log, and an event other than `ui.interaction.work` | Entries in one batched `log` item |
| An event | A breadcrumb on the error that followed it |
| A metric | Entries in one batched `trace_metric` item. A histogram goes as `p50`, `p95`, and `max` gauges plus a `count` counter |
| An error | An `event` with `exception.values[0]`, and parsed frames when stacks are on |

**A flush is several envelopes.** Most Sentry item types may appear once per envelope, and `event` and
`transaction` share the envelope's single `event_id`. So the exporter builds one envelope per error,
transaction, and check-in, plus one for the logs and one for the metrics.

**Transactions are assembled from the batch, never from a store.** Holding spans back to wait for a
root would be persistence under another name. A span whose parent already went out becomes its own
transaction naming the parent, which is what an SDK does when a trace crosses a process.

**Routine requests are sampled by value before trace sampling.** A request trace stays whole when the
same batch has a command, navigation, render, or other meaningful span, and a failed request is always
kept. Outside those, Sentry keeps renderer requests of at least one second and Node requests of at
least 250 ms. Successful `/v1/core/telemetry` and `/v1/core/prefs` spans are never exported, because
they describe the reporting machinery and were most of the stored spans. The trace sample rate applies
after this gate. Local and other sinks still see the whole stream. `ui.interaction.work` goes only as
a breadcrumb.

**The exporter is the last gate before the network.** Core scrubs log bodies, error messages, stacks,
and string attributes at ingest, so this pass checks what core takes on trust as a pattern: span,
metric, and event names and logger tags. `scrub` is on the plugin API for that.

Delivery is a queue of 200 envelopes that drops the oldest, with exponential backoff from one second
to two minutes on a network failure or a 5xx, and `X-Sentry-Rate-Limits` honoured per category
(`plugins/sentry-telemetry/src/server/exporter.ts`). A refused envelope is dropped, because a 400 is a
shape Sentry will refuse again. Connection and consent are checked before every attempt, retries
included. `ctx.core.telemetry.enabled()` reads the collector's consent, because a plugin's namespaced
preferences can't read the Node's row. Disconnecting, changing the target, or turning telemetry off
discards the queue at the next attempt. Each attempt has a ten-second deadline. Conversion holds at
most 200 pending batches. Nothing persists across a restart. The exporter reports only a
`sentry.dropped` counter about itself, with the reason and category.

## Limits

A live Sentry project smoke test hasn't been run, because no project DSN was supplied for the final
review. The tests exercise envelope shapes, rate limits, retries, and consent races against a mocked
endpoint. Before relying on the exporter, connect a test project and confirm that errors, linked
transactions, logs, metrics, and schedule check-ins arrive.
