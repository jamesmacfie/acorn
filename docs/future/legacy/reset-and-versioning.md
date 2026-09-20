# Reset and versioning

Date: 2026-09-21. Status: implementation specification; no reset performed.
Read [context](./context.md). Implement through [reset tooling](./01-reset-tooling.md),
[database baselines](./09-database-baselines.md), and [version cutover](./10-version-one.md).

## One deliberate clean break

Do not migrate existing user data into this baseline. Provide a recoverable reset with an exact
inventory, then start fresh. Keep source repositories and worktree files where they are. This checkout
itself lives beneath an Acorn worktree directory, so deleting an entire data root could delete the code
performing the reset. Recursive deletion of a root is not an acceptable implementation.

The tool defaults to a dry-run inventory. Execution requires explicit data roots, device-state roots,
the private memory root if included, and an external recovery directory. No implicit home-directory
or development-root target. Resolve paths and refuse filesystem roots, home/workspace roots as reset
targets, overlapping recovery paths, and symlink escapes. Enumerate owned artifacts rather than
following links or traversing repository/worktree trees.

Require all affected Node, helper, and terminal processes to be stopped. Check locks and active
writers; a stale lock is a diagnostic, not permission to kill a process. Export/copy the selected
artifacts with a checksummed manifest and private permissions. Verify the recovery copy before removing
each original. Record progress so interruption can resume without touching an unlisted target. Restore
the complete old snapshot only with the old binary, never by importing it into the new baseline.

## Reset inventory

| State | Source of truth | Reset disposition |
| --- | --- | --- |
| Core and plugin SQLite plus WAL/SHM | Explicit Node data root; owning schemas and plugin storage | Recover then remove together; fresh migration creates each database. |
| Node identity, TLS, internal/session secrets, active identity | Data-root and custody startup contracts | Recreate; all devices re-pair and connections reauthenticate. Never log secret values. |
| Bundled/user plugin installs, ownership rows, trust acknowledgements, cached bundles | Plugin installer/bundled state and custody stores | Recreate from fresh bundled artifacts; reinstall user packages under the new baseline. |
| Node blobs, notes, proposals, generated artifacts and logs | Data-root feature stores | Recover then remove listed owned artifacts; do not treat the root as disposable. |
| Private accepted memory | `privateMemoryRoot` in `plugins/memory/src/server/memory.ts:33` | Separate explicit target, potentially outside the data root; recover and reset to avoid orphaned project IDs. |
| Desktop fleet/pins/tokens and helper state | Explicit desktop custody directory | Recover selected owned files, clear pairings, and create fresh custody. |
| Desktop preferences, drafts, IndexedDB query cache, webview-owned state | Acorn application origin/profile | Clear through the owning host, with an inventory of Acorn namespaces; do not clear another browser profile. |
| Terminal fleet/custody, preferences and file query cache | `apps/tui/src/node/paths.ts` and `apps/tui/src/node/cache.ts` | Resolve actual directories; account for terminal reuse of a desktop Node. Reset each shared artifact once. |
| Native keychain | Acorn's exact service/account entries | Export required decryption keys privately through native APIs before removing exact Acorn entries. Refuse removal if recoverability cannot be verified. |
| Repositories and worktrees, including their `.acorn` content | Git/worktree directories | Preserve byte-for-byte. Do not run archive/prune/cleanup commands as part of reset. |
| Provider state, external databases, CLI logins, node declaration files | External systems or owner files | Preserve. Acorn connection records may be lost; external resources must not be deleted. |

After reset, retained worktrees are detached files unless explicitly re-added; do not silently adopt
them through a legacy reconstruction path. Explain this consequence in the reset summary. Likewise,
old repository workflow files remain on disk but require deliberate editing before they run. Update
repository-owned examples and fixtures in the cutover ticket; never bulk-rewrite arbitrary user repos.

