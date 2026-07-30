# GitHub Node and data model

**Status:** Normative current-plugin migration<br>
**Requirement prefix:** `CUR-GH`

## Provider adapter and synchronization

`CUR-GH-020` The provider adapter MUST use brokered credentials and fixed GitHub destinations. REST
requests send GitHub API version `2022-11-28`, `application/vnd.github+json`, and an Acorn user
agent; GraphQL requests use the same broker identity. Plugins never construct an authorization
header.

`CUR-GH-021` Normalized errors are:

- `connection-reauthentication-required` for upstream 401;
- `provider-rate-limited` for 403/429 with exhausted limit or retry-after;
- `provider-sso-required` for `x-github-sso`;
- `provider-forbidden` for other 403;
- `repository-not-found` for unauthorized/absent repository resolution without existence oracle;
- `provider-validation-failed` for safe 422 detail; and
- `provider-unavailable` for remaining HTTP, GraphQL, parse, and network failures.

`CUR-GH-022` REST/GraphQL response status, size, content type, schema, pagination, redirect, and
rate-limit headers are validated before persistence. A GraphQL HTTP 200 containing `errors` is not
success unless the operation explicitly defines safe partial results.

`CUR-GH-023` Repository and open-pull lists use conditional ETag revalidation. Composite PR detail
and files use a TTL gate. Concurrent refreshes of the same connection/resource are single-flight;
stale reads may return immediately while revalidation runs.

`CUR-GH-024` Closed-pull history, branch discovery, compare preview, repository labels, mention
candidates, Actions jobs, and signed job logs are bounded on-demand queries. The Node MUST surface
pagination/truncation and MUST NOT silently persist provider bodies outside declared caches.

## Resource model

| Resource | Key attributes/status |
| --- | --- |
| `acorn.github.connection` | account login/name/avatar/scopes, secret ref, health, default flag |
| `acorn.github.repository` | connection, provider repository ID, owner/name, privacy, default branch, pushed time |
| `acorn.github.pull` | repository, number/node ID, state/draft/title/body, refs/head SHA, author, merge status/auto-merge |
| `acorn.github.pull-file` | pull, normalized path/status, additions/deletions, blob SHA, viewed state |
| `acorn.github.review` | pull, node ID, author/state/body/submitted time |
| `acorn.github.comment` | pull, node ID, author/body/created time |
| `acorn.github.review-thread` | pull, thread/comment IDs, path/line/side/resolved, ordered comments |
| `acorn.github.check` | pull, name/status/url, optional workflow run ID |
| `acorn.github.actions-run` | repository/run ID; on-demand jobs/status |
| `acorn.github.blob` | repository, immutable SHA, media/size/content availability |

`CUR-GH-025` Upstream IDs are recorded exactly and validated by their endpoint schema. A repository
rename updates attributes and aliases without changing the Acorn resource ID. A pull number is
unique only within its repository.

`CUR-GH-026` PR body, review/comment body, job log, branch/ref, path, label, author, and URL fields
are untrusted provider data. Stored rich body is sanitized on the Node and rendered only through
the host Markdown/sanitized-content contract; arbitrary provider HTML is not trusted.

## Isolated database and blob store

The plugin database contains:

| Table | Purpose |
| --- | --- |
| `p_connections` | safe GitHub account projection and core secret-reference relation |
| `p_repositories` | connection-scoped mirror and resource ID |
| `p_pulls` | open/detail pull projection |
| `p_pull_files` | changed-file summaries and blob SHA |
| `p_reviews` | submitted review projections |
| `p_comments` | discussion comments |
| `p_commits` | timeline commit summaries |
| `p_review_threads` | inline thread/comment rows |
| `p_labels` | pull label set |
| `p_review_requests` | requested user/team principals |
| `p_checks` | check/status rollup |
| `p_sync_state` | resource, ETag, fetched/source-observed times, error/backoff |
| `p_viewed_files` | plugin-owned owner preference for reviewed files |
| `p_pinned_repositories` | plugin-owned Client/source ordering preference |
| `p_operations` | idempotent provider mutation/sync saga state |

`CUR-GH-027` Every mirror table is keyed by connection and Acorn repository/pull identity. Cached
private data MUST never be selected through login text, provider ID alone, or a different
connection.

`CUR-GH-028` Child collections replaced by a composite sync are deleted/inserted with the parent
and sync freshness in one plugin-database transaction. A failed partial write leaves the prior
snapshot authoritative and stale.

