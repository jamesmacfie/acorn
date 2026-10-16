# Send opted-in telemetry to the acorn team's Sentry

Date: October 17, 2026. Status: proposed. Implementation not started.

Use this plan to make a release build send errors and sampled traces to the acorn team's own Sentry
project when someone opts in, without anyone pasting a DSN. It covers the built-in DSN, a second
consent switch, defaults sized for many installs, a filter that keeps records only from core and
official plugins, source map upload, and the docs that stop being true. [Plugins and
sinks](../telemetry/plugins-and-sinks.md#the-sentry-sink) and [the Sentry
connection](../integrations/sentry.md) own the exporter as it ships.

## Problem

acorn has no telemetry destination of its own. The Sentry export plugin sends nothing until someone
connects their own DSN in Settings, so the team never sees a crash from a real install. The privacy
page says so in its first paragraph: "acorn has no telemetry server of its own."

Pointing every install at one project brings two new problems. The exporter's defaults assume one
person's data: every kind on and no sampling. And a sink sees every record from every owner, so a
half-built or badly written plugin someone installed would fill the team's project with its own
errors and logs.

## Goal

- A tag build carries the team's DSN. A dev build and a fork carry none.
- Nothing leaves the machine unless the person turns on a switch that says the records go to the
  acorn team.
- A person who connects their own Sentry gets everything, as today. The built-in DSN is only the
  fallback.
- With the built-in DSN, only records owned by core or by an unmodified official plugin are sent.

## Starting point

Recheck these against the checkout before you start.

| Piece | Where |
| --- | --- |
| The exporter's activation, and `target()`, which resolves the DSN once per flush | `plugins/sentry-telemetry/src/node/index.ts` |
| `DEFAULT_SETTINGS`: every kind on, sample rate 1 | `plugins/sentry-telemetry/src/shared/settings.ts` |
| Redaction, then envelope building, run per batch | `plugins/sentry-telemetry/src/server/exporter.ts` (`convert`) |
| The `net` allowlist, which already covers `*.ingest.sentry.io` | `plugins/sentry-telemetry/acorn-plugin.config.mjs` |
| The plugin bundler, which minifies with oxc and writes hidden source maps only on `--sourcemap` | `apps/node/scripts/build-plugin.mjs` |
| The bundled roster | `scripts/bundled-plugins.mjs` (`BUNDLED_PLUGINS`) |
| A folder install that takes a built-in's id loads instead of it | `packages/node-core/src/server/plugins/loader.ts` (`shadowsBuiltin`) |
| A hand-edited bundled package becomes user-managed | `packages/node-core/src/server/plugins/bundled.ts` |
| The consent switch, **Collect timings, logs, and errors on this node** | `packages/client-core/src/features/settings/corePages.ts` |
| A public credential with a built-in default and an env override | `plugins/github/src/server/config.ts` |
| The tag build | `.github/workflows/build-desktop.yml` |

