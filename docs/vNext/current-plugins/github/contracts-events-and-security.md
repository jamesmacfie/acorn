# GitHub contracts, events, and security

**Status:** Normative current-plugin migration<br>
**Requirement prefix:** `CUR-GH`

The schemas referenced by this catalog are immutable manifest artifacts. All targets are canonical
node-qualified resources and all provider operations are connection-scoped.

## Query catalog

| Query ID | Target/input and bounds | Result |
| --- | --- | --- |
| `acorn.github.connections.list.v2` | Node | safe connection descriptors/health/scopes |
| `acorn.github.repositories.list.v2` | connection; cursor, filters, ≤100 | repository page with freshness |
| `acorn.github.pulls.list.v2` | repository; open or closed, cursor, ≤100/50 | pull summary page |
| `acorn.github.pulls.snapshot.v2` | pull | composite pull/reviews/comments/threads/commits/checks with truncation |
| `acorn.github.pulls.files.v2` | pull; summary/full/path filter, cursor | file summaries and optional patch stream refs |
| `acorn.github.pulls.batch.v2` | repository; 1–10 pull URIs; files mode | per-pull detail/files/freshness/error |
| `acorn.github.blobs.get.v2` | repository/blob SHA relation | immutable content stream descriptor |
| `acorn.github.repositories.labels.v2` | repository; ≤100 | labels sorted by name |
| `acorn.github.repositories.branches.v2` | repository; scan ≤3,000, return ≤100 | branch names newest-tip-first |
| `acorn.github.repositories.mentions.v2` | repository | mirror-derived distinct participant logins |
| `acorn.github.repositories.compare.v2` | repository; validated base/head | ahead count, ≤100 commits/files and patches |
| `acorn.github.pulls.conflicts.v2` | conflicting pull/base | `{available, files}` |
| `acorn.github.actions.jobs.v2` | actions run; ≤100 | jobs and bounded steps |
| `acorn.github.actions.job-log.v2` | job | bounded log stream descriptor |

`CUR-GH-080` A normal query never forces a provider refresh implicitly when policy says stale data
may be served. Every provider-backed result reports freshness, source-observed time, snapshot
sequence, truncation/page metadata, and a safe per-resource error.

`CUR-GH-081` Force refresh is a command because it performs external I/O and mutates the mirror.
Client “refresh” controls invoke the corresponding command then read/query the resulting snapshot.

## Command catalog

| Command ID | Effect | Idempotency/commit/deadline | Grant/confirmation |
| --- | --- | --- | --- |
| `acorn.github.connection.create.v2` | host OAuth/device flow and connection commit | keyed saga; 5 min | secret/provider setup |
| `acorn.github.connection.disconnect.v2` | revoke credential, stop sync, retain/purge choice | keyed saga; 60 s | destructive |
| `acorn.github.repositories.refresh.v2` | refresh repository mirror | keyed sync intent; 120 s | provider read |
| `acorn.github.pulls.refresh-list.v2` | refresh open-pull list | keyed sync intent; 120 s | provider read |
| `acorn.github.pull.refresh.v2` | fetch composite and files before atomic mirror updates | keyed saga; 120 s | provider read |
| `acorn.github.pull.create.v2` | create PR title/body/base/head/draft | keyed external saga; 120 s | provider write/external-send |
| `acorn.github.pull.merge.v2` | merge with merge/squash/rebase | keyed external saga; 120 s | provider write/destructive |
| `acorn.github.pull.auto-merge.set.v2` | enable with method or disable | keyed/revision; 60 s | provider write |
| `acorn.github.pull.state.set.v2` | close or reopen | keyed/revision; 60 s | provider write |
| `acorn.github.pull.draft.set.v2` | draft or ready | keyed/revision; 60 s | provider write |
| `acorn.github.pull.comment.create.v2` | add discussion comment | keyed; provider success + mirror; 60 s | provider write/external-send |
| `acorn.github.pull.label.add.v2` / `.remove.v2` | change one label | keyed; provider + canonical set; 60 s | provider write |
| `acorn.github.pull.file-viewed.set.v2` | local viewed state | keyed/revision; local transaction; 10 s | plugin setting write |
| `acorn.github.review-comment.create.v2` | line comment at current head | keyed; provider + stale mark; 60 s | provider write/external-send |
| `acorn.github.review-comment.reply.v2` | reply to canonical numeric comment | keyed; provider + stale mark; 60 s | provider write/external-send |
| `acorn.github.review-thread.resolved.set.v2` | resolve/unresolve by node ID | keyed/revision; provider + stale mark; 60 s | provider write |
| `acorn.github.review.submit.v2` | approve/request-changes/comment | keyed; provider + stale mark; 60 s | provider write/external-send |
| `acorn.github.reviewer.add.v2` / `.remove.v2` | change requested reviewer | keyed; provider + canonical/stale set; 60 s | provider write |
| `acorn.github.actions.rerun-failed.v2` | rerun failed jobs | keyed external saga; 60 s | provider write/execute confirmation |
| `acorn.github.repository.pin.set.v2` | local pin/order | keyed/revision; local transaction; 10 s | plugin setting write |

