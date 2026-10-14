# Phase 5: let a code host plugin own repository identity

Date: October 14, 2026. Status: proposed. Phase 6 depends on it.

## Goal

Core knows that a project has a Git remote and which code host claims it. It doesn't know what
GitHub is. GitHub keeps its experience through a code host contribution, and a GitLab or Bitbucket
plugin can declare the same contribution with no core edit.

## Starting point

GitHub vocabulary runs through core's project model:

- `projects` in `packages/node-core/src/server/db/schema.ts` has `github_owner`, `github_name`, and
  `github_repo_id`, with an index on the first two.
- `parseGithubRemote` in `packages/node-core/src/server/projects/projects.ts` recognises only
  `github.com`. `detectProject` fills the GitHub columns from it, and a project's default name falls
  back to the GitHub repository name.
- `projectByGithub` and `byGithub` in `packages/node-core/src/server/core/projectRefs.ts` look a
  project up by owner and name.
- The wire `Project` in `packages/protocol/src/transport/api/projects.ts` has a `github` field. So
  does the task shape built in `packages/node-core/src/server/routes/projects/tasks.ts`.
- `packages/node-core/src/server/dataSources/localGitSources.ts` publishes a `githubRepository`
  field. `packages/node-core/src/server/routes/projects/taskContext.ts` gives the `repo_info` agent
  tool a GitHub owner and name. `packages/node-core/src/server/agentTools/contextSections.ts` hands
  every context section a `github` argument.
- The published plugin types, `acorn-plugin-types`, expose `CoreProjectService.byGithub`,
  `ProjectRef.github`, and `ProjectCreateRefInput.github`. The surface snapshot in
  `tools/arch/publishedPluginSurface.snapshot.txt` pins them under plugin API major 5.

Owner and name is GitHub's shape. GitLab paths nest groups, as in `group/subgroup/repo`, and
Bitbucket uses a workspace and a repository.

## The design

Split identity into the part core can compute and the part a plugin owns:

- Core parses any Git remote into a host and a path, such as `gitlab.example.com` and
  `group/subgroup/repo`. That needs no plugin.
- A code host contribution claims hosts and names the provider. GitHub claims `github.com` and any
  GitHub Enterprise host its connections name. A GitLab plugin claims `gitlab.com` and its
  self-hosted hosts.
- A project's repository facet is the provider, host, path, and an optional external ID the plugin
  sets through a core service. GitHub's numeric repository ID becomes that external ID.

Make the contribution declarative, a host list plus a provider ID and label, so a loaded plugin can
declare it in its manifest. Repository identity is exactly the kind of thing a third-party GitLab
plugin would ship.

## Changes

1. Add the code host contribution kind, with a manifest form. Follow the
   [contribution kinds](../../contribution-kinds.md) rules and the checklist for a top-level manifest
   key, because the builder, testkit, and schema have fixed field lists that the type checker doesn't
   reach.
2. Add `repo_provider`, `repo_host`, `repo_path`, and `repo_external_id` columns to `projects`, and
   a migration that fills them from the GitHub columns. Keep the GitHub columns until step 6.
3. Move remote parsing to the generic host and path form. Run the claim through the registered code
   hosts. Have the GitHub plugin register its contribution.
4. Add the generic fields beside the GitHub ones on the wire `Project`, the task shape,
   `ProjectRef`, and `ProjectCreateRefInput`. Add a `byRepository(provider, path)` lookup beside
   `byGithub`. Derive the GitHub fields from the generic ones, so they stay correct and additive.
5. Pass the repository facet, not `github`, to context sections and `repo_info`. Rename
   `githubRepository` in the local Git source to a generic field, and keep the old field as a copy.
6. At the next plugin API major, remove the GitHub-named members and columns. List them in this
   file so the major has a checklist.
7. Remove the `github` entries for this facet from the "core never names a plugin" allowlist in
   `tools/arch/boundaries.test.ts`.

## Out of scope

Change requests, checkout, and the default pane, which are [phase 6](./06-change-requests.md). The
GitHub plugin's own tables and mirror, which are already plugin-owned.

## Acceptance

- A project whose remote is on `github.com` reads the same as before, field for field, through both
  the GitHub and generic names.
- A test plugin in the Node testkit declares a code host for `gitlab.test`. A project with a remote
  on that host gets a repository facet naming it, with a nested path, and no core file changes.
- A project on an unclaimed host gets a host and path with no provider, and nothing errors.
- The published surface snapshot shows the generic members added and nothing removed.

## Risks

Two clones of one repository share a facet, and `byGithub` returns the oldest. Keep that rule for
`byRepository`, and say so in its comment, so the behavior doesn't change by accident.
