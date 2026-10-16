# GitLab integration

This page covers the GitLab plugin: connecting gitlab.com, importing projects, and working merge
requests as tasks. Read it before you change `plugins/gitlab/`. The plugin is a code host
([code hosts](./plugins/code-hosts.md)) built on the seams the GitHub plugin uses, and it draws its
review views from the [shared review views](./plugins/change-request-ui.md).

It serves gitlab.com only. A self-hosted GitLab server needs the runtime hosts that
[phase 6 of the GitLab programme](./future/github/06-self-hosted-hosts.md) adds.

## Connecting

The provider is `gitlab`, in `plugins/gitlab/src/server/provider.ts`, with one connection at a time.
There are two ways in:

- **Sign in with a code.** The device authorization grant, served by gitlab.com from GitLab 17.1, under
  `/v1/p/gitlab/auth/device/*` (`plugins/gitlab/src/server/routes/deviceAuth.ts`). It needs an OAuth
  application's client id in `GITLAB_CLIENT_ID`, with the device grant on and the `api` scope. Without
  one, Settings offers the token form alone.
- **A personal access token** with the `api` scope, typed into Settings under **Or use a token**.

A device sign-in's access token lasts two hours. The connection keeps its refresh token, and core
renews it before it expires and when GitLab refuses it ([tokens that
expire](./integrations/provider-boundaries.md#tokens-that-expire)). A refused renewal marks the
connection as needing sign-in. A personal access token is never renewed.

`gitlabSession` in `plugins/gitlab/src/server/gitlabApi.ts` is a route's credential, with the renewal
for a `401`. With no credential, every route answers `401 reauth`, so a disconnected GitLab serves
nothing from the mirror either.

## The mirror

The mirror is the plugin's own SQLite file (`plugins/gitlab/src/node/schema.ts`), scoped by owner:

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

The code host declaration in `plugins/gitlab/src/node/index.ts` claims `gitlab.com`, checks a merge
request out from `merge-requests/{number}/head`, names it with `!`, and opens the `mr` pane. A task is
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

## The client

The `gitlab` rail source lists a project's merge requests and draws one, and the `mr` pane draws a
task's, both from the shared views (`plugins/gitlab/src/client/`). A job's log is split into its
`section_start` sections as steps (`jobLog.ts`). **Open merge request** under the Changes tab opens
gitlab.com's own form for the branch. The importer lists every project by full path, with **Clone** and
**Link folder**.

The plugin opens `gitlab:diff-line` and `gitlab:summary-badges`, with the key shape every code host
uses, and registers the data sources `merge-requests`, `pipeline-jobs` with **Retry job**, and
`local-branches` with the relation to a branch's merge request.

## Limits

- gitlab.com only, one account at a time.
- No merge trains, auto-merge, issues, epics, or wikis.
- GitLab has no "changes requested" verdict, so the review decision is approved or none.
- The list's search narrows the loaded rows. It doesn't ask GitLab.
- Verified against a fake GitLab API (`plugins/gitlab/src/server/fakeGitlab.helper.ts`). A check
  against a real gitlab.com account needs a person with a login and a registered OAuth application.
