# Phase 4: the guide inside the pull request view

Date: October 30, 2026. Status: done.

## Completion note

Landed October 30, 2026.

What landed:

- A third point, `review-panel`, in `changeRequestPoints`: `remote`, `mode: 'stack'`, `max: 1`, with
  `ReviewPanelProps` (`{ owner, repo, number, taskId }`) and `changeRequestPointIds(...).reviewPanel`.
  GitHub, GitLab, and Bitbucket open it through the same loop, so no host file changed.
- `ChangeRequestView` draws the point as a tab after the host's sections, named by the contributor's
  label. It draws no tab when nobody fills the point, on the browse surface, which has no task, or on
  a related change request, because the guide is about the task's own change request.
- `slotLabel(pointId, key?)` beside `slotFills` in `packages/client-core/src/host/tree/arbitration.ts`,
  exported from `@acorn/plugin-api/client`. The surface snapshot has it.
- `review-guide` files `github-review-panel`, `gitlab-review-panel`, and `bitbucket-review-panel`,
  labelled **Guide**, all on its existing `pane` tree entry. `GuidePane` reads only `taskId`, so it
  needed no change. The pane stays.
- The three points in `PUBLIC_EXTENSION_POINTS`, with a note for `plugin_authoring`, and an example of
  each on the site's extension-points reference.
- Tests: the view (no contributor, one contributor, no task), the point declaration, and a terminal
  test (`apps/tui/src/extensions.test.tsx`) that reaches the tab with `l` on the real shell, behind a
  new `ACORN_FIXTURE_REVIEW_PANEL` fixture flag.
- Docs: [shared review views](../../plugins/change-request-ui.md#extension-points),
  [places to fill](../../contribution-kinds.md#places-to-fill), the remote points table, each host's
  page, and [the review guide plugin](../../first-party-plugins/review-guide.md). The site's
  review-guide and extension-points pages are updated and marked checked.
- The Node service graph is unchanged at 1,942,974 bytes.

Decisions and deviations:

- A tab, not a **Diff** and **Guide** switch over the diff. The switch was built first and dropped: the
  terminal client can't reach a `Sections` node's diff column, or any action at the end of a tab strip,
  by keyboard, so a switch there only worked with a mouse. A tab is reached with h and l at every width.
  In a window the tab's column sits beside the diff and can be dragged wider, which is the split the
  "Decide before you build" section allowed for. In a narrow terminal the tab sits just before **Diff**.
- The choice is remembered the way every `Sections` tab is: per view ID, such as `github.pull`, in the
  desktop's local storage, and not in the terminal. Not per task. That needed no new state.
- The name is neutral, `review-panel`, and the tab takes the contributor's label rather than saying
  "Guide", so another review tool can fill it. That's why `slotLabel` exists.
- Hidden tab panels stay mounted, so a task's change request view mounts the guide's tree, and starts
  the review guide's worker, even while another tab is open. That costs one guide read per view.

Not checked live:

- The `pnpm dev:agent` session has no signed-in code host, so no task had a pull request pane, and the
  tab wasn't seen over a real pull request. A guide over a real pull request is still unchecked from
  phase 3 too. The terminal test covers the real shell with the fixture pull request instead of a
  `pnpm dev:tui:agent` run.
- Site pages that cite the changed docs but needed no change: the GitHub, GitLab, and Bitbucket plugin
  pages, the review feature page, the plugins feature page, the contribution reference pages, and the
  plugin UI guides. The pages describe panes and kinds, not the list of points.

For later phases:

- The tab's ID is `review-panel`, and the tree is mounted with `{ owner, repo, number, taskId }`. A
  guide item's `path` and `@@` header can drive a jump into the diff column beside it in phase 5.
- A compiled contributor for a terminal test is `installReviewPanel` in `apps/tui/src/fixtureExtensions.tsx`.

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
