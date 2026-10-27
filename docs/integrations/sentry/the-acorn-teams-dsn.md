# The acorn team's DSN

This page covers how a release build reports to the acorn team's own Sentry project: where the DSN
comes from, the consent switch, the fixed policy, and the source maps that make its stacks readable.
[Sentry](../sentry.md) owns the exporter and its connection.

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

## Readable stacks

Every bundle ships minified, so a tag build uploads source maps to Sentry and ships none. The
**Upload source maps to Sentry** step in `.github/workflows/build-desktop.yml` runs for a `v*` tag
when the repository secret `SENTRY_AUTH_TOKEN` and the repository variables `SENTRY_ORG` and
`SENTRY_PROJECT` are set. A fork, a manual run, or a repository without them builds no maps and skips
the step.

The workflow sets `ACORN_RELEASE_SOURCEMAPS` for that case. With it, the desktop build writes hidden
source maps for the renderer, the helper, and each bundled plugin, and staging keeps the Node
service's maps. The step runs `sentry-cli` through `npx`, pinned to one version. It adds a debug ID
to each staged file and its map, then uploads the maps under three names:

| Staged folder | Uploaded as |
| --- | --- |
| `apps/desktop/dist/helper` | `app:///helper/<file>` |
| `apps/desktop/dist/bundled-plugins` | `app:///plugins/<id>/dist/<file>` |
| `apps/desktop/dist/client` | `~/<file>`, which matches the renderer's `app://acorn/` and `http://app.localhost/` |

Each upload names release `acorn@<desktop version>` and dist `<platform>-<arch>`, such as
`darwin-arm64`. Every OS builds its own bytes, and Sentry looks up a map by release and dist
together. The step then deletes every map. `verifyResources` in
`apps/desktop/scripts/bundle-inventory.mjs` fails the bundle check on any `.map` file in the packaged
app. The token stays in that one step's environment.

The exporter builds its own events, so nothing sends Sentry the debug IDs an SDK would. It matches
the uploads by name instead. `parseStack` renames a frame whose path ends in `helper/<file>.js` or
`plugins/<id>/dist/<file>.js` to the name above, wherever the app is installed. Every error event
carries the dist beside its release. The Node service and the plugins' Node halves read cleanly this
way. A plugin's client bundle runs on its own `app-plugin://` origin and gets no uploaded name.