`CUR-GH-082` All GitHub mutations bind `commandId`, connection, target resource, expected revision/
head where applicable, canonical input hash, deadline, and initiating device. A retry never repeats
an uncertain provider mutation without first reconciling by provider idempotency or current state.

`CUR-GH-083` Provider mutation commit is a durable saga step. The command returns `committed` only
after the known mirror/local state and outbox are consistent; otherwise it returns `accepted` with
an operation resource or a stable ambiguous-outcome error requiring reconciliation.

`CUR-GH-084` Merge requires method, current pull revision, and optional expected head SHA.
Head-moved/not-mergeable returns `merge-conflict` without retry. Create validates non-empty title,
base/head grammar and comparison before external send.

`CUR-GH-085` A review event is exactly `approve`, `request-changes`, or `comment`. Request-changes
and comment require non-empty body. Inline comments require canonical path, positive line, left/
right side, and current mirrored head SHA.

## Exported capabilities

| Capability | Consumer contract |
| --- | --- |
| `acorn-plugin://acorn/github/capability/repository-resolve@2` | map connection/provider repository reference to authorized canonical repository |
| `acorn-plugin://acorn/github/capability/pull-snapshot@2` | bounded redacted pull/context snapshot with freshness |
| `acorn-plugin://acorn/github/capability/review-command@2` | explicitly delegated review mutation set |
| `acorn-plugin://acorn/github/capability/external-reference@2` | recognize/format GitHub PR/repo/check references and navigation intents |
| `acorn-plugin://acorn/github/capability/task-context@2` | immutable task-linked PR snapshot for Context/Agents |

`CUR-GH-086` Consumers declare a dependency and exact capability version. GitHub evaluates the
original caller's connection/resource/provider-write authority; it MUST NOT substitute the system
plugin's broader credential grant.

`CUR-GH-087` `task-context@2` returns a bounded snapshot and owning navigation intents, not a token,
live SDK, mirror database handle, arbitrary GraphQL, or authority to mutate the pull.

## Event catalog

The manifest publishes:

| Event | Safe subject/payload |
| --- | --- |
| `acorn.github.connection.created.v2` | connection/account-safe metadata |
| `acorn.github.connection.health-changed.v2` | connection; safe health/reason/scope class |
| `acorn.github.connection.disconnected.v2` | connection; retention choice |
| `acorn.github.repository.discovered.v2` | repository summary |
| `acorn.github.repository.updated.v2` | changed field names/revision/freshness |
| `acorn.github.repository.removed.v2` | tombstone/reason |
| `acorn.github.pull.discovered.v2` | pull summary |
| `acorn.github.pull.updated.v2` | pull; changed field names/revision/freshness |
| `acorn.github.pull.removed.v2` | tombstone/reason |
| `acorn.github.pull.files-updated.v2` | pull; file count/truncation/snapshot revision |
| `acorn.github.review.updated.v2` | pull; review/thread/comment change class and snapshot revision |
| `acorn.github.checks.updated.v2` | pull; aggregate/check revision |
| `acorn.github.pull.file-viewed-changed.v2` | pull-file; local viewed boolean |
| `acorn.github.sync.completed.v2` | mirror resource; source observation/freshness/truncation |
| `acorn.github.sync.failed.v2` | mirror resource; safe error/backoff/stale availability |

`CUR-GH-088` Events do not contain credentials, complete private bodies/patches/blobs/logs, signed
URLs, raw provider responses, authorization headers, or hidden repository existence. Subscribers
dereference authorized snapshots.

