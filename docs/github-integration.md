# GitHub integration

The GitHub plugin connects a GitHub account, mirrors repositories and pull requests, and draws the pull
request views. It's a provider plugin, not acorn's authentication: its token is an encrypted
integration credential, and its repositories and pull requests are a disposable local mirror. Read this
page for connecting, importing, the typed pull request and issue sources, and the topic pages. The plugin is in
`plugins/github/`.

## Connecting

Settings' Add connection and the first-run wizard both run the OAuth device authorization flow through
the same `createDeviceFlow` helper in `packages/client-core/src/features/integrations/deviceFlow.ts`, so the
polling cadence (the advertised interval, `slow_down`, `expires_in`) is stated once:

1. `POST /v1/p/github/auth/device/start` asks GitHub for a device code.
2. The owner enters the user code at GitHub's verification URI.
3. `POST /v1/p/github/auth/device/poll` checks the provider at GitHub's requested interval.
4. On success the Node validates the token and stores it in an encrypted `integrations` row. The
   GitHub account is provider metadata; it does not bind the node-owner identity, which core mints at
   boot.

The optional GitHub plugin defaults to acorn's public client ID, `Ov23liRC5Y5yDF7BTSeg`, so
**Connect GitHub** appears in Add connection and first-run setup without environment configuration.
Set `GITHUB_CLIENT_ID` to use your own GitHub app, and enable **Device Flow** in that app's settings.
The plugin trims the override. An empty or whitespace-only override reports `connectable: false`
and hides GitHub from those connection surfaces. A connection stored earlier keeps working.
The device grant uses no client secret or callback URL.
`githubToken(c)` is the single credential read site for GitHub routes.

Device flow wins over the redirect web flow for three reasons. The web flow needs a client secret to
exchange the code, and a secret shipped inside a distributed binary is recoverable; device flow
exchanges on `client_id` alone. The web flow needs a redirect URI, and the renderer has no
server-served origin to redirect back to, while a remote node would need its own registered callback
URL; device flow has neither problem, so a local node and a remote node run the same code path. The
web flow also needs a shell-owned auth window to intercept the redirect. The cost is one extra step
for the person connecting: they read a code and type it at `github.com/login/device`.

## Importing projects

`POST /v1/p/github/import` requires a paired device because importing creates or repoints a core
project and can clone into an owner-selected folder. Task and service credentials receive
`403 interactive_user_required` before body parsing, mirror reads, or Git and project operations.
This gate does not change the authority of other GitHub provider routes.

Projects → Import from GitHub discovers repositories from the plugin's disposable mirror. A
repository is either linked to an existing folder (**Link folder**, the `map` action) or cloned with
non-interactive Git. Both ask for the folder before anything is written, so cancelling the dialog
cancels the import. Where the dialog can't browse the Node's disk, both open a folder field in the
row ([Projects](./workspaces-and-tasks/projects.md)), and the route refuses a missing clone folder by
name. There is no third "defer" action: skipping the repository is what deferring meant.

An import that finds a path-null project for the repository fills that one in rather than adding a
second. A project that already has a path is a real checkout, and two clones of one repository stay
legal (`projects_github_idx` is deliberately non-unique).

The importer returns an individual result for every repository, so a failed clone does not hide
successful imports. The mirror remains disposable candidate data; project identity, checkout paths, and
default branches come from core project facets and services.

Closed PR lists are paginated live provider reads. Open lists, details, and files use the local mirror
with explicit force-refresh support. GraphQL errors and provider authorization failures are mapped to
the common API envelope and surfaced as GitHub-specific status where the UI needs it.

## Typed pull-request source

The `github/pull-requests` [data source](./data-sources.md) requires an explicit GitHub connection.
Its optional `parameters.repositories` list contains `owner/name` values; omitting it searches every
repository visible to that account. Repository options enumerate repositories available
through that connection, with continuation cursors. GitHub can't filter that list by name, so a
search reads up to 10 pages until it fills one page of matches. A search that ends with a cursor
and too few matches isn't exhaustive.

Records use GitHub node IDs for identity. Actual `state` is `open`, `closed`, or `merged`; `closed`
means closed without merging. Draft, mergeability, merge readiness, and auto-merge remain separate
fields. Author login is nullable, and timestamps use epoch milliseconds. Row URLs retain the
content-link action that opens a tracked pull request inside Acorn.

The source also reports review decision, head-check rollup and individual outcomes, requested users
and teams with request times, labels, last commit/comment/review activity, and GitHub merge readiness.
`lastActivityAt` starts at PR creation and advances on commits, comments, or reviews; a label-only
`updatedAt` change does not advance it. Each record also identifies the head repository and head
branch separately from the base `repository`. A deleted fork has an unknown head repository.
Its identity operation supplies the selected account's login for **You**. A review-requested-from-you
filter uses GitHub's native `review-requested:@me` search, including team requests. The mirror stores
team requests as well as user requests. GitHub search and nested connections have provider caps; an
exceeded cap yields an incomplete selection.

Choose **Local branches with pull requests** and the same GitHub account as the pull-request source
to look up a PR for each branch. This GitHub source delegates workspace and project scoped reads to
the core local-branches source. Core reads each branch's tracked GitHub remote, or origin when the
branch has no upstream, using the project repository-facet parser.
The lookup matches provider, connection, head repository,
and exact branch name; it never equates a
fork's branch with a same-named branch in the base repository. A branch without a PR stays in the
panel. Two PRs with the same head repository and branch trigger a cardinality warning and leave the
lookup empty rather than selecting one arbitrarily. This relationship reads PRs under the selected
connection's normal authority and does not use the GitHub mirror as a branch authority.

