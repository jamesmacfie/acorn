# Sentry: issues in the rail, and telemetry from environment variables

Date: October 17, 2026. Revised October 26, 2026. Status: proposed. Implementation not started.

This folder plans two Sentry plugins. The exporter, `sentry-telemetry`, already ships. It sends a
Node's own telemetry to whatever DSN someone pastes into Settings. This programme lets the exporter
take its DSN from environment variables, adds a new `sentry` plugin that shows Sentry issues in the
rail the way Rollbar does, and then makes release builds report to the acorn team's own Sentry
project when someone opts in.

[Plugins and sinks](../../telemetry/plugins-and-sinks.md#the-sentry-sink) and [the Sentry
connection](../../integrations/sentry.md) own the exporter as it ships. [Rollbar](../../integrations/rollbar.md)
owns the shape the issues plugin copies.

## Phases

| Phase | What it delivers | Depends on |
| --- | --- | --- |
| [1. The DSN from the environment](./01-dsn-from-the-environment.md) | A developer sets `ACORN_SENTRY_DSN` and their Node exports to it, with no Settings step. | Nothing |
| [2. Sentry issues in the rail](./02-issues-in-the-rail.md) | A new `sentry` plugin lists a project's unresolved issues in the rail and draws one with its stack. Credentials come from Settings or from environment variables. | Nothing |
| [3. Sentry issues in tasks](./03-issues-in-tasks.md) | Make a task from an issue, a task pane of linked issues, and palette search. | Phase 2 |
| [4. Ship the DSN in release builds](./04-ship-the-dsn-in-release-builds.md) | Tag builds carry the team's DSN from a GitHub secret, behind a second consent switch, with fixed sampling, and the privacy docs say so. | Phase 1 |
| [5. Only official plugins](./05-official-plugins-only.md) | The team's project gets records only from core and unmodified official plugins. | Phase 4 |
| [6. Readable stacks](./06-readable-stacks.md) | Release bundles upload source maps, so stacks in Sentry show real files and lines. | Phase 4 |

Phases 1 and 2 can run in parallel. Phases 5 and 6 can wait until noise or minified stacks start to
hurt, which is unlikely while installs are few.

## Decisions

- **Two plugins, not one.** Decided October 26, 2026. `sentry-telemetry` keeps the DSN, which can only
  send to one project. The new `sentry` plugin holds an auth token, which can read the organization.
  One plugin holding both would ask for the wider credential to do the narrower job, and the id
  `sentry` is already reserved for the issues plugin.
- **Environment variables come first for developers.** A developer puts the values in the environment
  that starts their Node, and both plugins work with no Settings step. A connection made in Settings
  still wins over the environment, so a person can point at their own project without unsetting
  anything.
- **The release build bakes in only the DSN.** A DSN is safe to ship in a public download, because it
  can only send. The issues token can read every issue in the organization, so it never goes into a
  build. A person using a release build connects the issues plugin in Settings, or starts their Node
  with the variables set.

## Environment variables

| Name | Read by | Where it's set | Secret |
| --- | --- | --- | --- |
| `ACORN_SENTRY_DSN` | `sentry-telemetry`, at run time | A developer's environment | No. A DSN can only send. |
| `ACORN_SENTRY_RELEASE_DSN` | `build-plugin.mjs`, at build time | The tag build only, from the repository secret `ACORN_SENTRY_DSN` | No, but kept as a secret so it stays out of logs and forks. |
| `ACORN_SENTRY_TOKEN` | `sentry`, at run time | A developer's environment | Yes. Reads the organization's issues. |
| `ACORN_SENTRY_ORG` | `sentry`, at run time | A developer's environment | No |
| `ACORN_SENTRY_PROJECT` | `sentry`, at run time | A developer's environment | No |
| `ACORN_SENTRY_URL` | `sentry`, at run time | A developer's environment. Defaults to `https://sentry.io`. | No |
| `SENTRY_AUTH_TOKEN` | `sentry-cli`, in the tag build | Repository secret | Yes. Can write releases across the organization. |
| `SENTRY_ORG`, `SENTRY_PROJECT` | `sentry-cli`, in the tag build | Repository variables | No |
| `ACORN_RELEASE_SOURCEMAPS` | The desktop build, which writes hidden source maps for the upload | The tag build, set to `1` when the token and both variables exist | No |

The build reads a different name from the run-time one on purpose. A developer with
`ACORN_SENTRY_DSN` in their shell who runs a desktop build doesn't bake it into the bundle.

A loaded plugin sees no environment variable unless its manifest names it in `permissions.node.env`
([the plugin realm](../../security/plugin-node-realm.md)). Each plugin names only its own.

## Rules for every phase

- With no variables set and no connection made, both plugins send and fetch nothing, exactly as
  today.
- Nothing reaches the team's project unless the person turned on both **Collect timings, logs, and
  errors on this node** and **Share with the acorn team**.
- The issues token never appears in a build, a log line, a telemetry record, or an error message.
- Run `pnpm lint` and the plugin's tests for each slice, and `pnpm test` for the whole suite.
- When a step ships a contract, update the owning document under `docs/` in the same change.

## Starting point

Recheck these against the checkout before you start.

| Piece | Where |
| --- | --- |
| The exporter's activation, and `target()`, which resolves the DSN from the connection once per flush | `plugins/sentry-telemetry/src/node/index.ts` |
| `DEFAULT_SETTINGS`: every kind on, sample rate 1 | `plugins/sentry-telemetry/src/shared/settings.ts` |
| Redaction, then envelope building, run per batch | `plugins/sentry-telemetry/src/server/exporter.ts` (`convert`) |
| The exporter's manifest: `net` covers `*.ingest.sentry.io`, and no `env` grant | `plugins/sentry-telemetry/acorn-plugin.config.mjs` |
| A plugin that reads named environment variables | `plugins/model-providers/acorn-plugin.config.mjs` (`env`) |
| How a worker gets those variables | `packages/node-core/src/server/plugins/isolation.ts` |
| The issue plugin to copy | `plugins/rollbar/` |
| The plugin bundler, which minifies with oxc and writes hidden source maps only on `--sourcemap` | `apps/node/scripts/build-plugin.mjs` |
| The bundled roster | `scripts/bundled-plugins.mjs` (`BUNDLED_PLUGINS`) |
| The consent switch, **Collect timings, logs, and errors on this node** | `packages/client-core/src/features/settings/corePages.ts` |
| The tag build | `.github/workflows/build-desktop.yml` |

## Other release secrets

These don't belong to this programme, and the release needs them. [Bundle](../bundle.md) and [shell
packaging](../../shell/packaging.md#signing-gates-and-the-updater) own the first and the last.

- Apple Developer ID signing and notarization. The publish job refuses to run without them.
- Windows code signing. Nothing is configured, so the installer triggers SmartScreen warnings.
- An updater endpoint. The signing key exists, but no updater plugin is compiled in.

The GitHub OAuth client id already has a built-in default. Linear and Rollbar take keys the person
pastes in. Neither needs a build secret.

## Open questions

- Should the CLI and the standalone Node archive carry the release DSN too, or only the desktop app?
- Is 0.05 the right starting trace rate? It depends on install count, which nobody knows yet.
- Should the issues plugin read more than one project from the environment? Phase 2 takes one.
