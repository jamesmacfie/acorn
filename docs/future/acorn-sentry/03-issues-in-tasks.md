# Phase 3: Sentry issues in tasks

Date: October 26, 2026. Status: not started. Depends on [phase 2](./02-issues-in-the-rail.md).

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
