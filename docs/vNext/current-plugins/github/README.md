# GitHub system plugin

**Status:** Normative current-plugin migration<br>
**Coordinate:** `acorn/github`<br>
**Distribution:** System; release-signed, version-locked, installed by the default profile<br>
**Runtime:** In-process system service on the Node plus bundled semantic Electron contributions<br>
**Requirement prefix:** `CUR-GH`

GitHub is Acorn's repository, pull-request, review, and Actions integration. It owns GitHub provider
semantics and a disposable local mirror; it does not own Acorn identity, workspaces, tasks,
worktrees, generic Git, the generic diff renderer, credential storage, or arbitrary HTTP access.

This specification is divided into:

- [Node and data](./node-and-data.md)
- [Client and UI](./client-and-ui.md)
- [Contracts, events, and security](./contracts-events-and-security.md)
- [Migration and parity](./migration-and-parity.md)

The mandatory twelve-section template is distributed without omission: sections 1–3 and 9 are in
this overview; sections 4 and 8 are in Node/data plus Client/UI; sections 5–6 and 10 are in
Contracts/events/security; section 7 is in Client/UI; and sections 11–12 are in Migration/parity.

## Current behavior

V1 authenticates Acorn itself with a GitHub OAuth cookie, then reuses that identity and credential
for GitHub integration calls. A Node-side REST/GraphQL adapter mirrors repositories, open pull
requests, composite PR detail, files, reviews, comments, commits, threads, labels, reviewer
requests, checks, viewed-file state, and freshness metadata. Immutable patch/blob content uses an
on-disk SHA cache. Reads use serve-then-revalidate, ETags where GitHub supplies them, and TTLs
elsewhere. Closed pulls, branches, compare results, labels, Actions jobs, and job logs are
provider-backed on demand.

The Client provides the default GitHub source, repository and workspace browsing, open/closed PR
lists, create-PR flow, PR Navigator, diff/review pane, conversation, checks/logs, comments,
reviewers, labels, merge/auto-merge/draft/state controls, file navigation, viewed state,
prefetch/refresh, shortcuts, and task promotion.

`CUR-GH-001` In V2 GitHub is an integration identity only. GitHub login, account ID, token,
membership, and scopes MUST NOT authenticate an Acorn owner, identify a paired Client, encrypt
Acorn state, or scope unrelated plugin data.

`CUR-GH-002` Each GitHub connection is a Node-owned integration resource containing safe account
metadata and an opaque secret reference. Multiple Nodes may connect different accounts; Electron
must label the Node and GitHub account on ambiguous surfaces.

`CUR-GH-003` Every repository and pull resource is node-qualified and connection-qualified.
Upstream owner/name, numeric IDs, node IDs, numbers, refs, and SHAs are attributes, not Acorn
identity keys.

`CUR-GH-004` The mirror is a provider cache/read model. GitHub remains authoritative for repository,
pull, review, comment, label, reviewer, check, Actions, branch, compare, and blob facts; Acorn is
authoritative only for plugin-local viewed-file and pinned-repository preferences.

## Target ownership

| Concern | V2 owner |
| --- | --- |
| GitHub connection and account setup | GitHub plugin via core credential/connection host |
| REST/GraphQL mapping and normalized errors | GitHub Node service |
| Mirror, TTL/ETag sync, immutable provider blobs | GitHub plugin storage |
| Acorn workspaces/tasks/links | Node core |
| Local checkout, Git and worktree operations | Node core |
| PR/review semantic documents and commands | GitHub plugin |
| Generic diff/file/code/log rendering | Electron renderer capabilities |
| GitHub source, Navigator, create/review/check UI | bundled GitHub Client contributions |
| Credentials and destination-restricted HTTP | core secret/provider broker |

`CUR-GH-005` GitHub MUST consume core repository links and task relations through public resources.
It MUST NOT create hidden workspace/task identity or treat the selected GitHub account as the Fleet
owner.