`CUR-GH-089` Provider poll/refresh observations emit change events only after the atomic mirror
commit. ETag 304 may emit `sync.completed` but does not fabricate resource-updated events.

## Streams

`CUR-GH-090` Patch, immutable blob, and job-log content use credit-controlled read streams.
Each stream is connection/resource/grant bound, has declared media and encoded byte limit, supports
cancellation, and closes on revocation. Content is not sent on the durable product-event channel.

`CUR-GH-091` A GitHub signed log URL is broker-internal, one-use/short-lived, and never returned to
Electron. The redirected request contains no GitHub authorization or application cookies.

## Security

`CUR-GH-092` GitHub credentials are write-only core secret references used only by broker operations
whose scheme, host, port, path prefix, method, redirect, response size, and purpose are fixed.
Neither the plugin database nor Electron stores token plaintext.

`CUR-GH-093` GitHub account identity is displayed as provider context and never accepted as proof of
paired-device authority. Disconnecting/logging out of GitHub MUST NOT revoke Acorn device identity;
revoking an Acorn device MUST NOT silently revoke the upstream GitHub token.

`CUR-GH-094` The broker allows `api.github.com` and the exact OAuth/device endpoints required by
setup. It rejects arbitrary base URLs, URL user-info, private/link-local/metadata destinations,
origin-changing credential redirects, excess redirects, DNS rebinding, and unbounded compressed
responses.

`CUR-GH-095` Provider 403/404 handling MUST avoid a private-repository existence oracle. Error,
event, audit, and notification detail is filtered by the caller's existing connection/repository
visibility.

`CUR-GH-096` Branch/ref input rejects leading dash, NUL, traversal/control characters, and values
outside Git ref grammar. Repository owner/name, numbers, IDs, SHAs, paths, label/user names, and
pagination values are schema-validated and bounded before provider or Git use.

`CUR-GH-097` Conflict Git commands are argv-only fixed operations in the authorized checkout.
Throwaway refs are derived from validated pull numbers; repository content/config cannot replace
the executable, add arguments, set environment, or approve checkout trust.

`CUR-GH-098` Provider HTML/Markdown, patches, ANSI logs, URLs, avatars, filenames, error messages,
and GraphQL details are hostile data. Renderer-specific sanitation and safe navigation apply after
Node-side size/schema normalization.

`CUR-GH-099` External write confirmations cannot be rendered or suppressed by GitHub content.
Review submit, merge, rerun, disconnect/purge, scope expansion, and ambiguous provider outcome use
host-owned ceremonies.

`CUR-GH-100` Audit records include connection ID, operation, repository/pull URI, actor, result,
provider request correlation, bytes/rate-limit class, and confirmation class. They exclude token,
body/comment/review text, patch/blob/log, signed URL, local path, and raw provider error.

`CUR-GH-101` Security conformance covers connection/account confusion, token leakage, SSRF/
redirect/DNS rebinding, private-repo oracle, malicious provider HTML/Markdown/ANSI/URL, oversized
payloads, ref/argument injection, stale-head review, mutation retry ambiguity, permission
revocation, cross-connection cache access, and job-log credential stripping.

## Errors and automation replacement

`CUR-GH-102` Domain errors include `connection-required`, `connection-reauthentication-required`,
`provider-rate-limited`, `provider-sso-required`, `provider-forbidden`, `provider-unavailable`,
`repository-not-found`, `pull-not-found`, `node-id-unknown`, `head-sha-unknown`,
`provider-validation-failed`, `merge-conflict`, `auto-merge-not-allowed`, `conflict-detail-
unavailable`, `log-unavailable`, `provider-outcome-ambiguous`, and shared command errors.

`CUR-GH-103` V1 `/api/repos/*` and `/api/v1/plugins/github/*` routes are replaced by the query/
command/event/stream contracts above. No V1 bearer, cookie, path, operation ID, or response
compatibility is retained.

`CUR-GH-104` V2 automation receives the same serialized product contracts as Electron and no raw
GraphQL, SDK client, provider token, database access, signed log URL, checkout path, or renderer
handle.

`CUR-GH-105` Contract tests MUST verify every operation's schema, auth, expected revision,
idempotency, commit point, mirror outcome, events, retry class, cancellation, redaction, truncation,
and stable errors.
