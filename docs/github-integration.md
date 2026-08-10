# GitHub integration

GitHub is a provider plugin, not the acorn authentication system. Its token is an encrypted
integration credential and its repositories/PRs are a disposable local mirror.

## Connecting

Settings → Integrations and the first-run wizard both run the OAuth device authorization flow, through
the same `createDeviceFlow` helper in `packages/client-core/src/integrations/deviceFlow.ts` — the
polling cadence (the advertised interval, `slow_down`, `expires_in`) is stated once:

1. `POST /v2/p/github/auth/device/start` asks GitHub for a device code.
2. The owner enters the user code at GitHub's verification URI.
3. `POST /v2/p/github/auth/device/poll` checks the provider at GitHub's requested interval.
4. On success the Node validates the token and stores it in an encrypted `integrations` row. The
   GitHub account is provider metadata; it does not bind the node-owner identity, which core mints at
   boot.

The optional GitHub plugin reads `GITHUB_CLIENT_ID`, uses no client secret, and needs no callback URL.
`githubToken(c)` is the single credential read site for GitHub routes.

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

## Importing projects

Projects → Import from GitHub discovers repositories from the plugin's disposable mirror. A repository
is either mapped to an existing folder or cloned with non-interactive Git; both ask for the folder
before anything is written, so cancelling the dialog cancels the import. There is no third "defer"
action — not importing a repository is what deferring meant, and the path-null placeholder project it
created became a duplicate as soon as the same repository was mapped later.

For that reason an import that finds an existing **path-null** project for the repository fills that
one in rather than adding a second. A project that already has a path is a real checkout, and two
clones of one repository stay legal (`projects_github_idx` is deliberately non-unique).

The importer returns an individual result for every repository, so a failed clone does not hide
successful imports. The mirror remains disposable candidate data; project identity, checkout paths, and
default branches come from core project facets and services.

Closed PR lists are paginated live provider reads. Open lists, details, and files use the local mirror
with explicit force-refresh support. GraphQL errors and provider authorization failures are mapped to
the common API envelope and surfaced as GitHub-specific status where the UI needs it.

## Tasks and references

A PR can promote to a task. The task stores the core project ID and pull number; the project's GitHub
facet supplies provider owner/name metadata. Subsequent task context and changes use the owning Node.
Linear reference panels are contributed through a provider contract, so the GitHub plugin does not
import Linear's implementation.

## Actions and logs

Checks expose Actions run/job data. Job logs follow GitHub's signed redirect without forwarding the
GitHub bearer to the blob host. Rerun-failed-jobs is an explicit mutation and requires the provider
permission GitHub reports.
