# The acorn team's DSN

This page covers how a release build reports to the acorn team's own Sentry project: where the DSN
comes from, the consent switch, and the fixed policy. [Sentry](../sentry.md) owns the exporter and its
connection.

## The resolution order

The exporter resolves its DSN in this order:

1. A Sentry connection in Settings.
2. `ACORN_SENTRY_DSN` in the environment that started the Node.
3. The team's DSN, built in, when **Collect timings, logs, and errors on this node** and **Share with
   the acorn team** are both on.

A connection whose stored DSN no longer parses still wins, and so does an `ACORN_SENTRY_DSN` that
doesn't parse. Both send nothing rather than fall through to the team.

## The build

The tag build reads the repository secret `ACORN_SENTRY_DSN` into `ACORN_SENTRY_RELEASE_DSN` for the
desktop build step in `.github/workflows/build-desktop.yml`, and only for a `v*` tag. A manual run
from a branch gets an empty value. `apps/node/scripts/build-plugin.mjs` writes the variable into the
`sentry-telemetry` node bundle as the constant `__ACORN_SENTRY_RELEASE_DSN__`. Every other build
writes an empty string, and source run from a checkout has no constant, so a dev build and a fork
carry no DSN.

The build reads a different name from the run-time variable, so a developer's own `ACORN_SENTRY_DSN`
never lands in a bundle. Turborepo's strict environment mode drops `ACORN_SENTRY_RELEASE_DSN` from
its `build` task, so only a direct `pnpm --filter @acorn/desktop run build` carries it. The
standalone Node archive and the CLI don't carry the DSN.

## The consent switch

**Share with the acorn team** is on the Sentry export settings page, off by default. It's its own
preference row, `plugin:sentry-telemetry:share`, and only a stored `true` turns it on. The page shows
it only while the plugin's `GET /v1/p/sentry-telemetry/source` route answers `shareable: true`, which
means the build carries a DSN and neither a connection nor `ACORN_SENTRY_DSN` is in use.

Turning it off makes the target resolve to nothing, so the exporter discards its queue at the next
attempt, as it does after a disconnect.

## The fixed policy

With the team's DSN, records carry environment `production` and release `acorn@<node version>`. The
exporter ignores the settings page and uses `TEAM_SETTINGS`
(`plugins/sentry-telemetry/src/shared/settings.ts`), which the target carries:

| Kind | Sent |
| --- | --- |
| Errors | On, with stacks |
| Traces | On, one trace in twenty (0.05) |
| Logs | Off |
| Metrics | Off |
| Events | As breadcrumbs on errors only |
| Task IDs as tags | Off |

## Only official plugins

The team's project takes records only from core and from plugins acorn ships unmodified. A half-built
plugin someone installed would otherwise fill it with its own errors.

Every record's `attrs.owner` is `core` or a plugin id, stamped by the host. An id alone doesn't prove
where the code came from: a folder install can take a bundled plugin's id, and an edited bundled
package keeps it. So core puts `official` on every batch. It lists the compiled-in plugins, and each
loaded plugin that's bundled with acorn (no lockfile), doesn't shadow a built-in, and still matches
the fingerprint reconciliation recorded. The loader hashes the package again at each load, and the
plugin host republishes the list after every boot, reload, and uninstall.

The team's target carries `officialOnly`, and the exporter drops every record whose owner is neither
`core` nor in `official`, after redaction and before it builds envelopes. Each record is judged on its
own. In a trace that starts in core and passes through an unofficial plugin, the core spans go and the
plugin's don't, and nothing is re-parented, so Sentry shows the gap as untracked time. An error a bad
plugin causes inside core arrives as `core` and goes, because it's core's to harden against.

A Settings connection and `ACORN_SENTRY_DSN` get every owner's records, as before.

The client can't be trusted to cap its own cost. The team's Sentry project has spike protection on
and a rate limit on its client key, and the exporter honours `X-Sentry-Rate-Limits`.
