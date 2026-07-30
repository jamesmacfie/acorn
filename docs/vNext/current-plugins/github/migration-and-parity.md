# GitHub migration and parity

**Status:** Normative current-plugin migration<br>
**Requirement prefix:** `CUR-GH`

## Coupling removal

| V1 coupling | Required V2 replacement |
| --- | --- |
| GitHub OAuth cookie is Acorn login and provider credential | independent paired-device identity plus GitHub connection secret reference |
| GitHub mirror tables are in core SQLite | isolated GitHub database/outbox |
| shared global blob cache | plugin-owned authorization-aware content store |
| core App hardcodes PullList/PullDetail/Diff/Create routes | GitHub source/route/task-pane contributions |
| core tabs hardcode GitHub as source | default-profile source contribution with stable ID |
| core display tests import GitHub file navigation | renderer-owned navigation/resource intent contract |
| GitHub PullList imports Linear reference scanning | brokered optional external-reference contributions |
| GitHub conflict route reads repo path/spawns Git | core repository/Git fixed capabilities |
| integration provider labels GitHub `kind: identity` | normal connection provider; never Acorn identity |
| server route composition imports every handler | manifest query/command registration |
| public API service wraps plugin implementation | common V2 contract broker |
| PR diff implementation is feature-local | standard Electron `acorn.diff-review/2` renderer |

`CUR-GH-130` Core and other plugins MUST NOT import GitHub client/server implementation modules,
mirror tables, route helpers, resource keys, or file-navigation logic. GitHub may depend only on
core public contracts and declared plugin capabilities.

`CUR-GH-131` Linear, Rollbar, issue, or other reference rendering is an optional contribution
collection. GitHub passes sanitized text/resources to the external-reference broker and renders
returned typed intents; absence cannot break pull lists.

`CUR-GH-132` The V1 data root remains untouched. V2 does not import OAuth/session tokens,
repositories, pulls, child rows, sync state, blobs, viewed files, pins, filters, diff state, or
Client cache.

## V1 route and operation inventory

The cookie API currently mounts these routes under `/api/repos`:

| Family | V1 routes |
| --- | --- |
| repositories | `GET /`, `POST /refresh`, `GET /:owner/:repo/labels`, `GET /:owner/:repo/mentions` |
| pull reads | `GET /:owner/:repo/pulls`, `/pulls/:number`, `/pulls/:number/conflicts`, `/pulls/:number/files`, `/blobs/:sha` |
| prefetch/patch | `POST /:owner/:repo/pulls/batch`, `/pulls/:number/files/patches` |
| create | `GET /:owner/:repo/branches`, `GET /:owner/:repo/compare`, `POST /:owner/:repo/pulls` |
| state | `POST /pulls/:number/merge`, `/auto-merge`, `/close`, `/reopen`, `/draft`; `DELETE /auto-merge` |
| conversation/review | `POST /pulls/:number/comments`, `/review-comments`, `/review-comments/:commentId/replies`, `/threads/:threadId/resolve`, `/reviews` |
| labels/reviewers/viewed | `POST|DELETE /pulls/:number/labels`, `POST|DELETE /pulls/:number/requested-reviewers`, `POST /pulls/:number/viewed` |
| Actions | `GET /actions/runs/:runId/jobs`, `GET /actions/jobs/:jobId/logs`, `POST /actions/:runId/rerun` |

The V1 bearer operation IDs are `github.repos.list`, `github.repos.refresh`,
`github.pulls.list`, `github.pulls.get`, `github.pulls.files`, `github.blobs.get`,
`github.pulls.refresh`, `github.pulls.refresh-one`, `github.pulls.create`,
`github.pulls.merge`, `github.pulls.comment`, `github.pulls.close`, `github.pulls.reopen`,
`github.repos.labels`, `github.repos.branches`, `github.repos.mentions`,
`github.repos.compare`, `github.pulls.prefetch`, `github.pulls.files.batch`,
`github.actions.jobs`, `github.actions.job-log`, `github.pulls.draft`,
`github.pulls.auto-merge.enable`, `github.pulls.auto-merge.disable`,
`github.pulls.labels.add`, `github.pulls.labels.remove`, `github.pulls.files.viewed`,
`github.pulls.review-comments.create`, `github.pulls.review-comments.reply`,
`github.pulls.threads.resolved`, `github.pulls.reviews.submit`,
`github.pulls.reviewers.add`, `github.pulls.reviewers.remove`, and
`github.actions.rerun-failed`.

`CUR-GH-158` Every V1 path and operation above MUST be covered by the V2 catalog, including
best-effort conflicts and the distinction between refresh list, refresh one pull, prefetch and
patch hydration. V2 does not preserve the V1 HTTP names.

`CUR-GH-159` V1 publishes no durable GitHub product event catalog. V2 mirror/provider facts MUST
use the events in [Contracts, events, and security](./contracts-events-and-security.md); query-cache
invalidation and Client optimistic updates are not substitutes.

## Fresh-install and setup

`CUR-GH-133` Fresh V2 opens the shell without GitHub authentication. The default GitHub source,
review task-pane metadata, and connection settings are registered, with an unconfigured call to
action and no provider network request until setup or an authorized query.

`CUR-GH-134` Completing the host connection wizard creates one connection, retrieves account-safe
identity/scopes, initializes an empty connection partition, and optionally runs repository sync.
The GitHub account does not change paired Clients, Fleet ownership, Node identity, or other plugin
settings.

