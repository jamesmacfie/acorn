# Phase 1: the DSN from the environment

Date: October 26, 2026. Status: done.

## Completion note

Landed on October 26, 2026.

What landed:

- The manifest grants `env: ['ACORN_SENTRY_DSN']`. The worker reads the variable once in `init`.
- `target()` tries the Settings connection first. With none, it uses the environment's DSN with
  environment `development` and release `acorn@<batch.version>`. A value that doesn't parse logs one
  warning naming the variable and sends nothing.
- The settings page's first section reads "Sending to `<host>/<project>` from `ACORN_SENTRY_DSN`."
  when the variable is in use.
- `turbo.json` passes the variable through to the `dev` task. Turborepo's strict env mode dropped
  it, so `pnpm dev` needed this. `dev:agent` and the desktop helper already pass it through.
- Docs: `docs/integrations/sentry.md` (a section named "The DSN from the environment"),
  `docs/local-development.md`, `docs/telemetry/plugins-and-sinks.md`, two site pages, and the
  permission's reason in `apps/site/src/data/plugins.ts`. The site's plugin-page test requires a
  reason for every permission.

Decisions and deviations:

- The settings frame can't see the environment, so the node half registers one fetch route,
  `GET /v1/p/sentry-telemetry/source`. It answers `{ environment: "<host>/<project>" }`, or `null`
  while a connection overrides the variable. It never returns the key.
- A connection whose stored DSN no longer parses still wins over the environment and sends nothing.
  The visitor returns `null` for it, so only "no usable connection" falls back to the variable.
- `target()` has no batch, so the plugin keeps the last `batch.version` it saw in `onBatch`. Every
  batch passes there before the exporter asks for a target, and the version is constant per process.
- I didn't rewrap or rewrite other site pages that cite the changed files. Install, the home page,
  and Settings: Machines say nothing this phase makes untrue.

For later phases:

- Phase 4 reads a different name, `ACORN_SENTRY_RELEASE_DSN`, at build time. The run-time
  `ACORN_SENTRY_DSN` is in the `dev` task's `passThroughEnv` only, not in any build task, so it
  can't leak into a bundle through Turborepo.
- A new run-time variable for the `sentry` plugin (phase 2) needs the same three things: an
  `env` grant, a `passThroughEnv` entry on `dev`, and a reason in `apps/site/src/data/plugins.ts`.
- Two failures were already on the base commit (f31f40b0a), and this phase leaves them alone. The
  arch tests flag links to the deleted `workflows-gaps.md`. The site's Playwright search
  test for "Show workspace rail" ranks `/docs/using/workspaces-and-projects/` first.

## Goal

A developer sets `ACORN_SENTRY_DSN` in the environment that starts their Node, turns on
**Collect timings, logs, and errors on this node**, and their telemetry reaches that Sentry project.
No Settings connection is needed.

## Starting point

`target()` in `plugins/sentry-telemetry/src/node/index.ts` returns a DSN only from a Settings
connection, through `ctx.providers.withConnection`. The plugin's manifest names no environment
variables, so its worker can't see any.

## Steps

1. Add `env: ['ACORN_SENTRY_DSN']` to `permissions.node` in
   `plugins/sentry-telemetry/acorn-plugin.config.mjs`, with a line in the permissions comment saying
   why.
2. In `target()`, keep the Settings connection first. When there's no connection, parse
   `process.env.ACORN_SENTRY_DSN` with `parseDsn`. A value that doesn't parse logs one warning that
   names the variable, never its value, and sends nothing.
3. With the environment DSN, set environment to `development` and release to
   `acorn@<batch.version>`. The settings page's fields stay for Settings connections.
4. Show the source on the settings page: "Sending to `<host>/<project>` from `ACORN_SENTRY_DSN`."
   Use `describeDsn`, which never shows the key.
5. Document the variable in `docs/integrations/sentry.md` and in the developer setup docs.

Recheck that `pnpm dev` and `dev:agent` pass the shell's environment through to the Node. If one of
them builds the Node's environment from scratch, add the variable there.

## Acceptance

- With `ACORN_SENTRY_DSN` set and collection on, a thrown test error reaches the project, tagged
  `development`.
- With collection off, nothing is sent.
- With a Settings connection as well, records go to the connection's project and none to the
  environment's.
- With the variable unset, the plugin behaves exactly as before.
- A test covers each of the four cases above against a stub `fetch`.
