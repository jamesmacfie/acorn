# Phase 3: remove the small GitHub assumptions outside the plugin

Date: October 16, 2026. Status: proposed. Independent of phases 1 and 2.

## Goal

Nothing outside `plugins/github/` behaves differently because a project is on github.com, except
through a code host declaration. Each item below is small. Together they're what a GitLab user would
notice first.

## Starting point

These places read GitHub directly, as of October 16, 2026:

| Where | What it assumes |
| --- | --- |
| `packages/client-core/src/kit/components/content/UserAvatar.tsx` | Every avatar is `github.com/<login>.png`, through `githubAvatarUrl` in `packages/client-core/src/kit/lib/rendering/displayMeta.ts`. A GitLab login draws a stranger's GitHub picture, or a broken image. |
| `packages/node-core/src/server/taskEnv.ts` | `ACORN_REPO` is set only from `task.github`, so a GitLab task's processes get none. |
| `plugins/preview/src/server/previewUrls.ts` | The same `ACORN_REPO`, from `project.github`. |
| `plugins/workflows/src/server/runs/activation.ts` and `plugins/terminal/src/server/workflowSteps.ts` | Both pass `project.github` to `buildSessionEnv`, the input behind `ACORN_REPO`. |
| `apps/extension/src/taskPages.ts` | `pageMatches` ignores letter case only when `page.source === 'github'`. GitLab and Bitbucket paths are case-insensitive too, so `/Group/Repo/-/merge_requests/12` misses its task. |
| `plugins/onboarding/src/client/OnboardingWizard.tsx` and `plugins/onboarding/src/client/GithubConnect.tsx` | The wizard has a `github` step that connects GitHub and opens GitHub's importer. Another code host has no place in first-run setup. |
| `plugins/agents/src/client/center/AgentCenter.tsx` | Session search matches `task.github.name`, so a GitLab task's repository name finds nothing. |
| `plugins/linear/src/tree/LinearIssueView.tsx` | `SOURCE_NAME` maps only `github` to a display name for an attachment's source. |
| `apps/node/src/composition/composition.ts` | The boot storage log counts mirror rows through the `GITHUB_MIRROR` capability only. |

## Changes

1. Give `UserAvatar` an optional `src`, and draw initials when it has none. The avatar is also a
   remote tree node in `packages/protocol/src/tree/nodes.ts`, drawn by the desktop and by the
   terminal client in `apps/tui/src/kit/showing.tsx`, so add `src` there too. Have the GitHub plugin
   pass `githubAvatarUrl` and move that function into the plugin. GitLab's and Bitbucket's APIs return
   an avatar URL on every user, so their records carry it.
2. Set `ACORN_REPO` from the repository facet's path for every host, and add `ACORN_REPO_HOST` with
   the host. Pass `repository` instead of `github` through `buildSessionEnv` and its three callers.
   On github.com, keep the value byte-identical to what `task.github` gave, because scripts compare
   it. The facet's path is lowercased, and `task.github` may not be, so keep the GitHub read for
   github.com until the next major.
3. Add `caseInsensitive` to `BridgeTaskPage` in `packages/protocol/src/transport/extensionBridge.ts`.
   The Node sets it for a page whose source is a code host plugin, because GitHub, GitLab, and
   Bitbucket all match paths without case. `pageMatches` reads the flag instead of the plugin id. An
   older Node sends no flag, so keep the `github` test as the fallback.
4. Replace the wizard's `github` step with a code host step. It offers each connectable provider whose
   plugin registered a project importer, with the provider's label and glyph. With one such provider
   it opens that provider straight away, which is the flow GitHub has.
5. Match session search on the last segment of `task.repository.path`.
6. Name an attachment's source with its plugin's label instead of a fixed map.
7. Add a neutral mirror footprint capability that any plugin with a mirror provides, and have
   `reconcileNode` log every provider's counts. Move GitHub's `footprint` onto it.

## Out of scope

- Worktree folder names. `projectWorktreeIdentity` in
  `packages/node-core/src/server/worktrees/taskWorktree.ts` names folders after GitHub's owner and
  name, and other projects get `p/<slug>`. Changing it would move live worktrees, and the name has no
  meaning beyond the path.
- The GitHub-named wire fields themselves. The next plugin API major removes them.
- **Install plugin** offering a GitHub release as a source. That's where plugin packages come from,
  not a code host.

## Acceptance

- A GitHub task's `ACORN_REPO`, avatars, browser extension matches, and first-run flow are unchanged.
- A `gitlab-test` task's processes see `ACORN_REPO=group/sub/api` and `ACORN_REPO_HOST=gitlab.test`.
- The extension matches a `gitlab-test` page whatever the case of its path, with a Node that sets the
  flag.
- The wizard offers the `gitlab-test` fixture's connection and importer when it registers both.

## Risks

A loaded plugin's remote tree that draws an avatar from a login alone loses its picture, because the
login no longer implies GitHub. Keep the GitHub URL as the fallback for a tree node with a login and
no `src` until the next plugin API major, and list it with the other removals.
