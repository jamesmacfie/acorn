# GitLab integration

This page covers the GitLab plugin: connecting gitlab.com or a company GitLab server, importing
projects, and working merge requests as tasks. Read it before you change `plugins/gitlab/`. The plugin is a code host
([code hosts](./plugins/code-hosts.md)) built on the seams the GitHub plugin uses, and it draws its
review views from the [shared review views](./plugins/change-request-ui.md).

## Connecting

The provider is `gitlab`, in `plugins/gitlab/src/server/provider.ts`. Each connection is one account on
one server, up to eight. There are two ways in:

- **Sign in with a code.** The device authorization grant, served by gitlab.com from GitLab 17.1, under
  `/v1/p/gitlab/auth/device/*` (`plugins/gitlab/src/server/routes/deviceAuth.ts`). It needs an OAuth
  application's client id in `GITLAB_CLIENT_ID`, with the device grant on and the `api` scope. Without
  one, Settings offers the token form alone.
- **A personal access token** with the `api` scope, typed into Settings under **Or use a token**. With
  a **GitLab address**, the token signs in to that server instead of gitlab.com.

A device sign-in's access token lasts two hours. The connection keeps its refresh token, and core
renews it before it expires and when GitLab refuses it ([tokens that
expire](./integrations/provider-boundaries.md#tokens-that-expire)). A refused renewal marks the
connection as needing sign-in. A personal access token is never renewed.

`gitlabSession` in `plugins/gitlab/src/server/gitlabApi.ts` is a route's credential for one server,
with the renewal for a `401`. With no connection to the server a route names, the route answers
`401 reauth`, so a disconnected server serves nothing from the mirror either.

## Company servers

A company server signs in with a personal access token and its address, such as
`https://gitlab.example.com`. The address must be `https` with no path, port, or sign-in, because the
browser button and the host claim match a page by its host alone. A loopback or private address, such
as `https://10.0.0.5`, also needs **Connect to a private address** ticked. The check reads the literal
address only, so a name that resolves to a private address passes. `gitlabOrigin` in
`plugins/gitlab/src/server/servers.ts` holds these rules, and the connection's config keeps the
address as `baseUrl`. A connection with no address, a device sign-in included, is gitlab.com's.

The device flow stays on gitlab.com. A company server would need its own OAuth application, which
Acorn can't register for the person.

`createGitlabServers` in `servers.ts` keeps one server per host in memory, rebuilt from the connections
at init and on every `connection:changed` for `gitlab`. The oldest connection to a host serves it, and
a second one to the same server is never used. The plugin declares `selfHosted` and claims each
company server's host through `ctx.codeHosts.claim`, so its projects get provider `gitlab`
([hosts claimed at runtime](./plugins/self-hosted-code-hosts.md)). Disconnecting a server
releases its host and drops its mirror rows. Its projects keep their stored provider and their tasks.

Every call goes to the server's own address, through the session's `origin`. Root-relative links and
avatars in GitLab's answers are made absolute against it.

## The mirror

The mirror is the plugin's own SQLite file (`plugins/gitlab/src/node/schema.ts`), scoped by
connection, because two servers number their projects independently:

| Table | Holds |
| --- | --- |
| `projects` | The projects the person is a member of, by full path, which nests groups to any depth |
| `merge_requests` | The open list, and each merge request's detail once it is read |
| `mr_files` | Changed files, with each patch's digest in the blob cache |
| `mr_people`, `mr_labels`, `notes`, `mr_commits`, `jobs` | Approvers and reviewers, labels, non-system notes, commits, and the head pipeline's jobs |
| `sync_state` | When each resource was read, and the revision a diff was cut at |

A merge request is two resources. Its detail is one GraphQL request, with its approvals, reviewers,
discussions, and head pipeline (`plugins/gitlab/src/server/mirror/detail.ts`). Its files come from
REST, with their patches cut into a diff document by `@acorn/diff-document/store`. A reader is served
the mirror inside 45 seconds, served it stale while a refresh runs after that, and blocks on GitLab
when the mirror has none. A write route reads the detail again before it answers.

GitLab approvals carry no time. The approval's system note does, so the mirror keeps it on the
approver row, which is how `review-received` counts an approval after the wait began.

The budgets are in the provider descriptor: five pages of 100 for a list, five pages of discussions,
and ten pages of diff files. Past them the list stops and the file list says so. 200 open merge
requests are two GraphQL requests (`projectRoutes.test.ts`).

## Merge requests as tasks

The code host declaration in `plugins/gitlab/src/node/index.ts` claims `gitlab.com` and each connected
company server, checks a merge request out from `merge-requests/{number}/head`, names it with `!`, and opens the `mr` pane. A task is
made from the merge request list, the reference panel, or the browser button. Each task's primary
change request is the merge request, and the task links its page, so the browser extension finds the
task from the merge request's address. Refreshing a project's open list adopts a merge request into
every task on its source branch.

Core's agent tools read it through `/v1/p/gitlab/change-requests`, and the workflow names
`checks-green`, `ci-loop`, and `review-received` ask `gitlab:ci-settled` and `gitlab:review-received`
(`plugins/gitlab/src/server/workflowPolicies.ts`).

GitLab's words map onto the shared model in `plugins/gitlab/src/server/mirror/vocabulary.ts`. A failed
job is `failure`, a running one `in_progress`, a manual one `skipped`, and one allowed to fail
`neutral`. A diff discussion is a thread, placed by its first positioned note, and outdated when that
note was written against an older head.

## Addresses and routes

A project is named by its address, its server's host and its path, such as
`gitlab.example.com/group/api`, because two servers can hold the same path. A merge request is
`gitlab.example.com/group/api!3`, in task links, source rows, and the reference panel.
`plugins/gitlab/src/shared/mergeRequestRef.ts` builds and parses both. The project routes are
`/v1/p/gitlab/projects/:host/:path/...`, and `GET /v1/p/gitlab/servers` lists each server's host and
connection, which the client uses to link a new task under the right connection.

The browser handoff's patterns name `{codeHost}`, so the button appears on every server the plugin
holds once the person grants the extension that site. A content link to a merge request opens in
Acorn on gitlab.com and on a server that a tracked project is on.

## The client

The `gitlab` rail source lists a project's merge requests and draws one, and the `mr` pane draws a
task's, both from the shared views (`plugins/gitlab/src/client/`). A job's log is split into its
`section_start` sections as steps (`jobLog.ts`). **Open merge request** under the Changes tab opens
the server's own form for the branch. The importer lists every server's projects by address, with
**Clone** and **Link folder**.

The plugin opens `gitlab:diff-line` and `gitlab:summary-badges`, with the key shape every code host
uses, and registers the data sources `merge-requests`, `pipeline-jobs` with **Retry job**, and
`local-branches` with the relation to a branch's merge request.

## Limits

- One account per server. A second connection to a server is never used.
- A company server's device sign-in, a server under a path or on a port, and an IP version 6 address
  aren't supported.
- The desktop's image policy allows avatars from gitlab.com only, so it doesn't load a company
  server's avatars.
- Core finds a project and adopts merge requests by provider and path, so two servers holding the same
  path can be confused there.
- No merge trains, auto-merge, issues, epics, or wikis.
- GitLab has no "changes requested" verdict, so the review decision is approved or none.
- The list's search narrows the loaded rows. It doesn't ask GitLab.
- Verified against a fake GitLab API (`plugins/gitlab/src/server/fakeGitlab.helper.ts`), served at
  gitlab.com or at a company address (`selfHosted.test.ts`). A check against a real gitlab.com account
  needs a person with a login and a registered OAuth application, and one against a company server
  needs that server.
