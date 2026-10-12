# The GitHub mirror

The GitHub plugin keeps a local, disposable mirror of repositories and pull requests, so reads are fast
and agents can read review state without a network call. This page covers what the mirror holds, how a
pull request's detail and files are fetched, the diff document the viewer reads, and the checks and
reviews the workflow policies read. The code is in
`plugins/github/src/server/routes/mirror/`.

## Mirror

The GitHub plugin database contains repositories, pull requests, PR files, reviews, comments,
commits, review threads, labels, requested reviewers, checks, freshness, viewed files, and pinned
repositories. Provider reads are serve-then-revalidate and may use ETags. List refreshes replace
collections so inaccessible repositories/PRs disappear from the local projection.

`plugin:github:repos-changed` announces a completed full repository-list replacement or a repository
inserted by a live lookup after a mirror miss. A `304 Not Modified` response updates only freshness
and does not send the event. Node-side plugins can use the user-scoped `github.mirror` capability to
list the same repository inventory without calling GitHub.

Patch bodies and full file bodies use the Node's immutable on-disk blob cache. A patch body is keyed
by a SHA-256 digest of its own text. A full file body is keyed by its blob SHA. A blob miss fetches
from GitHub and stores the result. The cache is per Node and can hold private repository data.

## Pull request detail and files

A pull request's mirror is two resources, each with its own `sync_state` row: the detail
(`pr:<repoId>:<number>`) and the files (`files:<repoId>:<number>`). Both are fetched in full before
anything is written, in `plugins/github/src/server/routes/mirror/prFetch.ts`, and swapped in by
`prMirror.ts` in one `db.batch` with their sync row. A failure on any page leaves the previous rows,
the stored completeness, and `fetched_at` exactly as they were, and the route serves the old mirror
stale or, cold, reports the provider failure.

The detail is one GraphQL query for the scalars and the first page of every connection, then cursor
continuations through `node(id:)` until each connection is exhausted. The connections are labels,
reviews, review requests, issue comments, commits, review threads, each thread's comments, and the
latest commit's status and check contexts. Every page asks for 100 nodes and `pageInfo`. One walker
handles every connection. It fails on a page of the wrong shape, a node with no identity, or a
repeated or missing cursor while `hasNextPage` is true. It keeps a node that appears on two pages
once, where it first appeared. Thread comments continue four threads at a time. A GraphQL response
with `errors` is a failed refresh even when it carries partial data. There is no batch-only query:
the batch route refreshes each stale pull through the same helper, three at a time, because a
multi-alias query would stop at each connection's first page.

One gap in that honesty is not closed. GitHub's REST endpoint lists at most 250 commits for a pull,
and whether the GraphQL `commits` connection stops there too, with `hasNextPage` false, is not
confirmed. If it does, the walker takes the first 250 as the whole list, because it compares the
walked list against nothing. The fix is to ask for the connection's `totalCount` and carry a
shortfall to the conversation, which needs a mirror column; the checks would also have to be read
from `headRefOid` rather than `commits(last: 1)`, which would then name the 250th commit.

The files come from the REST files endpoint, 100 a page, in order. The walk stops at a short page, at
a full page with no `rel="next"` link, or after page 30, which is GitHub's 3,000-file ceiling. After a
full page 30 the plugin reads the pull's `changed_files`. If that is more than 3,000, or GitHub gives
no count, the resource is stored as incomplete with cause `upstream-cap`; 3,000 of 3,000 is complete.
A repeated path or a malformed page fails the refresh. Nothing works around the ceiling with a clone
or an archive download.

Every mirrored child row has a `position`, its zero-based place in GitHub's order, and every read
orders by it. File rows carry a patch state. `available` means `patch_key` names a body in the blob
cache. `unavailable` means GitHub sent no patch, which happens for binary files, very large diffs,
and pure renames. Patch bodies are written, eight at a time, before the swap; an orphaned body is
only cache data. A read that finds an available body missing is an integrity failure, not a file
without a diff: the files route treats the mirror as cold and blocks on a refresh that rewrites it.

The client states what the files route reports. When the list is capped, the diff and the PR's file
list both show a warning above the files, with GitHub's count when it gave one. File counts are the
files received.

## Diff documents

The diff viewer reads a pull request as a document ([diff-rendering.md](../diff-rendering/document.md) § The
document), not as patches. When the files mirror writes a patch body, it also cuts the patch into
segments with `@acorn/diff-document` and writes the segment descriptors as a small blob beside it,
`diffdoc:v<version>:<patch digest>` (`plugins/github/src/server/routes/mirror/prDocument.ts`). Both
blobs are written before the swap, so the swap still publishes a complete revision or nothing. A patch
whose descriptor blob already exists is not cut again. The cut runs on the node's own thread, and a
refresh of an unchanged pull request every 45 seconds would otherwise repeat it for every file.

`GET /repos/:owner/:repo/pulls/:number/diff` is the document. It is served from the same files
resource and the same refresh as the files route, reads the file rows in provider order and each
available file's descriptor blob, and parses nothing. A descriptor blob that is missing, which is
every file of a mirror written before documents existed, is cut from the patch body and stored on
that read. A missing patch body is the same integrity failure the files route repairs, and it repairs
the same way. The answer is `{ document, completeness, revision }`, with no patch text in it. A 2,200-file,
million-row pull request is about 27,000 segments and a 2.5 MB document.

