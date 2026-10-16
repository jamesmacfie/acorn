# Phase 5: build a GitLab plugin for gitlab.com

## Completion note

October 17, 2026. Done, verified against a fake GitLab API only.

What landed:

- Refreshable connections. A connection's `normalize` may return `refresh`, core seals the refresh
  token in `integrations.encrypted_refresh_token` with the expiry in `credential_expires_at` (migration
  `0011`), and the connection contract gains `refresh(refreshToken)`. `freshConnection` in
  `packages/node-core/src/server/integrations/connections.ts` renews within five minutes of expiry for
  `providerCredential`, `withConnections`, and `withConnection`, and `refreshProviderCredential`, on
  the facade, renews on demand after a `401`. A backup blanks the refresh token. [Tokens that
  expire](../../integrations/provider-boundaries.md#tokens-that-expire) documents it.
- `{name+}` captures in `compileContentLinkPattern`, once per pattern and only right before a literal.
- `plugins/gitlab/`, a compiled plugin registered on the Node, the desktop, and the terminal client:
  the code host, the device flow and a personal access token, the mirror, the four change request
  routes, `gitlab:ci-settled` and `gitlab:review-received`, the three events, the data sources
  `merge-requests`, `pipeline-jobs` with **Retry job**, and `local-branches`, the browser handoff, the
  editor line markers, and the client: rail source, browse list and detail, `mr` pane, rail marker,
  reference panel, content links, importer, and push action. [GitLab
  integration](../../gitlab-integration.md) documents it.
- The browser handoff seed takes `changeRequest: { number }`, and the browser bridge finds a task that
  holds an item's change request by number, as it did a pull number.
- Settings shows a device-flow provider's fields, when it declares any, as **Or use a token**.
- The desktop's image policy allows `gitlab.com` and `secure.gravatar.com` for GitLab avatars
  (docs/shell/origins.md).
- Shared with GitHub rather than copied: GitHub's blob-backed diff document store moved to
  `@acorn/diff-document/store`, and its line-marker comparison to `changeRequestLineMarkers` in
  `plugins/editor/src/contract/lineMarkers.ts`.

Decisions and deviations:

- `GITLAB_CLIENT_ID` has no default. Acorn's gitlab.com OAuth application still needs registering,
  with the device authorization grant on and the `api` scope. Without the variable, the provider
  offers the token form alone.
- A route renews on a `401` through `gitlabSession` and retries once. A background read, such as a
  policy poll, gets the five-minute renewal only, and a `401` there fails that poll as `reauth`. One
  renewal runs at a time per connection, in process. A refused renewal marks the connection
  `needs-auth`, and nothing renews it again until the person signs in, the rule MCP sign-in also takes.
- GitLab's routes answer the shared model directly, so the client maps nothing. Detail and files are
  two resources: detail is one GraphQL request, files are REST with their patches in the blob cache.
  A background reader refreshes the detail alone, because it has no blob cache to write to.
- A GitLab task links its merge request's page under the GitLab connection, so the extension finds
  the task from the merge request's address with no change to `taskPages`.
- GitLab approvals have no time, so the mirror takes it from the approval's system note.
- Job statuses map onto the check vocabulary: `failed` is `failure`, `running` is `in_progress`,
  `manual` is `skipped`, and a failed job allowed to fail is `neutral`.
- The editor's line marker kinds are `pull-request` and `uncommitted`, so GitLab marks a merge
  request's changed lines as GitHub does, not its discussion lines.
- **Open merge request** opens gitlab.com's own form for the branch. No create form was extracted.
- The `mr` pane's chord is ⌘⇧M, because every pane chord must be unique and ⌘⇧R is GitHub's.
- The closed tab reads one page of 50 closed and 50 merged merge requests live. The list's search
  narrows the loaded rows and doesn't ask GitLab. Tab and filter aren't persisted.
- Left out, for a later change if someone asks: a strip of related merge requests, Linear task links
  from a merge request's description, viewed-file marks, an extension sidebar panel, and API telemetry
  spans.
- The Node half loads everything past its declarations on first use, to keep the service's static
  graph small. It adds 13,109 B (1,896,362 B against 1,883,253 B at the phase 4 commit). The base was
  already 50,453 B over the 1,832,800 B ceiling in `apps/node/scripts/check-service-budget.mjs`, so
  the ceiling isn't raised here.
- 200 open merge requests read in two GraphQL requests against the fake (`projectRoutes.test.ts`). A
  real project's timing is unmeasured.
- `packages/plugin-api/src/surface.snapshot.txt` gained `refreshProviderCredential` and phase 3's
  missing `mirrorFootprintCapability`. The `apps/node` and desktop goldens gained only GitLab's lines.

For later phases:

- Phase 6: gitlab.com is fixed in `GITLAB_ORIGIN` and `GITLAB_HOST` in
  `plugins/gitlab/src/server/config.ts`, the handoff patterns in `plugins/gitlab/src/node/index.ts`, the
  content link patterns in `plugins/gitlab/src/shared/mergeRequestRef.ts`, and the image policy.
  `maxConnections` is 1.
- Phase 7: GitLab checks a fork's merge request out from `merge-requests/{number}/head` already.
- A real-account check needs a gitlab.com login and the registered OAuth application.
- Already red at the base and untouched: the `pluginDisable` and `routeRegistry` goldens in
  `apps/node` (the browser-panel and agents MCP routes), knip's `proposalChanges`, three `docPaths`
  entries for `dist` files, the Node service budget, and three site unit tests (`ACORN_BUILD`,
  `meta+shift+j`, and the bundled `database` plugin).

Date: October 16, 2026. Status: proposed. Depends on phases [1](./01-change-request-agent-context.md),
[2](./02-workflow-ci-by-provider.md), and [3](./03-github-assumptions-outside-the-plugin.md). Runs
alongside [phase 4](./04-shared-change-request-ui.md).

## Goal

A person who keeps code on gitlab.com connects GitLab, imports projects, and works merge requests as
tasks, with the views, agent context, workflow gates, and browser button a GitHub user has.

## Starting point

There's no GitLab plugin. The `gitlab-test` fixture in
`packages/node-core/src/server/core/tasks.test.ts` proves the code host and change request contract,
and the phases before this one remove the GitHub assumptions around it. Two core gaps remain, and
this phase closes them first.

GitLab merge requests map onto the GitHub plugin's features like this:

| GitHub plugin | GitLab | Gap |
| --- | --- | --- |
| Device-flow connect | Device authorization grant, in GitLab 17.1 and later | Access tokens expire after two hours, so the connection must refresh |
| `pull/{number}/head` | `merge-requests/{number}/head` | None. Forks check out by ref |
| Repository mirror | Projects the person is a member of | Paths nest groups to any depth |
| Pull request mirror | Merge requests, diffs, approvals, discussions, labels, reviewers | Threads carry a position with base, start, and head commits instead of a line and side |
| Checks | The head pipeline's jobs | None |
| `actions-jobs` source with **Re-run job** | Pipeline jobs, with job retry | None |
| Review decision | Approvals, and approval rules on paid tiers | No "changes requested" state |
| Team review requests | Reviewers are people only | Leave the team field empty |
| `review-requested:@me` | `reviewer_username` on the merge request list | None |
| Browser button on a pull request page | `/{group path}/-/merge_requests/{number}` | The handoff and content link grammar has single-segment captures only |

## Core changes this phase needs

1. **Refreshable connections.** Provider connections in
   `packages/node-core/src/server/integrations/` store one secret and never refresh it. GitHub's OAuth
   app tokens don't expire, so nothing needed it. Add an optional refresh step to a connection
   descriptor: the provider stores a refresh token beside the secret, and the host refreshes before
   expiry and on a `401`, then writes both tokens back under the same encryption. A refresh that's
   refused marks the connection as needing sign-in. [MCP sign-in](../mcp-sign-in.md) needs the same
   rotation rules, so agree one design between the two.
2. **Multi-segment captures.** `compileContentLinkPattern` in
   `packages/protocol/src/content/contentLinkPattern.ts` takes literal and `{capture}` segments. Add
   `{name+}`, one or more segments, allowed once per pattern and only before a literal, so
   `https://gitlab.com/{path+}/-/merge_requests/{number}` matches `group/sub/api`. Matching stays
   linear, because the literal after it bounds the capture. Browser handoffs and content links both
   compile through this function.

## The plugin

Build it as a built-in compiled plugin in `plugins/gitlab/` (new folder), shaped like
`plugins/github/`, and register it in `apps/node/src/composition/plugins.ts`,
`apps/desktop/src/client/plugins.ts`, and `apps/tui/src/roster.ts`. Compiled rather than loaded,
because it draws Solid views from the phase 4 package and serves Hono routes, as GitHub does.

Contribute these, in this order:

1. `codeHost` with `hosts: ['gitlab.com']` and `changeRequest` of `merge-requests/{number}/head`,
   `merge request`, `!`, pane `mr`, and the phase 1 `api`.
2. The connection: device flow with acorn's own gitlab.com OAuth application, and a personal access
   token form as the second way in. Read the client id from `GITLAB_CLIENT_ID`, as GitHub reads
   `GITHUB_CLIENT_ID`. Scope `api`, because the plugin writes comments and creates merge requests.
3. Its mirror database: projects, merge requests, files, approvals, discussions, labels, reviewers,
   and jobs. Use GraphQL for the list and detail reads, which return nested approvals and pipelines in
   one request, and REST for diffs and job logs.
4. The phase 1 routes and the phase 2 policies `ci-settled` and `review-received`, and the
   `checks-changed`, `pr-synced`, and `pulls-changed` events.
5. Data sources `gitlab/merge-requests`, `gitlab/pipeline-jobs` with **Retry job**, and branches with
   merge requests, delegating to core's local branches source as GitHub's does.
6. Client: the browse source, project importer, `mr` pane, rail marker, push action "Open merge
   request", ref panel, and content links, with views from the phase 4 package. Its `taskPath` and
   `tracksRef` read `task.changeRequest` and `task.repository`, not `pullNumber` and `github`.
7. The browser handoff and task addresses for merge request pages, and editor line markers for open
   discussions.

## Out of scope

Self-hosted GitLab, which [phase 6](./06-self-hosted-hosts.md) adds. Epics, issues, and wikis.
GitLab's merge trains and merge-when-pipeline-succeeds, until someone asks.

## Acceptance

- Connect gitlab.com with the device flow and with a token. Disconnect, and the mirror stops reading.
- An access token past its two hours refreshes with no prompt. A revoked refresh token marks the
  connection as needing sign-in.
- Import a project in a nested group, open one of its merge requests as a task, and land on `mr` with
  the worktree on `merge-requests/{n}/head`. Repeat for a merge request from a fork.
- `pr_current`, `pr_checks`, `pr_review_comments`, and `pr_create` answer on that task. A workflow
  with `checks-green` waits for its pipeline.
- The browser button appears on the merge request page and opens the task.
- Run every check against a fake GitLab API, as `plugins/github/src/server/routes/mirror/fakeGithub.helper.ts`
  fakes GitHub's. The real-account check needs a person with a gitlab.com login.

## Risks

GitLab's API is larger and slower than GitHub's search for the same data. Keep the mirror's batch
sizes and budgets in the plugin's provider descriptor, and measure a 200-merge-request project before
the list ships.
