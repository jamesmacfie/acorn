# Sentry

The `sentry-telemetry` plugin sends this Node's own telemetry to Sentry. This page covers its
connection and why it's separate from a Sentry issue integration. The plugin is in
`plugins/sentry-telemetry/`.

## Sentry

`sentry-telemetry` is a sink, not an integration. It reads the Node's telemetry and posts it to Sentry
as envelopes: an error becomes an issue, a span a transaction, a log record a structured log, a metric
a trace metric, and a `schedule.run` span a cron check-in
([writing a sink](../telemetry/plugins-and-sinks.md#writing-a-sink)). It mirrors and browses nothing,
so it registers a `ConnectionProviderContribution`, and its only surface is a settings page.

The ID `sentry` is held back for a plugin that would read Sentry issues into the rail, shaped like
Rollbar. Nothing is built ([integration ideas](../future/integration-ideas.md)). The two stay separate
because they need different credentials. The exporter needs a DSN, which can only send to one
project. The integration would need an organization token, which reads the whole account, and one
plugin holding both would ask for the wider credential to do the narrower job.

## The connection

The connection is `kind: 'observability'` and `authKind: 'api-key'`, with three fields: the DSN as a
password, and `environment` and `release` as text. `validate` parses the DSN into a public key, a
host, an optional path, and a numeric project ID, then posts an envelope with a header and no items to
prove the host answers. Sentry stores nothing for that, so a test costs no quota. `normalize` labels
the row `Sentry · <host>/<project>` and puts the two text fields in `config`.

`maxConnections` is 1, because the exporter uses the first usable row and a second would get nothing.
To send to a staging project, replace the DSN or change `environment` on the one row.

The exporter reads the DSN through `ctx.providers.withConnection` once per flush, so disconnecting
stops the export within one five-second window. [Credential handling](../security/credentials.md) has
the posture, and [the Sentry sink](../telemetry/plugins-and-sinks.md#the-sentry-sink) has what the
exporter does with a batch.

## The DSN from the environment

A developer can skip the Settings step. Set `ACORN_SENTRY_DSN` in the environment that starts the
Node, turn on **Collect timings, logs, and errors on this node**, and the exporter sends to that
project. It tags every record with environment `development` and release `acorn@<node version>`.
The connection's `environment` and `release` fields apply only to a connection.

A connection in Settings wins over the variable, so you can point at your own project without
unsetting anything. A connection whose stored DSN no longer parses still wins, and sends nothing.

The manifest names the variable in `permissions.node.env`, because a loaded plugin's worker sees no
other environment ([the plugin realm](../security/plugin-node-realm.md)). The worker reads it once,
at start. A value that doesn't parse as a DSN logs one warning that names the variable and never its
value, and the exporter sends nothing to it.

While the variable is in use, the settings page says "Sending to `<host>/<project>` from
`ACORN_SENTRY_DSN`." It gets that line from the plugin's own `GET /v1/p/sentry-telemetry/source`
route, which answers with the host and project ID and never the key. The route answers `null`
while a connection overrides the variable.

`pnpm dev` passes the variable through Turborepo's strict environment mode, and `pnpm dev:agent`
inherits the shell's environment. You can also put it in the desktop's `.env` file
([local development](../local-development.md#environment)).