Segments and search are two repository routes, because a segment is addressed by its patch digest and
a compare preview stores its patches the same way: `POST /repos/:owner/:repo/diff/segments` answers up
to 32 segments by path, digest, and ordinal, cut from the patch body again, with parsed patches held
in a 64 MB process-local cache for the next batch; `POST /repos/:owner/:repo/diff/search` answers a
page of matches over the files the request names. Access is the repository's, resolved the way the
blob route resolves it, and a digest must be one this plugin could have written before it becomes
part of a blob key.

A known limit: patch blobs are keyed by digest across the whole node, not per repository, and neither
route checks that a digest belongs to the repository in its path. Anyone who can read one repository
and knows a digest can read that patch from any repository the node has mirrored. With one identity
per node that grants nothing new. It matters if one node serves several identities with different
access, and the fix is to check the digest against that repository's file rows or compare record.

## Review locations

The GraphQL selection reads `isOutdated`, `isResolved`, `line`, and `originalLine` on every thread page.
GitHub defines these fields in its [review thread reference](https://docs.github.com/en/graphql/reference/pulls#pullrequestreviewthread).
The mirror stores these independently on each comment row. `Thread.line` is the nullable current line
without a historical fallback. `Thread.originalLine` is historical metadata, and `Thread.outdated`
is true, false, or null for an unverified legacy location. Resolution does not change location validity.

The location migration retains comment IDs, replies, and ordering. It marks detail and file resources
stale. Legacy rows keep unknown outdated status and expose no current line until a provider refresh.
Offline reads retain the conversation. Missing status in a cached client response also excludes inline
placement, without labeling the thread outdated.

Detail, files, diff, and batch responses carry a nullable `revision`, the provider's base and head commit
pair. The detail fetch rechecks those commits and `updatedAt` after walking every connection. The files
fetch checks the REST comparison before and after its pages. A comparison that changes during a fetch
fails with `github_revision_changed` and leaves the mirror intact. A refresh with missing comparison
metadata carries no verified revision.

Each resource writes its revision with its rows. Reads capture rows and revision before yielding to
asynchronous blob reads. A refresh makes a resource with a different revision stale. Completed detail
and file refreshes announce `plugin:github:pr-synced`; the active pull model invalidates detail, file
summaries, and the diff document. This lets open panes converge through the Node's refresh mechanism.

`plugins/github/src/client/reviewThreadLocation.ts` owns eligibility. A thread needs explicit
`outdated: false`, a current path, a LEFT or RIGHT side, and a current line. Detail and diff must carry
the same verified revision before the plugin supplies inline threads or requests conversation snippets.
Outdated and unverified threads remain in history. No client timer, file-body scan, or historical
remapping decides whether a review applies.

Inline threads are not in the document. They come with the PR detail, which is complete when it is
served, and the viewer places each one by its line number from the document's segment line spans, so
its space is reserved before its segment loads. The diff source reports loading until both the
document and the detail are in. The plugin withholds inline threads while the two resources describe
different comparisons. A thread without a matching file or rendered line receives no substitute anchor.

## Checks and workflow policies

The mirror stores a check run's `conclusion ?? status` and a status context's `state`. A check that
hasn't finished reads as `QUEUED`, `IN_PROGRESS`, `PENDING`, `WAITING`, `REQUESTED`, or `EXPECTED`, or
has no status at all. `checkPending` in `plugins/github/src/server/mirrorQueries.ts` names those, and
`checkFailed` counts a check as failed only when it has finished and isn't `SUCCESS`, `NEUTRAL`, or
`SKIPPED`. The `pr_checks` agent tool and the `github:ci-settled` policy share both rules, so neither
calls a running check a failure.

The detail query asks for the latest commit's `oid` beside the PR's `headRefOid`, and
`refreshPullDetail` returns both. Right after a push the two can differ, and the checks then belong to
the older commit. Review, comment, and thread-comment authors carry their GraphQL `__typename`, and
the mirror stores `author_is_bot` for each. A row mirrored before that column has no value, and counts
as a person.

The plugin contributes two `gate-policy` verdict sources
([gate policies](../workflows/step-kinds.md#gate-policies)), in
`plugins/github/src/server/workflowPolicies.ts`. Each poll refreshes the task's PR from GitHub first
through `refreshPullDetail`, because the mirror otherwise refreshes only when a client opens the PR,
and a run nobody is watching would read a copy older than the agent's push. A push that lands while
the PR is being read answers `wait`. Any other refresh failure is a failed poll.

- **`github:ci-settled`** answers `wait` while the checks belong to an older commit or any check is
  running. Once every check has finished, it answers `fail` with the failing checks in `value`, or
  `pass`. A task with no PR fails. A PR with no checks fails too, unless the `missing` setting is
  `wait`, for a repository whose checks take a minute to appear.
- **`github:review-received`** answers `pass` once a review, an inline comment, or a conversation
  comment arrives after the wait started from someone other than the PR's author. Bots don't count
  unless `include_bots` is true. `value` holds what they said, so the next step can bind to it. A closed
  or merged PR fails. An approval with no comments still passes. It reads its own query,
  `reviewActivitySince`, rather than the `pr_review_comments` tool's, because that one keeps only the
  oldest hundred rows of each kind and would drop new comments on a long-lived PR.
