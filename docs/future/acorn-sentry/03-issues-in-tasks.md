# Phase 3: Sentry issues in tasks

Date: October 26, 2026. Status: done. Depends on [phase 2](./02-issues-in-the-rail.md).

## Completion note

Landed on October 26, 2026.

What landed:

- `sentryProvider` is an integration (`ctx.providers.integration`) with `externalIdsFor('sentry')`,
  no resources, no codec, and no cache. Core stamps a task link only for a registered integration,
  so this was the smallest change that made links work. The plugin's routes ride on the provider's
  route, which answers every path under `/v1/p/sentry`, so the separate `ctx.routes.fetch` mount is
  gone. The registry refuses `browse` or `promoteToTask` without a mirrored resource, so both
  capabilities are off. The host's rail promotion doesn't read them.
- A rail row from a Settings connection carries a `task` block (`sentryRailItem`), so its menu offers
  **Create task…** and the host's promotion dialog makes or attaches the task, as Rollbar's does. The
  link's identifier is the numeric issue ID, and its ref carries the issue's `permalink`.
- A task pane, `sentry`, with `providerId: 'sentry'`. It reads the task's links through
  `/v1/core/tasks`, a new `core.tasks:read` grant with its reason in `apps/site/src/data/plugins.ts`.
  Several links draw a list with each issue's title and its live event count.
- **Find a Sentry issue**, a project-scoped palette search over the rail's issues
  (`plugins/sentry/src/server/paletteSearch.ts`, `GET /v1/p/sentry/palette/issues`).
- **Open in Sentry** on the issue detail, which hands the `permalink` to `bridge.ui.openUrl`. The
  normalizer keeps the address only when it's `https`.
- Docs: `docs/integrations/sentry.md` (sections on issues in tasks and palette search), the site's
  Sentry page, and the site's tasks and worktrees page.

Decisions and deviations:

- An issue read through the environment (connection ID `env`) offers no task. Core stores a link
  against a row in `integrations` and answers 403 for any other, and the host's promotion refuses a
  connection the plugin doesn't own. The variables can also name another organization after a
  restart, so a stored link wouldn't keep meaning the same issue. Linking needs a Settings connection.
- Step 1 asked for **Make a task** on the issue detail. The detail has none. A tree can't open the
  host's promotion dialog, and making the task from the tree would need `core.tasks:write` and would
  skip the dialog's branch step. A branchless task on a Git project lands on the main checkout, where a
  second one fails. Promotion lives on the rail row's menu, where Rollbar's does.
- One host line changed. `trackingTask` in `ChromeSourcePanel.tsx` falls back to the plugin ID when a
  source declares no `providerId`. Without it, a Sentry row that a task already links still offered
  **Create task…** instead of **Open task**. Promotion only accepts a connection the plugin owns, so a
  promoted link's provider is always the plugin ID.
- Palette search reads Sentry on each query, one call per connection, because there's no mirror to
  filter. The palette debounces typing.
- The icon for **Open in Sentry** is `arrow-up-right`. The bundled Lucide set has no `external-link`.
- Step 5, the events-per-issue data source, was skipped.

Checked by tests only: promotion seeds and the `env` exclusion, palette ranking and its route, and the
task pane's list. No real token was available, so nothing ran against Sentry, and the dialog and the
task pane weren't walked in `pnpm dev:agent`.

For later phases:

- There's still no `detail` hook, so core's `issue_detail` agent tool says Sentry offers summaries
  only, and a linked issue appears in an agent's context with its ID alone. Adding either needs a read
  path in the provider, through a resource or a hook that reads Sentry live.
- The two failures already on the base commit remain: the arch tests' links to the deleted workflows
  gaps doc, and the site's Playwright search test for "Show workspace rail".

## Goal

Sentry issues join tasks the way Rollbar items do: make a task from an issue, see a task's linked
issues in a pane, and find an issue from the palette.

## Steps

1. Add **Make a task** to the issue detail. It creates a task linked to the issue, as Rollbar's
   promotion does.
2. Add a task pane that lists the task's linked issues with their current counts.
3. Add palette search over the project's issues, as `plugins/rollbar/src/server/paletteSearch.ts` does.
4. Add an **Open in Sentry** handoff to the issue's page in the browser.
5. Optional: an events-per-issue data source, like Rollbar's occurrence counts source.
6. Update `docs/integrations/sentry.md`.

## Acceptance

- Making a task from an issue links them, and the task's pane shows the issue.
- Palette search finds an issue by title.
- Tests cover promotion and search.
