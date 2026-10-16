# Phase 7: check out a fork's change request from the fork

## Completion note

October 17, 2026. Done, verified against local repositories over file URLs only.

What landed:

- `task_change_requests.source_repo_path`, migration `0012_change_request_source_repo`. Null means
  the base repository.
- `isValidRepositoryPath` in `packages/protocol/src/projects/branch.ts`, beside `isValidBranch`. It
  takes a lowercased path of two or more segments of `[a-z0-9._-]`, none empty, `.`, `..`, or starting
  with `-`.
- `sourceRepository` beside `sourceBranch` on `attachChangeRequest`, the task create and patch bodies,
  the wire seed, and the browser handoff seed. The handoff seed also gained `sourceBranch`, which it
  lacked, because a fork's checkout needs both. `TaskChangeRequest` carries `sourceRepository` back.
- `adoptChangeRequests` takes a map value of a number or `{ number, sourceRepository }`.
- `changeRequestFetch` in `packages/node-core/src/server/core/changeRequests.ts` replaces
  `changeRequestRef`. With no declared `ref` and a fork, it answers `refs/heads/<branch>` and the fork.
  `ensureWorktree` then builds the address with `forkRemoteUrl` and fetches after `--`.
- [Code hosts](../../plugins/code-hosts.md#forks-without-a-ref) documents it, and the site's `codeHost`
  reference page no longer says a fork can't be checked out.

Decisions and deviations:

- The address comes from `git config --get remote.origin.url`, not `git remote get-url`, so git applies
  the person's `insteadOf` rules to the fork's address as it does to origin's.
- `forkRemoteUrl` swaps the base repository's path at the end of origin's address, compared without
  case, and keeps the prefix and any `.git` suffix. That keeps https, ssh, scp-like, and file forms, a
  GitLab under a subpath, and credentials in the address. An origin that doesn't end in the base path
  fails with a message that says so.
- A fork path equal to the base path is treated as no fork.
- The failure says "Could not fetch pull request #12 from alice/api. The fork may be private or gone."
  Git's own message isn't forwarded, because its stderr can hold credentials, which is the existing
  rule for every fetch here.
- An invalid fork path is refused at attach and on the routes, and skipped by adoption, which already
  skips a bad number.
- The acceptance test declares a `bitbucket-test` code host with no `ref` in
  `apps/node/test/integration/plugins/codeHosts.test.ts`, rather than a second fixture folder. The
  same file proves the `gitlab-test` fixture, which declares a `ref`, ignores a source path.
- Fixed a test bug that went red on this branch: the upload helper in
  `packages/node-core/src/server/routes/projects/workspaces.test.ts` sent `bytes.slice().buffer`, which
  is Node's whole shared buffer pool, so its `<svg/>` upload could carry an earlier PNG's bytes.

For later phases:

- Phase 8: Bitbucket declares no `ref` and passes the fork's `full_name`, lowercased, as
  `sourceRepository`, with `sourceBranch`, from the pull request's `source.repository` when it differs
  from the destination.
- Already red at the base and untouched: the `pluginDisable` and `routeRegistry` goldens in
  `apps/node`, three `docPaths` entries for `dist` files, knip's `proposalChanges`, and three site unit
  tests.

Date: October 16, 2026. Status: proposed. Independent of phases 1 to 6. Must land before
[phase 8](./08-bitbucket-plugin.md).

## Goal

A task on a change request opened from a fork checks out the fork's branch on a code host that
publishes no change request ref. Bitbucket Cloud is that host.

## Starting point

- `ensureWorktree` in `packages/node-core/src/server/worktrees/worktrees.ts` fetches from `origin`
  into `refs/acorn/change-request/<n>`. The refspec comes from `changeRequestRef` in
  `packages/node-core/src/server/core/changeRequests.ts`: the code host's declared `ref` with the
  number filled in, or else the stored `sourceBranch`.
- GitHub serves `pull/{number}/head` and GitLab serves `merge-requests/{number}/head`, including for
  forks, so both check out any change request.
- Bitbucket Cloud serves no change request ref. Atlassian's
  [knowledge base article on fetching a pull request](https://support.atlassian.com/bitbucket-cloud/kb/how-to-locally-fetch-and-checkout-a-pull-request/)
  says to fetch both branches by name, and to clone the fork for a fork's pull request. Core fetches
  the source branch from `origin`, which doesn't have it, so the task fails with "Could not fetch pull
  request".
- `task_change_requests` in `packages/node-core/src/server/db/schema.ts` stores `source_branch` but
  not where the branch lives.

## The design

A change request link gains an optional source repository path, such as `alice/api` for a fork of
`acme/api`. It's a path on the same host, not a URL. When the code host declares no ref and the link
has a source path, core builds the fetch address from origin's own address with the path swapped.
`git@bitbucket.org:acme/api.git` becomes `git@bitbucket.org:alice/api.git`, and the https form
changes the same way. The fetch uses the same transport and the same git credentials as origin.

Taking a path rather than a URL keeps a plugin from pointing core's git at another host. Core never
fetches from an address the remote doesn't already name the host of.

## Changes

1. Add `source_repo_path` to `task_change_requests`, with a migration. Null means the source is the
   base repository.
2. Accept `sourceRepository` beside `sourceBranch` in `attachChangeRequest`, `adoptChangeRequests`,
   the task create and patch bodies, and the handoff seed. Lowercase it, and refuse a path with an
   empty segment, `..`, a leading `-`, or a character outside what the three hosts allow in names.
   The `--upload-pack=x` test in `packages/node-core/src/server/core/tasks.test.ts` shows the shape.
3. In `ensureWorktree`, when the declaration has no `ref` and the link has a source path, fetch
   `+refs/heads/<branch>:refs/acorn/change-request/<n>` from the derived address. Name the fork in the
   failure message: "Could not fetch pull request #12 from alice/api."
4. Update [code hosts](../../plugins/code-hosts.md#change-requests), and remove the line that says a
   fork's change request can't be checked out without a ref.

## Out of scope

- Pushing back to the fork. An agent that pushes the task branch pushes to origin, as it does for a
  GitHub fork's pull request.
- Refreshing the worktree when the fork's branch moves. That's the same for every host.

## Acceptance

- A `gitlab-test` fixture variant with no `ref` and a fork in a second local repository checks out the
  fork's branch, over a file URL in the test.
- The derived address keeps origin's form for https, ssh, and scp-like remotes.
- A source path with `..`, a leading `-`, or an empty segment is refused at attach time.
- Hosts that declare a `ref` ignore the source path, so GitHub and GitLab tasks don't change.

## Risks

A private fork the person can't read fails at fetch time with git's own message. That's the right
answer, but say so in the failure: the fork is private or gone.
