# Phase 1: the DSN from the environment

Date: October 26, 2026. Status: not started.

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
