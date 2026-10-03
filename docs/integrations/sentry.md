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
