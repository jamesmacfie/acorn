# Phase 5: let a code host plugin own repository identity

## Completion note

Landed October 15, 2026.

What changed:

- `contributions.codeHost` in a manifest and `NodePlugin.codeHost` on a compiled plugin declare a
  label and a host list. `registerDeclarations` in the plugin host replays either into the registry in
  `packages/node-core/src/server/pluginHost/codeHosts.ts`, which `codeHostFor(host)` reads. GitHub
  declares `github.com`. A manifest that declares one without a `node` entry is refused.
- `projects` gained `repo_provider`, `repo_host`, `repo_path`, and `repo_external_id`. Migration
  `0009_project_repository_facet` fills them from the GitHub columns, with `github` as the provider.
- `parseGitRemote` replaced `parseGithubRemote`. It reads https, ssh, git, and scp-like remotes on any
  host as a lowercased host and path. `repositoryColumns` writes the facet and the GitHub columns
  together, and `githubFacet` reads the GitHub fields off a `github.com` repository. Every facet write
  in `projects.ts` goes through them.
- The wire `Project` and `Task`, `ProjectRef`, and `ProjectCreateRefInput` carry `repository`.
  `ProjectUpdateRefInput` has `repositoryExternalId`, and `CoreProjectService` has
  `byRepository(provider, path)`, granted by `projects:read`. The surface snapshot only gained lines.
- Context sections get `repository` in place of `github`, and GitHub's `pr` section reads it.
  `repo_info` returns `repository` beside `owner` and `name`. The local branches source has
  `remoteRepository` as `host/path`, at revision 3, and keeps `githubRepository`.
- A data source's workspace links include project paths when the source's plugin is the project's
  provider. That replaced the `'github'` check in `sourceContext.ts`, so the allowlist entry in
  `tools/arch/boundaries.test.ts` no longer mentions GitHub.
- [Code hosts](../../plugins/code-hosts.md) documents the kind and the facet. A loaded fixture in
  `apps/node/test/__fixtures__/gitlab-test` claims `gitlab.test`, and
  `apps/node/test/integration/plugins/codeHosts.test.ts` checks the acceptance cases over HTTP.

Decisions and deviations:

- The provider ID is the declaring plugin's ID, not a separate field. Plugin IDs are unique, so two
  providers can't collide, and a data source's plugin ID matches its provider with no mapping. One
  plugin declares at most one code host.
- When two running plugins claim one host, a built-in beats a loaded plugin, and between two of the
  same tier the lower plugin ID wins. Registration order would let an installed package take
  `github.com` from GitHub by loading first or across a GitHub reload. That would pass GitHub's
  repository paths to its data source through workspace links.
- The GitHub fields come from the host, `github.com`, rather than from the provider being `github`.
  That keeps core from naming the plugin, and they read the same while the GitHub plugin is off.
- The provider is stored when the project is added or detected again, but reads take the live claim
  first. The stored provider stands in only while no running plugin claims the host. A provider stamped
  while another plugin held the host can't outlive that, and a plugin that isn't running serves no data
  source, so workspace links only reach the plugin that holds the host. A re-detect keeps the stored
  provider and external ID while the remote names the same repository, and clears them when it names
  another one.
  Before, a re-pointed remote kept a stale `github_repo_id`.
- Host and path are lowercased for every host, as GitHub's were. GitHub, GitLab, and Bitbucket all
  match paths case-insensitively.
- A project's default name falls back to the last path segment on any host, not only on GitHub.
- `repository` is optional on the wire `Project` and `Task`, because an older Node doesn't send it.
  It's required on `ProjectRef`, because the Node always sets it there.
- Only remotes that GitHub columns describe are backfilled. Another project gets its facet the next
  time its folder changes or something posts to `/v1/core/projects/:id/detect`. Nothing in the UI
  triggers detection.
- The Node service ceiling in `apps/node/scripts/check-service-budget.mjs` went from 1,819,500 to
  1,822,300 bytes. The static graph grew from 1,817,458 to 1,820,255 bytes, all of it remote parsing,
  the facet helpers, and the registry, which project detection needs at boot.
