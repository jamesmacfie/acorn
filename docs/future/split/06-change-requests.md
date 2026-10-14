# Phase 6: make pull requests provider-owned change requests

Date: October 14, 2026. Status: proposed. Depends on [phase 5](./05-repository-identity.md).

## Goal

A task can be backed by a GitHub pull request, a GitLab merge request, or a Bitbucket pull request,
and core treats all three the same way. Core stores the link, checks the change out, and opens the
right pane. The code host plugin supplies everything provider-specific.

## Starting point

Core's task model is built around GitHub pull requests:

- `tasks.pull_number` in `packages/node-core/src/server/db/schema.ts` is the task's primary pull
  request. `task_pulls` holds the repository owner, name, and number for every pull request an agent
  attached.
- `adoptPullNumbers` and `attachPull` in `packages/node-core/src/server/core/tasks.ts` match branches
  to pull requests by GitHub owner and name. The GitHub plugin calls both through the published
  `CoreTaskService`.
- `ensureWorktree` in `packages/node-core/src/server/worktrees/worktrees.ts` fetches
  `pull/<number>/head`, which is GitHub's ref layout. GitLab uses `merge-requests/<number>/head`, and
  Bitbucket has no such ref.
- `projectWorktreeIdentity` in `packages/node-core/src/server/worktrees/taskWorktree.ts` names
  worktree folders after the GitHub owner and name.
- `packages/node-core/src/server/routes/projects/tasks.ts` seeds a task title as `#<number>`, and
  accepts `pullNumber` on create and patch.
- On the client, `packages/client-core/src/features/tasks/taskLayout.ts` makes `pr`, the GitHub
  plugin's pane ID, every task's default pane. `packages/client-core/src/infra/persistence/prefKeys.ts`
  holds the GitHub plugin's `github:pr-filters` key.
  `packages/client-core/src/features/integrations/PromoteToTaskModal.tsx` passes a GitHub owner and
  name.
- `packages/client-core/src/features/tabs/TabRail.tsx` gates a checks marker on `pullNumber`, but its
  `checks` function always returns an empty list. That code does nothing.

The issue side already has the right shape. `task_links` stores a provider, an identifier, and a
reference for Linear and Rollbar, and `packages/node-core/src/server/agentTools/issueTools.ts` asks
each provider for the provider-specific call. Copy that shape.

## The design

A change request link is a provider, a repository facet from phase 5, a number, a role of primary or
related, and its provenance. The phase 5 code host contribution gains three optional declarations:

- How to fetch a change request's head. A ref pattern such as `pull/{number}/head` covers GitHub and
  GitLab. A host with no such ref falls back to fetching the source branch by name, which the plugin
  supplies when it attaches the link.
- What to call it: "pull request" or "merge request", and the prefix for a title, `#` or `!`.
- Which pane shows it. That pane becomes the default for a task with a primary change request. A task
  without one opens on core's own default.

## Changes

1. Add a `task_change_requests` table with that shape, and migrate `tasks.pull_number` and every
   `task_pulls` row into it with provider `github`. Keep the old column and table readable until the
   next plugin API major.
2. Add `adoptChangeRequests` and `attachChangeRequest` to `CoreTaskService`, keyed by provider and
   repository. Reimplement `adoptPullNumbers` and `attachPull` on top of them, so the GitHub plugin and
   any loaded plugin keep working.
3. Add a generic change request field to the wire task, and derive `pullNumber` from it for GitHub.
4. Have `ensureWorktree` ask the claiming code host for the ref pattern, and fall back to the branch.
   Keep the existing folder layout for projects that already have worktrees there. Moving a live
   worktree is a one-way step this phase doesn't need.
5. Replace the `pr` default with the claiming code host's declared pane. Move `github:pr-filters`
   into the GitHub plugin. Pass the repository facet to the promote modal.
6. Delete the dead checks gate in `TabRail.tsx`.
7. Have the GitHub plugin declare its ref pattern, labels, and pane, and switch its calls to the
   generic service methods.

## Out of scope

A GitLab or Bitbucket plugin itself. CI check status in the rail, which stays provider-owned as the
`TabRail.tsx` comment says.

## Acceptance

- Every GitHub flow works as before: open a pull request as a task, adopt a pull request that an
  agent pushed, check out a fork's pull request, and land on the pull request pane.
- The phase 5 test plugin for `gitlab.test` declares `merge-requests/{number}/head`, a label, and a
  pane. A task attached to its change request `!12` checks out that ref, titles itself `!12`, and opens
  the test plugin's pane, with no core file changes.
- A code host with no ref pattern checks out the source branch.
- No core package names `pull_number`, `pullNumber`, or `pr` outside the derived compatibility
  fields, and those are listed in this file for the next major.

## Risks

The migration touches every task row. Run it against a copy of a real data root before it ships, and
compare the task list and each task's pane before and after.
