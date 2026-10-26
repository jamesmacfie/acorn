# Phase 2: Sentry issues in the rail

Date: October 26, 2026. Status: not started.

## Goal

A new loaded plugin, `sentry`, lists a Sentry project's unresolved issues in the rail. Picking one
draws its title, counts, and latest event with its stack beside the list. Credentials come from a
Settings connection or from environment variables.

## Starting point

`plugins/rollbar/` is the shape to copy. It's about 3,700 lines including tests. Read
[Rollbar](../../integrations/rollbar.md) first, especially its scoping and its occurrence limits. The
id `sentry` is reserved for this plugin in [the Sentry connection](../../integrations/sentry.md).

Sentry's API takes a bearer token and lives at `https://sentry.io/api/0/` for the US region and
`https://de.sentry.io/api/0/` for the EU region. Recheck the issue list, issue detail, and latest
event routes against Sentry's API docs before you start.

## Steps

1. Copy the package layout of `plugins/rollbar/` into `plugins/sentry/`, and add `sentry` to
   `BUNDLED_PLUGINS` in `scripts/bundled-plugins.mjs`.
2. Register a connection with `kind: 'error-tracker'` and `authKind: 'api-key'`. Its fields are the
   auth token as a password, the organization slug, the project slug, and the API host. `validate`
   fetches the project once to prove all four.
3. Read the same four values from `ACORN_SENTRY_TOKEN`, `ACORN_SENTRY_ORG`, `ACORN_SENTRY_PROJECT`, and
   `ACORN_SENTRY_URL`, declared in `permissions.node.env`. A Settings connection wins. All three of
   token, organization, and project must be set, or the environment counts as unset.
4. Decide how the environment's credentials join Rollbar-style scoping. Rollbar's rail scopes on the
   connection ids in a workspace's map, and environment values have no connection row. We recommend a
   fixed connection id, `env`, that the project source returns and the workspace map can select. If
   the map can't hold an id with no row, write that down here before choosing another way.
5. Fetch unresolved issues for the project, newest first, and pass every payload through a privacy
   allowlist like Rollbar's `normalize.ts`, with the same kinds of caps on frames and strings.
6. Add the rail source. A row shows level, title, and event count, like Rollbar's.
7. Add the detail view at `/p/:projectId/x/sentry/issues/:issue`: title, culprit, first and last seen,
   counts, and the latest event's message and stack.
8. List Sentry's API hosts in `permissions.node.net`.
9. Write `docs/integrations/sentry.md` sections for the new plugin, and remove the "nothing is built"
   line.

## Acceptance

- With the four variables set, the rail shows the project's unresolved issues, and picking one draws
  its stack.
- With a Settings connection, that connection's project shows instead.
- With neither, the plugin fetches nothing and the rail shows how to connect.
- A bad token shows a plain error in the rail, and the token appears in no log line.
- Tests cover normalization with its caps, the environment fallback, and scoping.
