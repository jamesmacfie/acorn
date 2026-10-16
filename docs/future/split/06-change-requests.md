# Phase 6: make pull requests provider-owned change requests

## Completion note

Landed October 15, 2026.

What changed:

- `task_change_requests` holds every change request linked to a task: provider, repository host and
  path, number, role, provenance, source branch, and the agent session. Migration
  `0010_task_change_requests` copies every `task_pulls` row in as an agent row, and every
  `tasks.pull_number` in as the primary, using the project's repository facet.
- `packages/node-core/src/server/core/changeRequests.ts` holds the reads and `setPrimaryChangeRequest`,
  the one write that moves a task's primary. It also writes `tasks.pull_number` when the primary is on
  github.com, so the GitHub-named readers stay correct.
- `CoreTaskService` has `changeRequests`, `attachChangeRequest`, and `adoptChangeRequests`.
  `pulls`, `attachPull`, and `adoptPullNumbers` run on top of them. The surface snapshot only gained
  lines.
- `codeHost.changeRequest` declares `ref`, `label`, `prefix`, and `pane`. `changeRequestDeclaration`
  in `pluginHost/codeHosts.ts` is the by-provider lookup. GitHub declares `pull/{number}/head`,
  `pull request`, `#`, and `pr`.
- The wire task has `changeRequest: { provider, number, pane? }`, and `pullNumber` is the copied
  column. `POST` and `PATCH /v1/core/tasks` take `changeRequest: { number, sourceBranch? }` beside
  `pullNumber`. A title is the prefix, the number, and the repository's last path segment.
- `ensureWorktree` takes the primary's ref and name. It fetches the code host's ref, or the source
  branch when the host declares none, into `refs/acorn/change-request/<n>`. Archive restore asks for a
  primary change request instead of `pullNumber`. `projectWorktreeIdentity` reads the facet and names
  folders as before.
- The client has no `pr` default. `defaultLayout()` is empty, and `TaskPaneHost` draws the change
  request's pane, or else the first pane the task offers. `activateTaskSignals` seeds the change
  request's pane before a source's `defaultPane`. The task dialog no longer forces `pr`.
- `github:pr-filters` lives in the GitHub plugin's slice, and `PrefKeys.prFilters`,
  `prFiltersScoped`, and `PersistedSliceKeys.prFilters` are gone. The stored key is unchanged. The
  promote context carries `repository` in place of `owner` and `repo`, which nothing read.
- The rail's dead `checks` input is gone from `TabRail.tsx` and `railStatusMarkers`. GitHub publishes
  its own checks marker.
- The GitHub plugin calls `attachChangeRequest`, `adoptChangeRequests`, and `changeRequests`.
- The `gitlab-test` fixture declares merge requests. `codeHosts.test.ts` creates `!12`, checks out
  `merge-requests/12/head`, sees the fixture's pane, and checks out a source branch on an unclaimed
  host. [Code hosts](../../plugins/code-hosts.md#change-requests) documents it.

Decisions and deviations:

- `tasks.pull_number` stays in step through `setPrimaryChangeRequest`, the way phase 5 kept the GitHub
  columns in step. `TaskRef`, the wire task, and the context sections read it with no join.
  `task_pulls` is frozen: nothing reads or writes it, and task deletion still clears it.
- `provider`, `repo_host`, and `repo_path` hold `''` for a project with no remote, because they're in
  the primary key. A task on such a project can still hold a change request, as it could hold a
  `pullNumber`, but its `pullNumber` reads null.
- Reads take the live claim for the host first, then the stored provider, the same rule as a project.
- The migration keeps one row when older `task_pulls` rows spell one pull request's owner or name in
  two cases, which lowercase to one key. It keeps the row that held the primary slot, else the oldest.
  `taskChangeRequestsMigration.test.ts` covers it, because a duplicate would abort the Node's boot.
- Provenance is `task`, `adopted`, or `agent`. `pulls` returns only agent rows on github.com, so its
  published type stays true. An agent attaching a change request already linked another way records
  its session on that row.
- Adoption runs in one transaction rather than a batch with per-row guards, so a task can't change
  between the read and the write. The race test became a test of the same three states.
- A cleared primary stays as a related row, and setting it again promotes that row.
- `TaskRef` has no change request field. A plugin calls `changeRequests(taskId)`.
- A loaded plugin with the `tasks` grant can link a change request on any provider's repository, as
  `attachPull` allowed. It isn't narrowed to its own host.
- The old private refs under `refs/acorn/pull/` stay in checkouts. They cost 41 bytes each.
- The patch response no longer echoes `pullNumber`, and `patchTask` lost the field, which nothing
  sent.
- The task list makes four queries instead of three, one more for the primaries.

Checked against a copy of the owner's data root, copied to a scratch folder and opened only there.
The migration ran on top of 0009. All 364 tasks listed with the same title, branch, project, and
`pullNumber` as the column read before. The 83 pull request tasks each got a primary on github.com
that opens `pr`, as before, and the other 281 have none. `task_pulls` was empty. All 193 saved pane
layouts were unchanged.

Checked on the final tree: oxlint, the format check, and knip, `tsc` in protocol, plugin-types,
plugin-api, node-core, client-core, desktop, terminal client, Node app, CLI, GitHub, notes, and
terminal, and the tests for node-core (1,805 passed), client-core, the terminal client, the GitHub
plugin (310), the Node app, CLI, notes, terminal, plugin-types, the desktop's persisted-state
conformance, and the arch tests. The reds also fail on the base, as earlier notes record: the Node's
`pluginDisable` pair, client-core `cssHygiene` border radius, two `TerminalPanel` cases, and in the
arch tests the client console baseline, two doc citations, two docs over 200 lines, four doc paths,
and two `testFocus` cases. oxlint's one error is `apps/extension`, and five files outside this
change fail the format check.

For later phases:

- Still GitHub-named outside this phase's changes: the core agent tools `pr_current` and
  `pr_changed_files`, which read GitHub's `pr` context section; the browser handoff seed's
  `pullNumber` and the CLI's matching on it; `TaskContext.task.pullNumber`; `taskContext().pull`; and
  the CLI's `taskPages` URL. Phase 5's list still stands for the archive and worktree route session
  env, the authoring route, and the workspace projects data source.
- A code host with no ref can't check out a fork's change request, because core fetches the source
  branch from origin.

## Removals at the next plugin API major

Remove these together:

- `TaskRef.pullNumber`, `AttachTaskPullInput`, `TaskPullRelation`, and `CoreTaskService.pulls`,
  `attachPull`, and `adoptPullNumbers` in `acorn-plugin-types`, with their node-core twins and host
  call modes.
- `pullNumber` on the wire `Task`, `TaskSeed`, the task patch body, `TaskContext.task`, and the
  browser handoff seed.
- The `tasks.pull_number` column and its write in `setPrimaryChangeRequest`, and the `task_pulls`
  table with its two deletes.

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
