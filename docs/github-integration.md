# GitHub integration

The GitHub plugin connects a GitHub account, mirrors repositories and pull requests, and draws the pull
request views. It's a provider plugin, not acorn's authentication: its token is an encrypted
integration credential, and its repositories and pull requests are a disposable local mirror. Read this
page for connecting, importing, the typed pull request source, and the topic pages. The plugin is in
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
non-interactive Git. Both ask for
the folder before anything is written, so cancelling the dialog cancels the import. There is no third
"defer" action: skipping the repository is what deferring meant, and the path-null placeholder
project it created turned into a duplicate as soon as the same repository was mapped.

So an import that finds a path-null project for the repository fills that one in rather than adding a
second. A project that already has a path is a real checkout, and two clones of one repository stay
legal (`projects_github_idx` is deliberately non-unique).

The importer returns an individual result for every repository, so a failed clone does not hide
successful imports. The mirror remains disposable candidate data; project identity, checkout paths, and
default branches come from core project facets and services.

Closed PR lists are paginated live provider reads. Open lists, details, and files use the local mirror
with explicit force-refresh support. GraphQL errors and provider authorization failures are mapped to
the common API envelope and surfaced as GitHub-specific status where the UI needs it.

## Typed pull-request source

The `github/pull-requests` [data source](./data-sources.md) requires an explicit GitHub connection
and `parameters.repository` in `owner/name` form. Repository options enumerate repositories available
through that connection, with continuation cursors. Option search filters each returned page; an empty
page with a cursor is not exhaustion.

Records use GitHub node IDs for identity. Actual `state` is `open`, `closed`, or `merged`; `closed`
means closed without merging. Draft, mergeability, merge readiness, and auto-merge remain separate
fields. Author login is nullable, and timestamps use epoch milliseconds. Row URLs retain the
content-link action that opens a tracked pull request inside Acorn.

Queries support equality on state, author login, and draft, ordered comparisons on created/updated
time, and `all` groups. Number, created time, and updated time support sorting. The provider search
narrows candidates, then exact typed comparisons run over the exhausted selection. Author equality
uses the returned login's case. Repository and author values cannot inject search qualifiers.

The adapter reads at most 10 pages of 100 search matches. A provider count above 1,000 or continuation
past that limit returns `incomplete`, including when the query requests a smaller `take`. Stable
sorting uses node ID to break ties before applying `take`. This source advertises neither details
nor incremental checkpoints. Search consistency remains subject to GitHub's indexing and concurrent
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

## Actions and logs

Checks expose Actions run/job data. Job logs follow GitHub's signed redirect without forwarding the
GitHub bearer to the blob host. Rerun-failed-jobs is an explicit mutation and requires the provider
permission GitHub reports.

A check row with a run behind it opens that run's steps in a modal: failed steps start open, and the
first one opened fetches the whole job log once and slices every step out of it.

## Pages

<a id="mirror"></a>
<a id="pull-request-detail-and-files"></a>
<a id="diff-documents"></a>

- [The GitHub mirror](./github-integration/mirror.md): the mirror, pull request detail and files, and
  diff documents.

<a id="reads-and-writes"></a>

- [Reads and writes](./github-integration/reads-and-writes.md): editor markers, mutations, and
  `github_pull_create`.

<a id="tasks-and-references"></a>
<a id="content-links"></a>

- [Tasks and references](./github-integration/tasks-and-references.md): promotion, the pull strip,
  and content links.

<a id="surfaces"></a>
<a id="conversation"></a>

- [GitHub surfaces](./github-integration/surfaces.md): pane arrangement and the conversation.

<a id="from-the-command-palette"></a>

- [From the command palette](./github-integration/palette.md): GitHub's commands.