`CUR-GH-029` Patch and full blob bodies use a plugin-owned content-addressed store keyed by
connection/repository plus verified SHA and content class. Patch and file-body namespaces are
distinct; metadata rows hold references, not large bodies.

`CUR-GH-030` Immutable blob cache entries MAY persist without TTL but remain authorization- and
connection-scoped on access. The Node verifies encoded size, decoded size, encoding, content hash
where available, and repository relation before registration.

`CUR-GH-031` Mirror/sync/blob data and derived mention candidates are reproducible cache and may be
excluded from encrypted backup. Viewed-file and pinned-repository app state is durable plugin data
and is included. Credential material is backed up only through the core credential policy.

## Exact mirrored provider coverage

`CUR-GH-032` Repository sync maps the first 100 repositories ordered by pushed time and records
privacy/default branch/pushed time. Mirror-miss resolution fetches one repository and folds
unauthorized/absent into the same not-found result.

`CUR-GH-033` Open-pull sync maps number, node ID, state, draft, title, head/base refs, author, update
time and ETag. It atomically prunes pulls absent from the refreshed open set while preserving
plugin-local viewed/pinned state according to relation policy.

`CUR-GH-034` Composite detail maps pull body/head SHA/mergeability/merge-state/auto-merge, first 20
labels, first 50 reviews, review requests, comments and threads, first 100 commits, and latest
commit check/status contexts. The snapshot identifies truncated collections.

`CUR-GH-035` File sync maps at most the provider-supported first 100 changed files with path,
status, additions, deletions, SHA, optional patch and local viewed state. Batch patch hydration
accepts at most 20 unique validated paths per request.

`CUR-GH-036` PR batch prefetch accepts at most ten pull numbers, fetches stale detail in one
multi-alias GraphQL request, fetches files with bounded parallel REST, tolerates explicitly safe
per-alias/per-file failure, and returns a freshness/error record for every requested pull.

## Mutations and mirror reconciliation

`CUR-GH-037` Merge, close/reopen, draft, and auto-merge update the corresponding pull projection
after provider success. Auto-merge and draft commands require a mirrored node ID; inline comments
require a mirrored head SHA.

`CUR-GH-038` Discussion comment creation stores the canonical returned comment. Label and reviewer
mutations replace the full canonical returned set when GitHub supplies it.

`CUR-GH-039` Inline comment/reply, thread resolution, submitted review, and reviewer operations
whose complete canonical result is unavailable mark composite detail stale before command
completion. Create pull marks the open-pull list stale.

`CUR-GH-040` Rerun-failed-jobs creates no fabricated check state; the relevant PR/check resource is
marked stale and the actual outcome arrives through refresh.

`CUR-GH-041` File viewed is local plugin state and commits without a GitHub call. Its event clearly
identifies local scope and MUST NOT imply GitHub has marked the file viewed.

## Conflict analysis, Actions, and retention

`CUR-GH-042` Conflict-file analysis runs only for a pull currently reported conflicting, validates
the base ref, resolves an authorized core repository checkout, fetches into throwaway namespaced
refs without changing branches, and invokes fixed `git merge-tree` with a 60-second fetch and
30-second analysis deadline.

`CUR-GH-043` Conflict analysis returns `available:false` on missing checkout, unavailable Git
capability, unsupported Git, or best-effort fetch/analyze failure. It does not turn an optional
filename enhancement into a PR-pane error.

`CUR-GH-044` Actions jobs return at most 100 jobs and bounded steps. Job-log retrieval follows only
the single GitHub-authorized signed HTTPS redirect through the network broker and strips the GitHub
credential before the redirected request.

`CUR-GH-045` Job logs are streamed/bounded and not durable mirror state. ANSI is sanitized by the
host log renderer; credentials, signed URL query values, and raw response headers never enter
events or diagnostics.

`CUR-GH-046` Mirror retention removes a repository/pull and every scoped child/blob reference when
the connection loses access or owner purges it. Garbage collection never deletes content still
referenced by another authorized connection/resource.

`CUR-GH-047` V2 creates an empty GitHub database. V1 OAuth tokens, session identity, mirror rows,
sync state, blobs, viewed files, pins, and cached Client data MUST NOT be imported.

`CUR-GH-048` Release rollback restores the matching GitHub runtime/database generation. Mirror
tables may be rebuilt; durable viewed/pinned state must follow reversible migrations or block
automatic rollback.

`CUR-GH-049` Disconnect, reconnect, account switch, repository rename/transfer, scope reduction,
SSO requirement, token revocation, and rate-limit reset are explicit reconciliation inputs and
must not corrupt another connection's mirror.
