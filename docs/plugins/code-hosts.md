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

A host is a bare lowercase name, with no scheme or port. The declaration needs a `node` entry,
because only a running node half registers it. It also needs `projects:read`, or a grant that implies
it, in `permissions.node.core`: a code host's data sources get the paths of the projects on its hosts,
so the person consents to that in the trust prompt like any other project read. The registry is
`packages/node-core/src/server/pluginHost/codeHosts.ts`, and it empties when the plugin stops.

The provider is the plugin's own id, so two plugins can't declare the same provider. When two running
plugins claim one host, a built-in beats a loaded plugin, and between two of the same tier the lower
plugin id wins. Registration order never decides it, so an installed package can't take `github.com`
from GitHub by loading first or by outlasting a reload. The Node logs a warning for the losing claim.

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

## The GitHub-named fields

`ProjectRef.github`, the wire `Project.github` and `Task.github`, `byGithub`, the `github` and
`githubRepoId` inputs, and the `githubRepository` field of the local branches source predate the
facet. Each is now read off a `github.com` repository whose path is an owner and a name, so it stays
correct. The next plugin API major removes them. The checklist is in
[phase 5 of the split programme](../future/split/05-repository-identity.md).
