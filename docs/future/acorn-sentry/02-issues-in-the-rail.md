# Phase 2: Sentry issues in the rail

Date: October 26, 2026. Status: done.

## Completion note

Landed on October 26, 2026.

What landed:

- A new loaded plugin, `plugins/sentry/`, in `BUNDLED_PLUGINS`. Its **Sentry issues** rail source
  lists a project's unresolved issues, newest first, with the level, the title, and the event count.
  Picking one draws `sentry-issue` at `/p/:projectId/x/sentry/issues/:issue`: the title, the
  culprit, first and last seen, the event and user counts, and the latest event's message and stack.
- A Settings connection, `kind: 'error-tracker'`, `authKind: 'api-key'`, with the token, the
  organization slug, the project slug, and the Sentry address. `validate` reads the project once and
  records its numeric ID. A project source returns that ID, so the workspace map can follow it.
- The four `ACORN_SENTRY_*` variables, granted in `permissions.node.env`, passed through on Turborepo's
  `dev` task, and given reasons in `apps/site/src/data/plugins.ts`. A site page,
  `built-in-plugins/sentry.mdx`, and new sections in `docs/integrations/sentry.md`.
- The allowlist, `plugins/sentry/src/server/normalize.ts`, with Rollbar's kinds of caps: 10
  exceptions, 200 frames, 7 source lines a frame, 8 KiB a string, 192 KiB a detail.

Decisions and deviations:

- The workspace map can't hold `env`. `externalProjects` inner-joins each map row to `integrations`,
  and the mapping picker lists only connection rows. So rows read through the environment carry the
  fixed connection ID `env` and show in every project's rail, like the exporter's
  `ACORN_SENTRY_DSN`. A request with no `?project=`, or a project that doesn't exist, still gets no
  rows.
- Any Sentry connection row in Settings, whatever its status, turns the environment off. A detail
  request that names `env` while one exists answers 403.
- The plugin registers a `ConnectionProviderContribution`, not an integration, and reads Sentry live
  on every request. There's no mirror, no item cache, and no `rollbar.items`-style resource, because
  the environment's credential has no connection row for the host's resource cache to key on, and
  two read paths would be worse than none. Phase 3 needs an integration contribution for task links.
- The rail source declares no `providerId`. With one, `railSources.ts` hides the source until a
  Settings connection is linked, which would hide the environment's rows and the "how to connect"
  empty state. So the source shows for everyone who has the plugin. It fetches nothing without a
  credential.
- The rail reads Sentry's organization issues endpoint with `project=<slug>`. Sentry's documentation
  says it takes a slug or an ID. The per-project endpoint is deprecated. No real token was available
  to check a response, so the route shapes come from Sentry's documentation, read on October 26,
  2026.
- The connection refuses any host but `sentry.io`, `us.sentry.io`, and `de.sentry.io`, the hosts in
  `permissions.node.net`. A self-hosted Sentry doesn't work.
- No rail search, palette command, task pane, or `+Task` on a row. Those are phase 3.

Checked in `pnpm dev:agent`: with a made-up `ACORN_SENTRY_TOKEN`, real sentry.io answered 401 and the
rail drew "Sentry turned down the token for Sentry · acme/web (from ACORN_SENTRY_TOKEN). It needs
event:read." The token was in no log or data file. With no variables and no connection, the rail
drew the empty state that says how to connect. No real token was available, so the list and the
stack were checked only by tests against stub responses.

For later phases:

- Phase 3 has to switch `sentryProvider` to `ctx.providers.integration` (external IDs, a codec,
  refs) for task links, and decide what a link to an `env` row means, since `env` has no connection
  row for a task link to name.
- Running `pnpm --filter @acorn/node build:plugin <id>` without `--package-root` from a task
  worktree writes into the main checkout's live dev data root. Pass `-- --package-root /tmp/<dir>`.
- Two failures were already on the base commit, as phase 1 noted, and this phase leaves them alone:
  the arch tests' links to the deleted workflows gaps doc, and the site's Playwright search test for
  "Show workspace rail". In the full run, the plugin examples' acme-review test also failed in
  `pnpm pack`, and it passed when its package ran alone.

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
