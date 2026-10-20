# Code hosts

This page covers code hosts, the way a plugin claims the Git hosts whose repositories it understands.
It's part of the [plugin reference](../plugins.md).

## Code hosts

Core reads any project's origin remote as a host and a path, such as `gitlab.example.com` and
`group/subgroup/repo`. It needs no plugin for that. A code host plugin claims hosts, and core stamps
the plugin's id on every project whose remote is on one of them. GitHub claims `github.com`. A GitLab
or Bitbucket plugin declares the same thing with no core edit.

There are two carriers and one registry. A compiled plugin sets `NodePlugin.codeHost`. A loaded plugin
declares `contributions.codeHost` in its manifest:

```json
"contributions": {
  "codeHost": { "label": "GitLab", "hosts": ["gitlab.com", "gitlab.example.com"] }
}
```

A plugin that adds hosts while it runs declares `selfHosted` too, as described in
[self-hosted code hosts](./self-hosted-code-hosts.md).

A host is a bare lowercase name, with no scheme or port. The declaration needs a `node` entry,
because only a running node half registers it. It also needs `projects:read`, or a grant that implies
it, in `permissions.node.core`: a code host's data sources get the paths of the projects on its hosts,
so the person consents to that in the trust prompt like any other project read. The registry is
`packages/node-core/src/server/pluginHost/codeHosts.ts`, and it empties when the plugin stops. A
plugin reads which code hosts are running with `ctx.core.codeHosts()`, and the `label` one declared
with `ctx.core.codeHostLabel(id)`.

The provider is the plugin's own id, so two plugins can't declare the same provider. When two running
plugins claim one host, a built-in beats a loaded plugin, and between two of the same tier the lower
plugin id wins. Registration order never decides it, so an installed package can't take `github.com`
from GitHub by loading first or by outlasting a reload. The Node logs a warning for the losing claim.

## Hosts claimed at runtime

A `selfHosted` code host, such as GitLab, claims a company server's host while the person's connection
to it exists, and its browser handoffs and content links can name `{codeHost}` as their host. For the
rules, see [self-hosted code hosts](./self-hosted-code-hosts.md).

## The repository facet

A project's repository facet is four fields:

| Field | What it holds |
| --- | --- |
| `provider` | The id of the plugin that claims the host, or null when none does |
| `host` | The remote's host, lowercased, without a user or port |
| `path` | The repository's path on that host, lowercased, without `.git` |
| `externalId` | The provider's own id for the repository, when it set one |

Core parses https, ssh, git, and scp-like remotes. A local path has no host, so it gets no facet.
Paths are lowercased because GitHub, GitLab, and Bitbucket all match them case-insensitively.

The facet is set when a project is added, and refreshed when its folder changes or something posts
to `/v1/core/projects/:id/detect`. Reads take the live claim first. The stored provider stands in only
while no running plugin claims the host, so turning a code host off doesn't orphan its projects. A
re-detect keeps the stored provider and external id while the remote names the same repository. A
different repository starts over.

A plugin reads the facet as `ProjectRef.repository` and finds a project with
`ctx.core.projects.byRepository(provider, path)`. When two clones of one repository are two projects,
the oldest wins, the same rule as `byGithub`. An importer passes `repository: { host, path,
externalId }` to `create`, and sets the external id later with `update({ repositoryExternalId })`.
Both need the `projects:write` grant. The provider always comes from the claim, never from the caller.
A loaded plugin can set an external id only on a repository whose host it holds, so it can't overwrite
another provider's, GitHub's repository id included.

Core hands the facet to context sections as `repository`, and the `repo_info` agent tool returns it.
A typed data source whose plugin is the provider gets the paths of the projects in scope as
`workspaceLinks`.

## Change requests

A change request is a code host's pull request or merge request. A task can link any number of them
on its project's repository, in core's `task_change_requests` table. One is the task's primary: core
checks it out when it makes the worktree, titles the task with its number, and opens the code host's
pane for it. The rest are related, such as the second pull request an agent opened in the same task.

A code host tells core how to treat its change requests with an optional `changeRequest` block:

```json
"codeHost": {
  "label": "GitLab",
  "hosts": ["gitlab.com"],
  "changeRequest": {
    "ref": "merge-requests/{number}/head",
    "label": "merge request",
    "prefix": "!",
    "pane": "mr",
    "api": "/v1/p/gitlab/change-requests"
  }
}
```