`github/actions-jobs` reads workflow jobs across a selected repository list. Each record carries its
repository, run, attempt, start and finish, duration, conclusion, and linked pull-request numbers.
The source declares event coverage matching GitHub's Actions retention and reports the actual lower
bound of a read. Its bounded REST scan reports incomplete when a page, run, or attempt cap is hit;
GitHub supplies no durable cursor suitable for incremental source continuation.
Completed job rows offer **Re-run job**. The Node rechecks named-action eligibility at press time;
the GitHub source route then reads the current job, verifies the selected connection and repository,
and calls GitHub's job rerun endpoint. A job that disappeared or resumed is refused, and the host
requires confirmation for the execute risk. The action runs through the same device-scoped
idempotency middleware as other dashboard actions.

Queries support equality on state, author login, and draft, ordered comparisons on created/updated
time, and `all` groups. Number, created time, and updated time support sorting. The provider search
narrows candidates, then exact typed comparisons run over the exhausted selection. Author equality
uses the returned login's case. Repository and author values cannot inject search qualifiers.

The adapter reads at most 10 pages of 25 search matches. Each match carries checks, reviews, and
timeline events, so GitHub times out on a page of 100. A provider count above 250 or continuation
past that limit returns `incomplete`, including when the query requests a smaller `take`. The first
page carries the count, so a search that's too broad fails in one round trip. Stable
sorting uses node ID to break ties before applying `take`. This source advertises fresh state details
for write eligibility, but no incremental checkpoints. Search consistency remains subject to GitHub's indexing and concurrent
changes during pagination.

Continuation selections expire after 60 seconds. The plugin holds at most 16 selections and 16 MiB
across them, bound to owner, connection, full scope/query, evaluation time, and mode. Invalid or expired
cursors fail; callers must refresh. Connection and principal checks also apply to cached continuation
reads. Credentials stay inside the provider callback, and cancellation reaches the GitHub request.

Provider APIs were checked on September 13, 2026 against GitHub's
[search schema](https://docs.github.com/en/graphql/reference/search),
[pull-request schema](https://docs.github.com/en/graphql/reference/pulls),
[user repository connection](https://docs.github.com/en/graphql/reference/users), and
[search qualifiers](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests).

## Typed issue source

`github/issues` has one record per issue, scoped like the pull-request source: an explicit GitHub
connection, an optional `parameters.repositories` list, and the same repository options. It searches
with `is:issue` and skips any pull request GitHub still returns. A record carries title, number,
repository, `state` (`open` or `closed`), `closeReason` (`completed`, `not_planned`, `duplicate`, or
null), author, assignees, labels, milestone, comment count, created, updated, and closed times, and
the URL. It has no body. Acorn has no issue view, so pressing a row opens the issue on GitHub.

Queries narrow GitHub's search on state, author, an assignee, a label, and created, updated, or
closed time, then check each value exactly. A label with a quote or backslash isn't sent to the
search. Assignees match the selected account's login for **You**. The source reads up to 10 pages of
100, which is GitHub's 1,000-match search limit. A larger search, an issue with more than 100 labels
or assignees, or a read past the 16 MiB budget returns no rows and says it's incomplete. Continuation
works the same way as the pull-request source. Its starters list open issues by label, issues opened
and closed per week, and open issues assigned to you.

## Actions and logs

Checks expose Actions run/job data. Job logs follow GitHub's signed redirect without forwarding the
GitHub bearer to the blob host. Rerun-failed-jobs is an explicit mutation and requires the provider
permission GitHub reports.

A check row with a run behind it opens that run's steps in a modal: failed steps start open, and the
first one opened fetches the whole job log once and slices every step out of it.

## Browser panel

GitHub declares the browser extension's **Pull request** panel as `browserPanel` on its compiled
plugin. `GET /v1/p/github/browser-panel?taskId=<id>`, in `plugins/github/src/server/browserPanel.ts`,
answers device callers only. It answers 404 for a task with no `pullNumber` or a project with no
GitHub repository, so that task shows no nav item. With no GitHub connection, it answers one status
block that says to connect in **Settings** > **Services**.

Otherwise it reads the pull request through `readPullDetail`, the PR pane's composite read, and
`pullPanelView` turns the detail into up to four blocks, leaving out an empty one:

- A status block with the state, the title, the branches, what blocks the merge, unresolved review
  threads, and auto-merge. Conflicts or a failed check make it `danger`, a running check `pending`,
  and a change request `warn`. A merged or closed pull request is always `info`.
- **Checks**: failed checks first, then running ones, then the rest, at most 64. The failure and
  pending rules are `checkFailed` and `checkPending`, the ones the CI policy and `pr_checks` use.
- **Reviews**: each reviewer's latest submitted review, then each requested reviewer who hasn't
  reviewed. A comment after a change request leaves the change request standing.
- **Links**: the pull request, its checks tab, and each failed check's page.

The extension never polls. When the read starts a background refresh, the refresh's `pr-synced`
also calls `ctx.events.status()`, which makes an open panel read again. That read finds the mirror
fresh and starts no refresh. The panel takes no actions: **Open in Acorn** opens the task's `pr`
pane.

## Pages

- [The GitHub mirror](./github-integration/mirror.md): the mirror, pull request detail and files, and
  diff documents.

- [Reads and writes](./github-integration/reads-and-writes.md): editor markers, mutations, and
  `github_pull_create`.

- [Tasks and references](./github-integration/tasks-and-references.md): promotion, the pull strip,
  and content links.

- [GitHub surfaces](./github-integration/surfaces.md): pane arrangement and the conversation.

- [Review comments](./github-integration/review-comments.md): the review comment data source.

- [From the command palette](./github-integration/palette.md): GitHub's commands.
