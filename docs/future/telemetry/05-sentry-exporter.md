# The Sentry exporter

Part of [docs/future/telemetry/](./README.md). Stage two. This is the plugin the owner asked for,
designed against the seams stage one builds. It is a sink, not an integration: it sends acorn's own
telemetry to Sentry. The plugin that reads Sentry issues into the rail, the Rollbar shape, is a
different plugin with the id `sentry`, and `docs/future/integration-ideas.md` lists it.

## Package

`plugins/sentry-telemetry/` (new), a loaded plugin with `acorn-plugin.config.mjs`, added to
`BUNDLED_PLUGINS` in `apps/desktop/scripts/build-bundled-plugins.mjs` so it ships in the app and
stays inert until a DSN exists. It may leave the repo later, so it imports only
`@acorn/plugin-api/node`, `@acorn/plugin-api/client`, and its own files.

Manifest, the parts that matter:

```json
{
  "id": "sentry-telemetry",
  "name": "Sentry (telemetry export)",
  "permissions": {
    "node": { "core": ["telemetry", "prefs"], "secrets": false, "net": ["sentry.io", "*.ingest.sentry.io"] }
  },
  "contributions": { "frames": [{ "target": "settings", "surface": "settings" }] }
}
```

`secrets: false` is the Rollbar and Linear posture: the provider spends the DSN through the connection
seam, which lends it for the length of one call, and never through `ctx.core.secrets`. `net` is
disclosure only until the credential broker lands; a self-hosted Sentry adds its host to the list.

## The credential

The DSN is a connection. `ctx.providers.connection(publicConnectionProvider({...}))` with
`kind: 'observability'`, `authKind: 'api-key'`, and one password field, `dsn`. That gives the plugin
the Settings form, encryption under the session key, the `secret.created` audit row, connect, test,
rotate, and disconnect, with no core code. `validate` parses the DSN into public key, host, and
project id and posts an empty envelope to prove the host answers. `normalize` labels the row
`Sentry · <host>/<project>` and puts `environment` and `release` in `config`, which is non-secret and
provider-owned. `test` re-posts the empty envelope.

Reading the DSN back happens in `ctx.providers.withConnection(userId, 'sentry-telemetry', visit)`,
which hands the plaintext to one callback for the length of the flush.

## Record to envelope

One envelope per flush, at most one `log` item and one `trace_metric` item per envelope as the
protocol requires, posted to `https://<host>/api/<project>/envelope/` with the DSN in the envelope
header. `sent_at` and `sdk: { name: 'acorn.sentry-telemetry', version }` on every envelope.

| acorn record | Sentry item | Mapping |
| --- | --- | --- |
| span with no parent | `transaction` | `transaction: name`, `contexts.trace: {trace_id, span_id, op: name, status}`, `start_timestamp`, `timestamp`, `tags` from attrs, `spans[]` = every span in the batch sharing the trace id, flattened |
| span with a parent whose root is not in the batch | `span` (standalone) | The same fields, one item |
| span named `schedule.run` | `check_in`, two items | `monitor_slug` from `schedule.key` (sanitised to Sentry's slug charset), `in_progress` at `start`, then `ok` or `error` with `duration`; `monitor_config.schedule` as `{type: 'interval', value, unit: 'minute'}` from the cadence the node reports, `max_runtime` from the schedule's timeout, `checkin_margin` one interval |
| log | `log` item entries | `timestamp`, `trace_id` (the record's or a fresh one), `level`, `body`, `attributes` typed from the scalar, plus `sentry.sdk.name`, `sentry.environment`, `sentry.release` |
| event | breadcrumb on the next error in the same trace, and a `log` entry at `info` | Sentry has no standalone event item; a breadcrumb is what its UI shows |
| metric | `trace_metric` entries | `count` → counter, `gauge` → gauge, `histogram` → one distribution entry per sample would lose the pre-aggregation, so the exporter sends `p50`, `p95`, `max` as three gauges named `<name>.p50` and so on, plus `count` as a counter |
| error | `event` | `exception.values[0] = {type: name, value: message, stacktrace}` when a stack is present, `level`, `handled` in `mechanism`, `tags` from attrs, `contexts.trace` from the trace id, `logger: attrs.owner` |

Every item gets `environment` and `release` from the connection's `config`, `server_name` as the
node's id, and `tags.runtime` and `tags.owner` from the record.

## Settings

The connection row in Settings → Integrations is the on switch: no connection, no export. The
plugin's own settings frame (`contributions.frames` with `target: 'settings'`) holds what the core
switch does not: a sample rate for spans (default 1.0, because a single-user tool produces little),
which record kinds to send (all five on), whether to include stacks (on), and whether to include
`task.id` attributes (on). Values live in `plugin:sentry-telemetry:*` through the frame's `state`
verb, which is the same namespace the node half reads through `ctx.core.prefs`. Nothing here is a
secret.

## Delivery

A bounded in-memory queue, 200 envelopes, drop oldest. Retry on network failure with exponential
backoff from one second to two minutes. Honour `429` and `X-Sentry-Rate-Limits` per category: a
rate-limited category is dropped, not queued, until the window ends. Never block a flush on a
previous envelope. Nothing persists across a restart; a node that restarts loses what it had not
sent, and says so as one `log` entry on the next boot.

## What links the two Sentry plugins later

Every record with a `task.id` attribute becomes a Sentry tag. When the `sentry` integration exists,
an issue tagged with a task id can link to the task the same way a Rollbar occurrence does through
`tracksRef`. Nothing in this plugin waits on that.

## Smoke

Against a real project on sentry.io: enter a DSN, turn the core switch on, open a task, and run a
command. Sentry shows one transaction with a renderer `command` root and a node `http.request` child
sharing a trace id, one issue from a plugin route that throws, and one cron monitor with a check-in
from `core:audit-prune` or a plugin schedule. Turn the switch off and confirm the next flush sends
nothing.
