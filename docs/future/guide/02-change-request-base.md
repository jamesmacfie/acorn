# Phase 2: the target branch on a change request

Date: October 30, 2026. Status: done.

## Completion note

Landed October 30, 2026.

What landed:

- `changeRequestDetail` in `packages/protocol/src/plugin/contract.ts` has `baseRef` and `headSha`,
  both `z.string().nullable().optional()`. It also exports the `ChangeRequestDetail` type.
- GitHub, GitLab, and Bitbucket answer both from their mirrors' `baseRef` and `headSha` columns.
  GitHub's `MirroredPullRequest`, which the `github.mirror` capability also returns, has the two
  fields as well.
- `tasks.changeRequestDetail(taskId)` in `packages/node-core/src/server/core/tasks.ts`. It calls
  `primaryChangeRequestHost`, then `readChangeRequest` with the `changeRequestDetail` shape, as the
  `pr` section does. It answers `null` for a task with no primary, a host with no `api`, no bound
  identity, a non-2xx, a timeout, or a body that doesn't parse. Its call mode is in
  `hostCallModes.ts`, so it crosses the worker for a loaded plugin with the `tasks` grant.
- The published type is `TaskChangeRequestDetail` in `packages/plugin-types/src/contracts/coreTasks.ts`.
  The published surface snapshot has the new members.
- Docs: [code hosts](../../plugins/code-hosts.md#agent-context).

Decisions and deviations:

- The two fields accept null as well as a missing key. The mirrors store null until they've fetched a
  pull request, and `.optional()` alone would refuse that body and empty the `pr` section. The
  checks route's `runId` follows the same rule.
- `createTaskService(db, env?)` and `createCoreServices({ env? })` take the node's bindings, because
  `readChangeRequest` needs them to reach a plugin route. Boot passes `runtime`. The option is
  optional so the 50 or so test callers that never read a detail need no `Env`. Called without one,
  the method throws "Change request detail requires host bindings", the same rule the plugin
  context's data source methods follow.
- The method makes no task check of its own. No task facet method does: an unknown task has no
  primary, so it answers `null`. The code host's route still checks the task with `mayActOnTask`,
  because core asks it as the task.
- The facet tests sit in `changeRequestTools.test.ts`, beside the `pr_*` tests, because that file
  already stands up a fake code host. The timeout test shortens `AbortSignal.timeout` to 10 ms
  rather than wait 5 seconds.
- `docs/plugins/code-hosts.md` sits at the 200-line limit, so its addition is two lines. The next
  change to that page has to split it.
- The site page `code-host.mdx` cites that doc. It doesn't describe the route's fields, so it needed
  no change, and it's marked checked.

For later phases:

- Read `baseRef` and `headSha` as possibly missing or null. A cold mirror has neither, and a code host
  that predates this phase sends neither. Treat that the same as a `null` answer.
- Bitbucket's `headSha` is the whole hash when the mirror's commit list has the head commit, and the
  12-character short hash Bitbucket names it by otherwise. Git resolves either in the task's checkout.
- The method reads only the primary change request.

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
