# Phase 4: share the review views as a second code host needs them

## Completion note

October 16, 2026. Done, with [phase 5](./05-gitlab-plugin.md) drawing from it.

What landed:

- `packages/change-request-ui/` (`@acorn/change-request-ui`), with two entrypoints. `./model` holds the
  neutral types, the check status vocabulary and roll-up, `reviewDecision`, `inlineReviewThreads`,
  `filterChangeRequests`, `branchReferenceCandidates`, and `changeRequestPoints`. `./views` holds
  `createChangeRequestModel`, `ChangeRequestView`, the overview, sections, conversation, file list,
  `ChangeRequestDiff`, `ChecksPanel`, `ChangeRequestList`, and `useChangedFiles`.
  [Shared review views](../../plugins/change-request-ui.md) documents it.
- The GitHub plugin draws its PR pane, browse detail, pull list, diff, and checks panel from the
  package. `plugins/github/src/client/changeRequest.ts` maps its mirror rows, and `prModel` builds the
  shared model from its queries and writes. Its copies of the views, the check status table, the
  conversation model, the list filter, and the point declarations are deleted.
- GitHub registers its `diff-line` and `summary-badges` points through `changeRequestPoints`.
- GitHub's view tests run against the shared views: the conversation, overview, Linked issues, diff,
  PR pane, and browse detail tests. The pure tests moved into the package with their assertions.

Decisions and deviations:

- The views take a model and callbacks and never call a code host. The one read they make is Linear
  enrichment through the host's ref resolution, as GitHub's pane did. `tools/arch/boundaries.test.ts`
  lists the package as a library plugins may import, and excuses its `linear` and `editor` literals.
- A library can't import a plugin, so `ChangeRequestDiff` restates the agents plugin's inline diff
  origin as a structural type. The host passes `clientCapability(AGENTS_INLINE_DIFF)`, and that
  assignment is the type check that keeps the two shapes together.
- The views were extracted in one change, shaped against the GitLab plugin of phase 5, rather than one
  change per view. The create form wasn't extracted. GitLab's push action opens gitlab.com's own form
  instead, so no second host needs it.
- Optional verbs replace GitHub branches in the views: `merge`, `autoMerge`, `setDraft`, `setViewed`,
  `rerun`, and the review events a host lists. A missing verb hides its control.
- A thread's side is `old` or `new` in the model. `ChangeRequestDiff` maps it to the viewer's `LEFT`
  and `RIGHT`.
- Two small behavior changes on GitHub: a merged pull no longer shows the merge box, and the `Rows`
  ids for files, checks, conflicts, and linked issues start with `cr-` instead of `gh-`.

For later phases:

- A new code host maps its records onto `@acorn/change-request-ui/model`, builds the model with
  `createChangeRequestModel`, and draws `ChangeRequestView`, `ChangeRequestDiff`, `ChecksPanel`, and
  `ChangeRequestList`. It registers its points with `changeRequestPoints(noun)`.
- The related-pull strip and its task model stay in the GitHub plugin.
- Already red at the base and untouched: the `pluginDisable` and `routeRegistry` goldens in
  `apps/node`, knip's `proposalChanges`, and three `docPaths` entries for `dist` files.

Date: October 16, 2026. Status: proposed. Runs alongside [phase 5](./05-gitlab-plugin.md).

## Goal

GitLab and Bitbucket draw change request lists, detail, diffs with review threads, and checks without
a copy of the GitHub plugin's client. Extract each view when the second host needs it, not before, so
the shared shape comes from two real hosts instead of a guess.

## Starting point

The GitHub plugin's client is about 6,100 lines outside tests, in `plugins/github/src/client/`:

| Piece | Lines | Where |
| --- | --- | --- |
| Pull request pane: overview, conversation, files, tabs, rail marker | about 2,500 | `pullDetail/` |
| Pull request list with filters | about 610 | `PullList.tsx`, `pullList/` |
| Diff with review threads | about 230 | `DiffForPull.tsx`, `reviewThreadLocation.ts` |
| Checks panel and job log | about 260 | `checks/` |
| Create form and compare preview | about 350 | `CreatePullForm.tsx`, `ComparePreview.tsx`, `createPull/` |
| Browse source, importer, ref panel, push actions, commands | the rest | the top-level files |

Two things are shared already. `packages/diff-document` holds the diff model every diff view draws,
and the client kit in `packages/client-core/src/kit/` holds the controls. What isn't shared is the
change request model the views read: GitHub's mirror rows, its review states, and its check rollup.

The pull request pane opens two cooperative points, `github:diff-line` and `github:summary-badges`,
listed in `packages/protocol/src/chrome/publicExtensionPoints.ts`. A plugin that marks diff lines
files against GitHub's id.

## The design

A shared client package, `packages/change-request-ui/` (new package), holds views that take a
provider-neutral model and callbacks. Each code host plugin keeps its queries, mutations, routes,
and the mapping from its API's records to the neutral model. The views never fetch.

The neutral model is a change request with a number, title, body, state, author, branches, labels,
reviewers with a decision, threads with a file, side, and line, comments, and checks with a status.
Fields one host lacks are optional, and the view hides what's absent. GitLab approvals and Bitbucket
approvals both map to an approved decision. GitHub's "changes requested" maps to its own decision,
and GitLab has no equivalent.

Each code host opens its own `diff-line` and `summary-badges` points, with the key shape the shared
package exports. A contributor that wants every host files against each host's point. Making a
single point that spans plugins would be a change to how points are owned, which this programme
doesn't need.

## How to extract a view

Follow these steps for each view phase 5 needs:

1. Write the GitLab version against the neutral model in the shared package, using the GitHub view as
   the reference.
2. Point the GitHub plugin at the shared view, with a mapper from its mirror rows.
3. Delete the GitHub copy in the same change, and keep the GitHub view tests passing against the
   shared one.

Take them in this order, because each one is used by the next: checks panel, diff with review threads,
pane tabs and overview, conversation, list and filters, create form.

## Changes

1. Create the package with the neutral model types and the first view, the checks panel.
2. Extract the remaining views in the order above, each in its own change.
3. Move the `diff-line` and `summary-badges` point declarations and their key shape into the package,
   with GitHub opening its points from them.

## Out of scope

- The browse source, project importer, ref panel, commands, and keybindings. Each is short and
  host-specific, so each plugin keeps its own.
- The terminal client's drawing of these views. It draws the same panes through
  `apps/tui/src/roster.ts`, and follows the shared package once the desktop views move.
- A loaded plugin's use of the package. Loaded plugins draw remote trees, not Solid components.

## Acceptance

- The GitHub plugin's client tests pass, with each extracted view deleted from the plugin.
- The GitLab plugin draws its pane, list, diff, and checks from the package, with no copy of a GitHub
  view.
- `knip` reports no unused export in the package.

## Risks

A neutral model shaped by GitHub alone tilts toward GitHub. Extracting while GitLab is written is the
check on that. If a view needs a host-specific branch in the shared code, pass a slot from the host
instead.
