# GitHub integration

GitHub is a provider plugin, not the acorn authentication system. Its token is an encrypted
integration credential and its repositories/PRs are a disposable local mirror.

## Connecting

Settings → Integrations and the first-run wizard both run the OAuth device authorization flow through
the same `createDeviceFlow` helper in `packages/client-core/src/integrations/deviceFlow.ts`, so the
polling cadence (the advertised interval, `slow_down`, `expires_in`) is stated once:

1. `POST /v2/p/github/auth/device/start` asks GitHub for a device code.
2. The owner enters the user code at GitHub's verification URI.
3. `POST /v2/p/github/auth/device/poll` checks the provider at GitHub's requested interval.
4. On success the Node validates the token and stores it in an encrypted `integrations` row. The
   GitHub account is provider metadata; it does not bind the node-owner identity, which core mints at
   boot.

The optional GitHub plugin reads `GITHUB_CLIENT_ID`, uses no client secret, and needs no callback URL.
`githubToken(c)` is the single credential read site for GitHub routes.

Device flow wins over the redirect web flow for three reasons. The web flow needs a client secret to
exchange the code, and a secret shipped inside a distributed binary is recoverable; device flow
exchanges on `client_id` alone. The web flow needs a redirect URI, and the renderer has no
server-served origin to redirect back to, while a remote node would need its own registered callback
URL; device flow has neither problem, so a local node and a remote node run the same code path. The
web flow also needs a shell-owned auth window to intercept the redirect. The cost is one extra step
for the person connecting: they read a code and type it at `github.com/login/device`.

## Mirror

The GitHub plugin database contains repositories, pull requests, PR files, reviews, comments,
commits, review threads, labels, requested reviewers, checks, freshness, viewed files, and pinned
repositories. Provider reads are serve-then-revalidate and may use ETags. List refreshes replace
collections so inaccessible repositories/PRs disappear from the local projection.

Patch bodies and full file bodies use the Node's immutable on-disk blob cache. A blob miss fetches
from GitHub and stores the result by SHA. The cache is per Node and can hold private repository data.

## Reads and writes

The GitHub source provides repository browse, PR lists/detail, diff files, checks, Actions logs,
mentions, labels, reviewers, comments, review threads, and create-PR. Mutations call GitHub first and
then update or invalidate the affected mirror so a subsequent read does not serve a known pre-write
value.

The task-scoped `github_pull_create` agent tool shares the same create service as the interactive
route. It infers the head from the task branch, uses the requested base, and atomically attaches the
created PR through `CoreServices.tasks.attachPull`: the first attachment claims
`tasks.pull_number`, while later attachments become durable related rows with the managed session id.
Shelling out to `gh pr create` still has only branch-adoption semantics and does not gain agent
attribution.

The "my pull requests" collection filters by involvement (review-requested, assigned, authored) as a
live GitHub search rather than a mirror query. Assignees are never mirrored, and review requests only
mirror through the PR-detail sync, which runs only for PRs already in the mirror because this account
opened them. A mirror-side filter would parse and render, then answer nothing for the question the
person is asking. Each involvement value runs as its own search and the results are unioned, because
GitHub's search qualifiers only AND, and "assigned to me or waiting on my review" is two questions
however it is asked.

## Content links

GitHub declares two content-link recognisers (`plugins/github/src/client/contentLinks.ts`; the shared
recognition and destination ladder is in [plugins.md](./plugins.md) under Frame authoring and the UI
kit). A `github.com/<owner>/<repo>/pull/<n>` URL declares `providerId: 'github'`, so a click can open
the reference panel: a pull request is glance-sized enough to answer "what is this" without the reader
losing their place. A bare `github.com/<owner>/<repo>` URL declares no `providerId`, because a
repository is a list rather than a card, and its destination is the browse route.

Both recognisers resolve `owner/repo` to a tracked project by comparing case-insensitively. GitHub
treats an owner and a repo name as case-insensitive, but the two sides of that comparison come from
different places: a URL, and the plugin's own PR mirror, carry GitHub's canonical spelling (for
example `Runn-Fast`), while `projects.github_owner` is stored folded to lower case (`runn-fast`). An
`===` comparison here matched neither a dashboard row nor a PR link inside a rendered body, and it
failed silently, because an unresolved repo simply opens the real `github.com` URL instead of erroring.

## Importing projects

Projects → Import from GitHub discovers repositories from the plugin's disposable mirror. A
repository is either mapped to an existing folder or cloned with non-interactive Git. Both ask for
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

## Tasks and references

A PR can promote to a task. The task stores the core project ID and pull number; the project's GitHub
facet supplies provider owner/name metadata. Subsequent task context and changes use the owning Node.
The PR pane keeps that scalar PR as its primary and adds read-only tabs from three sources: durable
`task_pulls` relations, the connected base/head graph of the mirrored open-PR list, and PR links in
the primary description, comments, reviews, and threads. Stack and mention evidence is derived on
read, so retargeting a stack or editing out a link removes it without a cleanup migration. A linked
task destination wins over agent, mention, and stack destinations; an agent destination opens the
recorded managed session through the existing notice-target seam.

Selecting a related PR with no task shows `+ TASK` in the Navigator header. Promotion reuses the
repository-list workflow: the new task takes the matching core project, the PR head branch and pull
number, and any unambiguous Linear references from the PR body. If exactly one other active task
already owns that PR, the tab opens it instead; several owners keep the explicit task chooser.

Within a task PR body, another GitHub PR link is a `plugin:select` intent for the existing PR pane,
not a route change or reference-panel overlay. The selected tab changes what `PullDetail` and
`DiffView` read but never changes the current task's scalar primary, branch, or worktree. All GitHub writes,
including diff comments and thread actions, are omitted on a non-primary tab.

Linear reference panels are contributed through a provider contract, so the GitHub plugin does not
import Linear's implementation. Linear is a loaded plugin, so the panel it renders there is a
sandboxed frame whose overlay chrome the host draws. GitHub does depend on `@acorn/plugin-linear` for
two things in `contract/`: the ticket-reference text scanner and the query-options factory over
`/v2/p/linear/issues`. Both are the sanctioned cross-plugin surface, and neither reaches Linear's
UI.

## Actions and logs

Checks expose Actions run/job data. Job logs follow GitHub's signed redirect without forwarding the
GitHub bearer to the blob host. Rerun-failed-jobs is an explicit mutation and requires the provider
permission GitHub reports.
