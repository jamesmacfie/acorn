# GitHub integration

GitHub is a provider plugin, not the acorn authentication system. Its token is an encrypted
integration credential and its repositories/PRs are a disposable local mirror.

## Connecting

Settings → Integrations runs the OAuth device authorization flow:

1. `POST /v2/p/github/auth/device/start` asks GitHub for a device code.
2. The owner enters the user code at GitHub's verification URI.
3. `POST /v2/p/github/auth/device/poll` checks the provider at GitHub's requested interval.
4. On success the Node validates the token, stores it in an encrypted `integrations` row, and binds
   the active GitHub identity.

The flow uses `GITHUB_CLIENT_ID`, no client secret, and no callback URL. `githubToken(c)` is the
single credential read site for GitHub routes.

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

Closed PR lists are paginated live provider reads. Open lists, details, and files use the local mirror
with explicit force-refresh support. GraphQL errors and provider authorization failures are mapped to
the common API envelope and surfaced as GitHub-specific status where the UI needs it.

## Tasks and references

A PR can promote to a task. The task stores the repository and pull number; subsequent task context
and changes use the owning Node. Linear reference panels are contributed through a provider contract,
so the GitHub plugin does not import Linear's implementation.

## Actions and logs

Checks expose Actions run/job data. Job logs follow GitHub's signed redirect without forwarding the
GitHub bearer to the blob host. Rerun-failed-jobs is an explicit mutation and requires the provider
permission GitHub reports.
