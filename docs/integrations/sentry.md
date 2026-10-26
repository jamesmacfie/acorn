# Sentry

Two plugins talk to Sentry. `sentry-telemetry` sends this Node's own telemetry to a Sentry project.
`sentry` reads a project's unresolved issues into the rail and links them to tasks. This page covers
both connections, the environment variables each reads, how the issues rail scopes to a workspace,
issues in tasks, palette search, and the limits on an event. The plugins are in `plugins/sentry-telemetry/` and `plugins/sentry/`.

## Sentry

`sentry-telemetry` is a sink, not an integration. It reads the Node's telemetry and posts it to Sentry
as envelopes: an error becomes an issue, a span a transaction, a log record a structured log, a metric
a trace metric, and a `schedule.run` span a cron check-in
([writing a sink](../telemetry/plugins-and-sinks.md#writing-a-sink)). It mirrors and browses nothing,
so it registers a `ConnectionProviderContribution`, and its only surface is a settings page.

The issues plugin, `sentry`, is a separate plugin because it needs a different credential. The
exporter needs a DSN, which can only send to one project. The issues plugin needs an auth token,
which reads the whole organization, and one plugin holding both would ask for the wider credential
to do the narrower job.

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

## Sentry issues

The `sentry` plugin lists one Sentry project's unresolved issues in the rail, newest first, as the
**Sentry issues** source. A row shows the level as an icon, the title, and the event count. A
collapsed row shows the short ID, such as `WEB-1`. Picking a row draws the issue beside the list at
`/p/:projectId/x/sentry/issues/:issue`, with no task: the title, the culprit, first and last seen,
the event and user counts, and the latest event's message and stack, newest call first.

The plugin reads Sentry live on every request and mirrors nothing. It registers an integration,
because core stamps a task link only for a provider with external IDs, but it declares no resource and
no codec, and keeps no item cache. It reads three routes of Sentry's API:

- `GET /api/0/organizations/<org>/issues/?project=<slug>&query=is:unresolved&sort=date&limit=100`
  for the rail. Sentry deprecated the per-project issues route in favor of this one.
- `GET /api/0/organizations/<org>/issues/<id>/` for the issue.
- `GET /api/0/organizations/<org>/issues/<id>/events/latest/` for its latest event. An issue whose
  event can't be read is still drawn, without the event.

The routes were checked against Sentry's API documentation on October 26, 2026. No real token was
available to check a response. Its plugin routes are `GET /v1/p/sentry/rail-items?project=<id>`,
`GET /v1/p/sentry/palette/issues?projectId=<id>&q=<text>`, and
`GET /v1/p/sentry/issues/<id>?connection=<id>`, in `plugins/sentry/src/server/routes.ts`.

A failure answers with the provider error code and a plain sentence, which the rail and the detail
draw as they are. A token Sentry turns down answers 401 with "Sentry turned down the token for
`<label>`. It needs event:read." The label names the connection or the environment, and no answer,
log line, or error carries the token.

## Sentry issues in tasks

A rail row from a Settings connection carries a `task` block, so the row's menu offers **Create
task…**, and the host's promotion dialog makes the task, or adds the issue to an open one, as it does
for [Rollbar](./rollbar.md#rollbar). The link's identifier is the issue's numeric ID, and its ref
carries the issue's Sentry address. A row whose issue a task already links offers **Open task**
instead. `sentryRailItem` in `plugins/sentry/src/shared/rail.ts` builds the block.

A row read through the environment carries no `task` block, so it offers no task. Core stores a task
link against a connection's row in `integrations`, and the environment has none. The variables can
also name another organization after a restart, and a link has to keep meaning the same issue. To
link issues to tasks, connect Sentry in Settings.

The issue's detail has no **Make a task** button. A tree can't open the host's promotion dialog, and
making the task from the tree would need `core.tasks:write` and would skip the dialog's branch step.

The task pane, **Sentry**, declares `providerId: 'sentry'`, so the host shows it only on a task with a
Sentry link. It reads the task's links through `/v1/core/tasks`, which is why the manifest asks for
`core.tasks:read`. One link draws that issue. Several draw a list beside the detail, with each issue's
title and its current event count, read live through the detail route.

The detail's **Open in Sentry** button hands the issue's `permalink` to the host's `openUrl`, which
opens it in the browser. The normalizer keeps the address only when it's `https`.

## Palette search

**Find a Sentry issue** is a `scope: 'project'` search command, so the host sends the project the
palette captured and offers the command only where there is one. Its route reads the same issues as
the rail, through the same scope, then ranks them with `sentrySearchItems` in
`plugins/sentry/src/server/paletteSearch.ts`. An exact short ID ranks first, then a title that starts
with the text, a title that contains it, and last a match in the short ID, the culprit, or the level.
Equal matches keep Sentry's newest-first order. Picking a row navigates to the issue beside the rail.

Unlike Rollbar's, the search reads Sentry on each query, because the plugin has no mirror to filter.
The palette debounces typing, and each query costs one call per connection.
[From the command palette](../integrations.md#from-the-command-palette) has the shared rules.

## The issues connection

The connection is `kind: 'error-tracker'` and `authKind: 'api-key'`, with four fields: the auth token
as a password, the organization slug, the project slug, and the Sentry address. The address is
optional and defaults to `https://sentry.io`. Use `https://de.sentry.io` for the EU region.
`validate` refuses any other host up front, because the manifest's `permissions.node.net` names only
`sentry.io`, `us.sentry.io`, and `de.sentry.io`. It then reads `GET /api/0/projects/<org>/<project>/`
once, which proves all four fields, and records the project's numeric ID.

`normalize` labels the row `Sentry · <org>/<project>` and puts the organization, the project slug,
the host, and the project ID in `config`. The token needs `event:read` to list issues and
`project:read` for the check.

## Credentials from the environment

A developer can skip the Settings step. Set `ACORN_SENTRY_TOKEN`, `ACORN_SENTRY_ORG`, and
`ACORN_SENTRY_PROJECT` in the environment that starts the Node, and the rail shows that project's
issues. `ACORN_SENTRY_URL` picks the region, and defaults to `https://sentry.io`. All three of the
token, organization, and project must be set, or the environment counts as unset. A partial set, or
an address on another host, logs one warning that names the variables and never a value.

Any Sentry connection in Settings wins over the environment, so a person can point at their own
project without unsetting anything. While one exists, the plugin reads nothing through the
environment, and a detail request that names the environment answers 403.

The manifest names the four variables in `permissions.node.env`
([the plugin realm](../security/plugin-node-realm.md)). The worker reads them once, at start, so a
change needs a Node restart. `pnpm dev` passes them through Turborepo's strict environment mode, and
`pnpm dev:agent` inherits the shell's environment ([local development](../local-development.md#environment)).

## Scoping

A Sentry connection is one project, so its project source makes no outbound call and returns the
project `validate` recorded. The rail scopes on the connection IDs in the routed project's workspace
map, as [Rollbar's does](./rollbar.md#scoping). A link narrowed to one project covers only that
project. A rail request with no `?project=`, or one naming no project, returns no rows.

The environment's credential has no connection row, and the workspace map can't hold one:
`externalProjects` joins each map row to `integrations`, and the mapping picker lists only connection
rows. Its rows carry the fixed connection ID `env`, and they show in every project's rail. That's the
developer's own Node-wide choice, as the exporter's `ACORN_SENTRY_DSN` is.

The **Sentry issues** source declares no `providerId`, unlike Rollbar's. The shell hides a source
with one until a Settings connection is linked, which would hide the environment's rows and the
empty state. So the source shows whenever the plugin is installed. With no connection and no
environment, it fetches nothing, and its empty state says how to connect.

## Event limits

An event is capped at 10 exceptions in its chain, 200 frames in total, 7 source lines per frame,
8 KiB per string, and 192 KiB per detail (`CAPS` in `plugins/sentry/src/server/normalize.ts`), the
same kinds of caps as Rollbar's. A detail over the last cap loses half its frames at a time until it
fits, and the view then says acorn left part of the event out. Tests assert against the same
constants.

The normalizer is an allowlist. It keeps the event's ID, time, exception type and message, frames,
environment tag, and release version. It drops the user, the request, breadcrumbs, contexts, every
other tag, and each frame's local variables.