Every record carries `attrs.owner`, `core` or a plugin id, stamped by the host. A plugin can't set
it ([writing telemetry from a plugin](../telemetry/plugins-and-sinks.md#writing-telemetry-from-a-plugin)).
Each batch carries the app `version`.

## Phase 1: the built-in DSN

A DSN can only write to one project and can't read anything back, so it isn't a secret. The GitHub
client id sets the precedent for shipping a public credential. Don't copy its shape, though: a
default in the source would make every fork and every dev build report to the team's project.

1. Add a GitHub Actions repository variable, `ACORN_SENTRY_DSN`. A variable, not a secret, because
   the value ends up in a public download.
2. Pass it to the plugin build in `build-desktop.yml` only. `build-plugin.mjs` writes it into the
   sentry-telemetry bundle as a compile-time constant. Every other build gets an empty string.
3. In `target()`, use the person's own connection when there is one. Otherwise, when the constant is
   set and both consent switches are on, use the built-in DSN.
4. With the built-in DSN, set release to `acorn@<batch.version>` and environment to `production`.
   The manual fields stay for people using their own DSN.

Acceptance: a tag build with both switches on sends a test error to the team's project. A local
`pnpm --filter @acorn/desktop run build` produces a bundle with no DSN in it. Connecting your own DSN
sends to yours and nothing to the team's.

## Phase 2: consent

Collecting records locally and sending them to someone else are separate decisions. The existing
switch means the first one, and Settings → Telemetry is useful with only that switch on.

Add **Share with the acorn team** to the Sentry export settings page. Show it only when the build
carries a DSN and no personal connection exists. Off by default. The copy names what goes (errors
and sampled traces), what never goes (the existing list on the privacy page), and where it goes
(Sentry, in the region the project was created in).

Acceptance: with the collection switch on and the new switch off, nothing reaches the team's
project. Turning the new switch off discards the queue at the next attempt, as disconnecting does.

## Phase 3: defaults for many installs

`DEFAULT_SETTINGS` says "a single-user tool produces little". That's true of one person's DSN and
false of the team's. With the built-in DSN, ignore the settings page and use a fixed policy:

| Kind | Built-in DSN |
| --- | --- |
| Errors | On, with stacks |
| Traces | On, sampled at 0.05 |
| Logs | Off |
| Metrics | Off |
| Events | Breadcrumbs on errors only |
| Task ids as tags | Off |

Tune the sample rate after a week of real volume.

In Sentry, turn on spike protection and set a rate limit on the client key. That's the real cost
cap, because a client can't be trusted to limit itself. The exporter already honours
`X-Sentry-Rate-Limits`.

## Phase 4: only official plugins

The filter belongs in the exporter, after redaction and before envelope building, and applies only
to the built-in DSN. It keeps a record when its owner is `core` or official, and drops it otherwise.

A plugin id alone doesn't prove a record is official. A folder install can take the id `linear` and
load instead of the bundled one, and someone editing the bundled package turns it user-managed.
Both still stamp `linear`. That's the case this phase exists for: someone's development copy filling
the team's project.

Core knows where each plugin came from, and the sink doesn't. So core decides:

1. Add `official: readonly string[]` to `TelemetryBatch`. Core fills it with the compiled plugins and
   the loaded plugins that are bundled, aren't shadowed, and still match the bundled fingerprint.
2. Recompute it on every plugin load, reload, and uninstall.
3. The exporter drops records whose owner isn't `core` and isn't in `official`.

Two edge cases:

- **Mixed traces.** When a trace starts in core and passes through an unofficial plugin, keep the
  core spans and drop the plugin's. Re-parent nothing. Sentry shows the gap as untracked time.
- **Errors charged to core.** A bad plugin that crashes something in core arrives as `core`. Keep
  those. They're core's to harden against.

When official plugins move to their own repository ([split](./split.md)), "official" becomes
"installed from the acorn organisation's releases", which the installer already records in its lock
file. Package signing ([ecosystem](./ecosystem/README.md)) is the stronger check and replaces that
when it ships.

Acceptance: with a folder install shadowing `linear` and throwing on load, nothing owned by `linear`
reaches the team's project. The same plugin's errors reach a personal DSN.

## Phase 5: readable stacks

Every bundle is minified, so a stack in Sentry names minified functions. The plugin bundler
already writes hidden source maps on `--sourcemap`. Desktop renderer maps are unchecked.

1. Add `SENTRY_AUTH_TOKEN` as a repository secret, plus `SENTRY_ORG` and `SENTRY_PROJECT` as
   variables. The token can act across the whole organisation, so it stays in CI and never reaches an
   artifact.
2. In the tag build, build with hidden source maps, inject debug ids, upload with `sentry-cli`, then
   delete the maps before `dist` packages anything.
3. Do the same for the renderer's Vite build.
4. Add a check that fails the build if a `.map` file is inside a bundle.

Acceptance: an error thrown in a tag build shows original file names and line numbers in Sentry.

## Phase 6: docs

- `apps/site/src/content/docs/docs/security/telemetry-and-privacy.md`: the first paragraph, the new
  switch, the fixed policy, and the official-plugin filter.
- `docs/telemetry/plugins-and-sinks.md` and `docs/integrations/sentry.md`: the built-in fallback and
  the `official` field.
- A privacy policy on the site that names Sentry as the processor and the data region. Sentry sets the
  region when the organisation is created, so choose it first.

## Other release secrets

These don't belong to this plan, and the release needs them. [Bundle](./bundle.md) and [shell
packaging](../shell/packaging.md#signing-gates-and-the-updater) own the first and the last.

- Apple Developer ID signing and notarization. The publish job refuses to run without them.
- Windows code signing. Nothing is configured, so the installer triggers SmartScreen warnings.
- An updater endpoint. The signing key exists, but no updater plugin is compiled in.

The GitHub OAuth client id already has a built-in default. Linear and Rollbar take keys the person
pastes in. Neither needs a build secret.

## Open questions

- Should the CLI and the standalone Node archive carry the DSN too, or only the desktop app?
- Is 0.05 the right starting trace rate? It depends on install count, which nobody knows yet.