`CUR-GH-135` A first repository selection displays stale/live state, assigns it to a workspace
through core workspace commands when chosen, and never makes GitHub the owner of workspace
membership.

## Browse and review parity

`CUR-GH-136` Repository lists preserve pushed-time order, private-repository visibility, pinned
ordering, explicit refresh, mirror-miss resolution, empty repositories, and rate-limit/SSO/reauth
recovery.

`CUR-GH-137` Reviews browse preserves the three-pane layout, open pull list, paged closed history,
draft/author/state/ref/update metadata, selection, new-PR control, refresh, prefetch, keyboard
navigation, and branded empty state.

`CUR-GH-138` PR task mode preserves the Navigator/Diff two-pane contribution, position/order,
`Cmd+Shift+R`, minimum width, task relation, and external GitHub breadcrumb/link behavior.

`CUR-GH-139` Navigator preserves composite pull detail, sanitized description, commits, reviews,
conversation, inline threads, labels, reviewers, merge status, auto-merge, checks, requested
reviewers, mentions, and freshness refresh.

`CUR-GH-140` Diff preserves unified/split choice, all files in one virtualized scroller, priority
hydration, syntax and word highlighting, hidden context, binary/too-large states, thread
interleaving, inline composition/replies/resolution, viewed state, scroll restoration, file finder,
and next/previous file shortcuts.

`CUR-GH-141` Create pull preserves branch discovery, comparison, ahead count, commit/title
assistance, compare diff, title/body/draft, provider 422 validation detail, successful list
invalidation, and navigation to the created pull.

`CUR-GH-142` Merge, auto-merge enable/disable, close/reopen, draft/ready, comments, labels,
reviewers, inline review comments/replies, thread resolution, review submit, viewed toggle, and
rerun failed Actions jobs produce the same user-visible result with V2 host confirmations and
idempotency.

`CUR-GH-143` Checks preserve jobs/steps, safe job logs, running/completed states, rerun, provider
link, load errors, and refresh. The log credential-stripping and bounded-stream changes are security
hardening, not a parity regression.

`CUR-GH-144` Conflict PRs preserve best-effort per-file conflict names when an authorized checkout
and Git capability exist; otherwise the UI states that conflicts exist but filenames are
unavailable.

## Freshness, failure, fleet, and lifecycle parity

`CUR-GH-145` Cold reads block for an initial provider snapshot. Fresh reads serve immediately.
Stale reads serve cached authorized data and revalidate. ETag 304 updates freshness without
replacing rows. Offline stale data remains labeled and read-only where a write cannot be safely
validated.

`CUR-GH-146` Explicit list and PR refresh preserve scopes: list refresh does not silently fetch
every detail; PR refresh fetches composite and files and cannot leave half the pair falsely fresh.

`CUR-GH-147` Provider 401, exhausted rate limit, SSO requirement, insufficient scope, absent/private
repository, GraphQL error, validation failure, merge conflict, stale node/head ID, and job-log
expiry each retain distinct recovery and never erase last-good mirror data unless access is revoked.

`CUR-GH-148` Node disconnect preserves cached navigation/list/detail labels and marks them offline.
Writes disable immediately. Reconnect applies event replay or authorized snapshots and does not
duplicate optimistic actions.

`CUR-GH-149` A single Electron Fleet may show GitHub connections from several Nodes. Identical
`owner/repo#number` values remain separate, receive Node/account labels, keep separate filters/
scroll/viewed state, and route every mutation to the owner Node.

`CUR-GH-150` Connection revocation immediately stops refresh/write and closes content streams.
Retain keeps encrypted/mirrored private data inaccessible pending reconnection to the same
connection identity; purge removes rows/blobs/client cache and cryptographically erases credential
material.

`CUR-GH-151` GitHub plugin failure does not block local tasks, Changes, Editor, Terminal, Agents,
Docker, Database, Notes, or Context. PR-linked tasks preserve the pane placeholder and task relation
while GitHub is unavailable.

## Release acceptance

`CUR-GH-152` Provider-adapter, error-normalization, response-schema, mirror atomicity, ETag/TTL,
retention, blob authorization, mutation reconciliation, command idempotency, conflict Git, log
redirect, UI, accessibility, event replay, and multi-connection/fleet tests are release gates.

`CUR-GH-153` Security gates prove no token reaches Electron/plugin storage/logs; GitHub identity
cannot authenticate Acorn; private data does not cross connection; redirects strip credentials;
malicious rich content is inert; and all provider writes are reauthorized at the Node.

`CUR-GH-154` Boundary tests reject core-to-GitHub implementation imports, cross-plugin SQL,
private route calls, direct `fetch` with credentials, direct Git/process execution, Client-delivered
JavaScript, and ownership of generic diff/editor/log renderers.

`CUR-GH-155` Scripted V1/V2 comparison covers connection/setup outcome, repository list, PR browse,
task review, every query/mutation, create flow, diff geometry/navigation, checks/logs, shortcuts,
refresh, offline/error states, and task promotion.

`CUR-GH-156` Every V1 internal/public route is accounted for: repositories list/refresh; pull
list/detail/conflicts/files/patches/batch; blob; branches/compare/create; labels/mentions; Actions
jobs/log/rerun; merge/auto-merge/state/draft/comment/labels/viewed/review-comment/reply/thread/
review/reviewer; and explicit refresh.

`CUR-GH-157` GitHub migration is complete only when Acorn starts and pairs with no GitHub account,
GitHub can be connected independently on each Node, and the fresh configured review experience is
visually and behaviorally equivalent to V1 without shared identity or storage.