- A loaded code host must declare `projects:read`, or a grant that implies it. Its data sources get
  the paths of the projects on its hosts, which is a project read the person should consent to.
- A loaded plugin can set an external ID, through `create` or `update`, only on a repository whose
  host it holds. For `update`, `updateProjectRef` checks the holder against the facet it's about to
  write, and the write applies only while the row still has that host and path. Otherwise a patch that
  also changes `path`, or a concurrent one, could re-point the project at another provider's repository
  between the check and the write. `githubRepoId` falls under the same rule, which is narrower than before for loaded
  plugins. No plugin in this repo or the outside checkouts sets it as a loaded plugin.
- GitHub Enterprise isn't covered. The GitHub plugin has no Enterprise support, so it claims a fixed
  list. A self-hosted host has to be in the manifest. Nothing claims a host a connection names.

Checked on the final commit: oxlint, the format check, and knip, `turbo run lint` for every package
this touches or that consumes it, and `pnpm test` for node-core (1,801 passed), the GitHub plugin (310
passed), the Node app, and the arch tests. The reds also fail on the base, as the phase 1 and 3 notes
record: the Node's route golden list and plugin-disable pair, and in the arch tests the client console
baseline, two doc citations, three docs over 200 lines, and four doc paths. A full run before the
security fixes also showed the base reds `cssHygiene`, `toolFoldPrefs`, and two `TerminalPanel` cases.
`processOwnership` in agents failed there under load, and passes alone on this branch and on the base.

Fixtures that seed a project with only the GitHub columns no longer read as GitHub through the derived
fields. Real rows can't look like that after the migration. The fixtures that read derived fields now
seed the repository columns too. The rest still feed readers of the old columns and pass unchanged.

For phase 6:

- Hang the ref pattern, labels, and pane off `CodeHostDescriptor` in
  `packages/protocol/src/plugin/contract.ts`. The registry keys declarations by plugin ID. Add a
  by-provider lookup beside `codeHostFor` when something needs one.
- A change request link can store a provider and a path, and resolve the project with
  `projectByRepository` in `packages/node-core/src/server/projects/projects.ts`.
- These core readers still read the GitHub columns, which stay in step: `adoptPullNumbers` and
  `attachPull` in `core/tasks.ts`, `projectWorktreeIdentity` in `taskWorktree.ts`, the worktree route,
  the task title seed in `routes/projects/tasks.ts`, the archive, the authoring route, and the
  workspace projects data source. Move each to `projectRepository` as phase 6 reaches it.
- The GitHub plugin's importer still calls `byGithub` and passes `githubRepoId`, and its branch source
  maps `githubRepository`. Both work through the compatibility fields.

## Removals at the next plugin API major

Remove these together, after the readers above move to the repository facet:

- `ProjectRef.github`, `ProjectCreateRefInput.github`, `ProjectUpdateRefInput.githubRepoId`, and
  `CoreProjectService.byGithub` in `acorn-plugin-types`, with their node-core twins, the
  `projects:read` grant entry, and the host call mode.
- `github` on the wire `Project` and `Task`, and `githubFacet`.
- `owner` and `name` in the `repo_info` tool and `/v1/core/tasks/:id/repo-info`.
- `githubRepository` in the local branches source, after GitHub's branch source maps
  `remoteRepository`.
- The `github_owner`, `github_name`, and `github_repo_id` columns and `projects_github_idx`, with the
  GitHub half of `repositoryColumns`, `projectByGithub`, and `normalizeGithubPart`.
- `SessionTaskInfo.github`, so `ACORN_REPO` is the facet's path on github.com too, and the same
  override in the preview plugin's `scriptUrl`.
- The GitHub picture a remote tree's `UserAvatar` gets from a login with no `src` (`TreeUserAvatar` in
  `packages/client-core/src/host/tree/components.ts`).
- The extension's `page.source === 'github'` fallback in `pageMatches`, once every Node sends
  `codeHosts`.

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
