# Phase 4: the guide inside the pull request view

Date: October 30, 2026. Status: not started. Needs phase 3.

## Goal

Show the guide beside the diff in the GitHub, GitLab, and Bitbucket change request views, instead of in
a separate pane, by adding one shared extension point.

## Starting point

Checked against `main` at `e3d8d1e69`. Recheck before you start.

- The three code hosts draw their change request views from `@acorn/change-request-ui`
  ([shared review views](../../plugins/change-request-ui.md)). `ChangeRequestView` in
  `packages/change-request-ui/src/views/ChangeRequestView.tsx` draws the overview as the header, the
  sections, and the host's diff as the main region.
- Other plugins get two places in those views, from `changeRequestPoints` in
  `packages/change-request-ui/src/model/points.ts`: `diff-line` marks and `summary-badges` on the
  overview. There's no place for a tab or a panel.
- Each host registers both points from that one function, so a point added there reaches all three
  hosts at once.

## In scope

- Add a third point to `changeRequestPoints`. For example, `review-panel`, a `remote` point with
  `mode: 'stack'` and `max: 1`. Its contributor gets `{ owner, repo, number, taskId }`. In a task, the
  `taskId` is what the guide plugin needs. The browse surface has no task, so draw nothing there.
- Draw it in `ChangeRequestView` as a choice beside the diff. Start with a **Diff** and **Guide** toggle
  over the main region, and switch to a split only if the toggle proves awkward. When nothing fills
  the point, draw no toggle.
- Add the point to `changeRequestPointIds`.
- Have `review-guide` fill the point on each host with the same tree as its pane, filed once per host,
  as [cooperative extension points](../../plugins/cooperative-extension-points.md) describe. Keep the
  pane for tasks that have no pull request view open.
- Check the terminal client, which draws these views through `apps/tui/src/roster.ts`.

## Decide before you build

- Whether the toggle remembers its choice per task. The diff viewer already remembers view state
  per scope ([diff review threads and marks](../../diff-rendering/review.md#remembered-view-state)).
- Whether the point's name should say "guide". A neutral name lets other review tools use it, so
  prefer that.

## Tests

- A view test: no contributor draws no toggle, and one contributor draws the toggle and its tree.
- The point declaration test in `packages/change-request-ui/src/model/points.test.ts`.
- `pnpm --filter @acorn/arch-tests test`, because a point and a manifest change.
- A live check in `pnpm dev:agent` on GitHub, and in `pnpm dev:tui:agent`.

## Docs

Add the point to [shared review views](../../plugins/change-request-ui.md#extension-points) and to
[places to fill](../../contribution-kinds.md#places-to-fill).

## Done when

In a task's GitHub, GitLab, or Bitbucket change request view, **Guide** sits beside **Diff** and shows
the same guide as the pane.
