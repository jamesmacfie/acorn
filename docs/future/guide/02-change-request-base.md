# Phase 2: the target branch on a change request

Date: October 30, 2026. Status: not started.

## Goal

Let a plugin learn a task's change request target branch and head commit without knowing which code
host it's on, so it can diff the change correctly.

## Starting point

Checked against `main` at `e3d8d1e69`. Recheck before you start.

- Core's neutral detail shape is `changeRequestDetail` in `packages/protocol/src/plugin/contract.ts`.
  It has `number`, `title`, `body`, and `changedFiles`, and no target branch.
- Each code host answers it from `GET {api}/{number}`: GitHub from
  `plugins/github/src/server/mirrorQueries.ts`, GitLab from
  `plugins/gitlab/src/server/routes/changeRequests.ts`, and Bitbucket from
  `plugins/bitbucket/src/server/routes/changeRequests.ts`.
- All three mirrors already store the target branch. GitHub reads `pullRequests.baseRef` in
  `mirrorQueries.ts`, GitLab maps `targetBranch` in `plugins/gitlab/src/server/mirror/detail.ts`, and
  Bitbucket maps `destination.branch.name` in `plugins/bitbucket/src/server/mirror/detail.ts`.
- Core reads the route with `readChangeRequest` in `packages/node-core/src/server/core/changeRequests.ts`,
  for the `pr` context section and the `pr_*` agent tools. A plugin can't call it.
- A loaded plugin sees `tasks.changeRequests(taskId)` in
  `packages/plugin-types/src/contracts/coreTasks.ts`. It returns the provider, path, number, and
  source branch, and no target branch.

Guessing the repository's default branch is wrong for any pull request that targets a release branch,
so the plugin needs the real one.

## In scope

- Add optional `baseRef` and `headSha` to `changeRequestDetail`. Optional, so an older code host's
  answer still parses.
- Fill both in the three code hosts' routes from what each mirror already stores.
- Add `tasks.changeRequestDetail(taskId)` to the task facet. It finds the primary change request and
  reads its detail through `readChangeRequest`, with the same five-second limit and the same rule that
  a missing or unparsable answer means "nothing to show". It returns `null` then. It needs the `tasks`
  grant and checks the task the way the other task facet methods do.
- Describe the method in `coreTasks.ts` for outside authors.

## Out of scope

- A base commit. The plugin computes the merge base itself, from the target branch.
- Detail for related change requests. Only the primary one has a checkout.

## Tests

- Each code host's route test checks `baseRef` and `headSha`, including a Bitbucket pull request from
  a fork.
- A facet test checks the answer for a task with a change request, `null` for a task with none, and
  `null` when the route times out or answers something that doesn't parse.
- The existing `pr` context section and `pr_current` tests still pass unchanged.

## Docs

Add the two fields and the facet method to [code hosts](../../plugins/code-hosts.md#agent-context).

## Done when

A loaded plugin with the `tasks` grant reads the target branch and head commit of a task's GitHub,
GitLab, and Bitbucket change request through one call.