| Field | What core does with it |
| --- | --- |
| `ref` | Fetches it from origin to check a change request out. Without one, core fetches the source branch by name, from the fork when the link names one, as described in [forks without a ref](#forks-without-a-ref). |
| `label` | Names a change request in an error, such as "Could not fetch merge request !12". Defaults to `change request`. |
| `prefix` | Goes before the number in a task title, as in `!12 api`. Defaults to `#`. |
| `pane` | Opens when a task with a primary change request on the host is first shown. A task without one opens on the first pane it offers. |
| `api` | A route on the plugin's own Node half. Core's agent tools and `pr` context section ask it about a task's change request, as described in [agent context](#agent-context). |

A plugin links one in one of three ways. A task created with `changeRequest: { number, sourceBranch?,
sourceRepository? }` on `POST /v1/core/tasks` takes it as its primary, and `PATCH` sets or clears the
primary the same way. A browser handoff's seed takes the same fields. `ctx.core.tasks.attachChangeRequest`
records one an agent opened, with its session. The first takes an empty primary slot and later ones
are related. `adoptChangeRequests(provider, path, branchToNumber)` gives a primary to every active task
on that branch that has none. A value in the map is a number, or `{ number, sourceRepository }`. The
provider and path must name the task project's repository. `changeRequests(taskId)` lists them all. The
wire task carries the primary as `changeRequest`, with the provider and the declared pane.

### Forks without a ref

Bitbucket Cloud serves no change request ref, and a fork's branch isn't on origin. A link names the
fork with `sourceRepository`, its path on the same host, such as `alice/api` for a fork of `acme/api`.
A path rather than an address keeps a plugin from pointing core's git at another host. When the code
host declares no `ref`, core swaps the path at the end of origin's configured address for the fork's
and fetches `refs/heads/<sourceBranch>` from it, so `git@bitbucket.org:acme/api.git` becomes
`git@bitbucket.org:alice/api.git` with origin's transport, credentials, and `insteadOf` rules. A host
that declares a `ref` ignores the fork. Core lowercases the path and refuses an empty, `.`, or `..`
segment, one that starts with `-`, and any character but a lowercase letter, a digit, `.`, `_`, or `-`.
An unreadable fork fails with "Could not fetch pull request #12 from alice/api. The fork may be private
or gone." Pushing still goes to origin. [Bitbucket](../bitbucket-integration.md) passes forks this way.

## Agent context

Core owns the `pr` context section and the agent tools `pr_current`, `pr_changed_files`, `pr_checks`,
`pr_review_comments`, and `pr_create`. Each finds the task's primary change request and asks the
running plugin that holds its host, through the routes under its declared `api`:

| Route | Answers |
| --- | --- |
| `GET {api}/{number}?taskId=` | The number, title, body, and changed file paths |
| `GET {api}/{number}/checks?taskId=` | Each check's name, status, and URL, with the failing and pending names |
| `GET {api}/{number}/feedback?taskId=` | Reviews, inline threads, and conversation comments. `includeResolved=true` adds resolved threads |
| `POST {api}` | Opens a change request from `head`, the task's branch, and answers `{ number }` |

The shapes are `changeRequestDetail`, `changeRequestChecks`, `changeRequestFeedback`,
`changeRequestCreateInput`, and `changeRequestCreated` in `packages/protocol/src/plugin/contract.ts`.
Core parses every answer with them, so a compiled and a loaded plugin give an agent the same fields.

Core calls the three reads as the task, so a route should check the task with `mayActOnTask` and
read only its own local data. A read waits at most 5 seconds. A 404, a timeout, or an answer that
doesn't parse means there's nothing to show: the section stays empty, and `pr_checks` and
`pr_review_comments` say nothing is mirrored. A task with no primary change request, or one whose host
declares no `api`, gets `no-pr` from `pr_current`, `pr_checks`, and `pr_review_comments`.

Core calls the `POST` as the Node, because opening one spends the person's connection and a task can't.
The task id rides in the body. Core attaches the number the route answers to the task with the agent's
session, as `attachChangeRequest` does. An error answer's `error.message` reaches the agent.

The section's label is the declared `label`, so a GitLab task reads `Merge request`, and its item label
starts with the declared `prefix`, as in `!12 Fix the importer`. The task a section's `assemble` receives,
and `TaskContext.task`, carry the primary as `changeRequest: { provider, number }`.

## Workflow CI

A code host that supports CI files a `ci-settled` policy against the workflows plugin's
`workflows:policy` point, and one that supports reviews files `review-received`. The workflow names
`checks-green`, `review-received`, and `ci-loop` ask the policy filed by the plugin that holds the
task's primary change request ([gate policies](../workflows/step-kinds.md#gate-policies)). Import
`CODE_HOST_POLICY`, `CiSettledValue`, and `WORKFLOW_POLICY` from
`plugins/workflows/src/contract/extensions.ts`.

Emit `plugin:<id>:checks-changed`, and declare the verb in `emits`, when a change request's checks
change. Any plugin may listen for it ([hearing another plugin](./events.md#hearing-another-plugin)).

## Outside the code host plugin

Nothing else branches on github.com. These read the facet or a code host's declaration instead:

- Task processes get `ACORN_REPO`, the facet's path, and `ACORN_REPO_HOST`, its host, from
  `buildSessionEnv`. On github.com `ACORN_REPO` keeps GitHub's owner and name as before.
- The browser extension's host marks a running code host's task addresses `caseInsensitive`, from the
  `codeHosts` list in `GET /v1/core/browser-handoffs`.
- The first-run wizard offers a code host when its provider can connect and its plugin registered a
  project importer under the provider's id, as GitHub's `github` importer does.
- `UserAvatar` draws `src`, or initials without one. A code host passes its own picture URL.
- Linear names an attachment's source with `ctx.core.codeHostLabel(sourceType)`.
- A plugin with a mirror provides `mirrorFootprintCapability(ctx.name)` from `@acorn/plugin-api/node`,
  and the boot storage log prints its counts.

## The GitHub-named fields

`ProjectRef.github`, the wire `Project.github` and `Task.github`, `byGithub`, the `github` and
`githubRepoId` inputs, and the `githubRepository` field of the local branches source predate the
facet. Each is now read off a `github.com` repository whose path is an owner and a name, so it stays
correct. The next plugin API major removes them. The checklist is in the split programme's phase 5
plan, in Git history at commit `ffe59144b` under `docs/future/split/`.

`pullNumber` on the wire task, `TaskRef`, a task seed, and a patch, and `pulls`, `attachPull`, and
`adoptPullNumbers` on the task service, are the same for change requests on `github.com`. The
`tasks.pull_number` column copies the primary's number there, and `task_pulls` is no longer read. The
next major removes those too, with the checklist in the phase 6 plan at the same commit.