`CUR-GH-006` GitHub MUST request `acorn.diff-review/2`, `acorn.code-editor/2`,
`acorn.collection/2` (including `acorn.data-grid/2` leaf), `acorn.markdown/2`, and
`acorn.log/2` renderer capabilities. It MAY
supply review semantics and documents but MUST NOT own their Electron implementations.

`CUR-GH-007` Conflict-file calculation MUST use core Git/read-checkout capabilities. GitHub MUST
NOT spawn Git, read repository mappings, or trust client-supplied checkout paths directly.

## System manifest

The release manifest declares:

- a Node `system` runtime, migration/schema assets, and bundled declarative Client artifacts;
- `workspace-source`, `task-pane`, routes, commands, keybindings, context menus, navigation intents,
  source promotion, settings, wizard, badges, notifications, context sections, and subscriptions;
- exported repository, pull snapshot, review, external-reference, and task-context capabilities;
- dependencies on core connection/credential, repository/task-link, Git, and renderer contracts;
- isolated database/blob storage and release-coupled health/migrations.

`CUR-GH-008` Baseline grants are connection-scoped brokered GitHub provider operations,
`core.secret:use`, `core.network` restricted to GitHub API/OAuth destinations,
`core.repository:read`, `core.task:read`, `core.storage`, `core.events`, and declared `core.ui`.
Git fetch for conflict analysis and all provider writes are separately visible grants.

`CUR-GH-009` The GitHub package is not independently installable, replaceable, downgradable, or
uninstallable. The owner MAY disconnect every GitHub connection; that produces an actionable
unconfigured system-plugin state rather than uninstalling it.

## Lifecycle

`CUR-GH-010` Activation opens/migrates isolated storage, verifies the broker destination contract,
reconciles unfinished sync/mutation operations, validates blob indexes, registers contributions,
and reports health without requiring a GitHub connection.

`CUR-GH-011` Connection setup is a host wizard: explain authority, choose GitHub device/OAuth flow,
enter no plugin-visible secret, show requested GitHub scopes, complete browser/device verification,
fetch public account identity, test access, choose default connection, and optionally seed a
repository sync.

`CUR-GH-012` Disconnect revokes the secret reference and stops live refresh/writes. The owner
chooses whether to retain the encrypted/mirrored cache for offline display or purge it; retained
private data remains connection-scoped and unavailable to another connection.

`CUR-GH-013` Plugin startup failure MUST leave Fleet, tasks, local worktrees, Changes, Editor,
Terminal, and other plugins available. GitHub sources/panes remain as unavailable placeholders with
retry, diagnostics, and connection recovery.

`CUR-GH-014` Health is separated into plugin runtime, per-connection authentication/scopes/rate
limit/SSO, and per-resource freshness. One connection's failure MUST NOT degrade another.

## Compatibility invariants

`CUR-GH-015` The Node MUST support REST for ETag-bearing list reads and normal writes, GraphQL for
composite PR detail and mutations lacking a safe REST equivalent, and a shared normalized provider
error boundary. Internal implementation may change without altering results or freshness behavior.

`CUR-GH-016` A successful provider write MUST update the mirror in the same durable saga or mark
the affected resource stale before returning its committed/accepted result. A within-TTL read MUST
not knowingly return the pre-write value as fresh.

`CUR-GH-017` Repository and PR reads expose `live`, `stale`, or `offline` freshness, source-observed
time, and local snapshot sequence. Stale cached private data is returned only to a currently
authorized owner Client.

`CUR-GH-018` GitHub's first-page ceilings remain visible limitations: repository/open-PR/files
lists cap at 100 where V1 does; detail child collections use their declared 20/50/100 limits.
V2 MUST return truncation/page metadata rather than implying completeness.

`CUR-GH-019` Fresh-install parity and the exact release cases in
[Migration and parity](./migration-and-parity.md) are mandatory.