Encrypted token files are not a recoverable snapshot without their decryption key. Store recovered
key material in a separate owner-readable recovery file, never the manifest, stdout, or logs. If a
native key cannot be read, leave the associated entries and encrypted artifacts intact and report
the reset incomplete. Preserve the current private-file key fallback; it handles a present host
constraint and is unrelated to Electron adoption.

## Contract identity and version map

Reusing 1 can collide with historical version-1 artifacts. Add one immutable baseline identifier,
`baseline: 'acorn-1'`, distinct from each evolving protocol version. Require it at Node probe/pair
acceptance, service startup handshake, installed plugin manifest admission, enrollment admission,
data-root opening, and standalone user-authored workflow import. Missing or different baseline means
incompatible, with a reset/rebuild diagnostic. Do not infer or insert the marker into old data.

This is a new pattern, justified specifically by the requested renumbering. It does not negotiate
features or emulate previous contracts. Future ordinary releases keep the same baseline and advance
only the relevant major when necessary. Generated plugin artifacts and published declarations include
the marker. Keep Node discovery parsing tolerant enough to explain a mismatch before rejecting it.

Device storage and query-cache namespaces incorporate this baseline; startup does not hydrate a prior
namespace. A fresh Node root gets the marker only when no prior owned state exists. A marked root
still undergoes normal database migration-history checks. Backups record the baseline, and restore
rejects a different/missing baseline. Self-contained exported formats include the baseline alongside
their format version; internal records can inherit it from their verified root/container.

| Contract family | Reviewed state | Target |
| --- | --- | --- |
| Node HTTP/WebSocket API and probe | `/v2`, Node protocol 2 | `/v1`, protocol 1; update both broker and server. No `/v2` alias. |
| Service lifecycle protocol | 3 | 1; update producer, parser, launcher, and fixtures together. |
| Plugin API | Major string `13` | String `1`; retain range grammar and mismatch checks. |
| Acorn workspace/plugin/toolkit package releases | Mostly `0.1.0` | `1.0.0`; update bundled ownership/version fixtures and lockfile metadata as needed. External dependencies unchanged. |
| Workflow definitions and exported graph contracts | Format 2 | Required format 1 plus baseline; update TOML/JSON parsing, editors, generation prompts, examples, and schemas. |
| Dashboard persisted layout | Version 2 | Version 1 under the new baseline namespace/root. |
| Agent event, typed-data, tree, bridge, enrollment, fleet/cache/trust formats | Already 1 where inspected | Keep 1; regenerate affected contracts/examples and add admission baseline where listed above. |
| Core and plugin SQL history | 40 files over 11 chains | One initial migration per chain, preserving current constraints after removals. |
| Tool-generated metadata and vendor protocol versions | Drizzle snapshots, Node runtime, ACP, MCP, vendor APIs, Sentry | Preserve the versions required by their owners. |

Route changes include more than builders: authentication mount patterns, pre-auth routes, permission
scopes, WebSocket upgrades, plugin fetch routing, telemetry route grouping, MCP/CLI clients, Rust/helper
bootstrap, scaffolds, test fixtures, and SDK examples. Reject obsolete forms at their entry boundary.

## What remains after removing legacy paths

Keep migration infrastructure for future schema changes, mismatch rejection, optional-provider handling,
plugin rollback, incompatible-plugin diagnostics, scoped cache invalidation, and interrupted-operation
recovery. Replace old migration chains; do not remove storage integrity checks. Retain unknown optional
manifest fields according to the chosen forward-compatibility policy; that is not an old-format adapter.

## Verify before building

- Resolve actual state paths on each host; this table names owners, not a deletion command.
- Test mixed roots containing repositories, worktrees, symlinks, unrelated files, and live-writer locks.
- Test historical version-1 input without the marker as well as version-2/13 input.
- Test reset interruption, repeated invocation, snapshot recovery with the previous binary, and fresh boot.
- Never run this operation against real user state as part of implementing or verifying the tickets.
