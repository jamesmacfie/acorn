# Client and Node state ownership

Status: Normative<br>
Requirement prefix: `UI-STATE`

The Node owns durable domain and execution state. Electron owns presentation and a disposable
authorized cache. Plugins cannot blur this boundary.

## Ownership table

| State | Owner | Persistence |
| --- | --- | --- |
| Fleet pairing and device grants | each Node; client stores its identity material | Node DB + OS key stores |
| workspaces, repositories, tasks, links | owning Node | core Node DB |
| plugin install/grants/setup/settings/data | owning Node | lifecycle/core DB + plugin DB/vault |
| commands/jobs/events/streams | owning Node | command store/outbox/runtime stores |
| selected Node/workspace/source/task | Electron | client Fleet store |
| task pane layouts/weights/pins | Electron, namespaced by Node/task | client Fleet store |
| focus, maximize, popovers, drag, active transient selection | Electron | memory only |
| theme/style/shortcuts/window preferences | paired Electron device | client Fleet store |
| query projections and view snapshots | Electron cache | encrypted/bounded local cache |
| dirty form and unsent secret input | Electron view memory | never durable by default |

- **UI-STATE-001:** A workspace belongs to one Node; a task belongs to one workspace. Every client
  key MUST include Node identity even when resource IDs are globally unique.
- **UI-STATE-002:** Plugins cannot persist directly into the client Fleet store. They declare
  `client-presentation` contributions containing only closed local event names, host reducers,
  capacity/byte ceilings, session/device persistence and disable/uninstall behavior. Electron owns
  serialization; plugins receive typed reducer output, never a storage handle.
- **UI-STATE-003:** Node settings and product mutations are never optimistic client preferences.
  They use authorized commands, revisions and resulting events.
- **UI-STATE-004:** Client presentation settings cannot be used by the Node to authorize, schedule
  or alter shared behavior.
- **UI-STATE-004A:** Client events are
  `workspace-focused`, `task-focused`, `pane-focused`, `pane-opened`, `pane-closed`, `pane-moved`,
  `layout-changed`, `terminal-session-focused`, and `terminal-session-closed`. They carry the
  minimum node-qualified presentation identity and a per-process epoch/sequence, are delivered only
  to declared active local contributions, and never become product events or cross-device data.
- **UI-STATE-004B:** A presentation automation invokes one manifest-indexed `client-command`
  operation after its declared debounce and owner approval. The host rechecks installation
  generation and local context. A subsequent Node mutation uses the normal authenticated command
  path and cannot inherit authority from the focus event.

## Client Fleet store

- **UI-STATE-005:** The store partitions by Acorn owner profile and Node ID, is protected by OS
  full-disk encryption, encrypts pairing keys and sensitive fields with OS-backed application keys,
  and is cleared on explicit owner profile removal.
- **UI-STATE-006:** Cached server projections include Node, resource, schema version, resource
  version, authorization class, fetched time, expiry and source event cursor.
- **UI-STATE-007:** Cache is disposable and never the sole record of a mutation, setup step,
  permission, secret, event acknowledgement or plugin data.
- **UI-STATE-008:** Confidential and secret-metadata projections are not persisted unless the
  server contract explicitly permits a bounded encrypted cache. Secret plaintext is never cached.
- **UI-STATE-009:** Logout/profile removal deletes caches, view state, resumable session tokens and
  local pairing credentials for the selected profile without sending destructive Node commands.

## Restore

- **UI-STATE-010:** Restore order is owner profile and paired Nodes, Fleet/workspace selection,
  top-level view, task layout, pane state, then view sessions. A lower phase cannot persist defaults
  before its higher phase finishes.
- **UI-STATE-011:** Missing/disconnected Nodes preserve non-sensitive presentation identity and
  display an offline placeholder. Missing plugins preserve pane/source identifiers but no last
  confidential view body.
- **UI-STATE-012:** Restored routes and layouts are normalized against currently authorized
  resources and contributions. Invalid values are retained only where reinstall/reconnect can make
  them meaningful; otherwise they are safely reset with a notice.
- **UI-STATE-013:** Presentation slice writes serialize per key, are atomic, bounded and rollback in
  UI on failure. Schema migration is declarative and retains a recoverable prior value until commit.

## Cross-Node aggregation

- **UI-STATE-014:** Fleet attention, activity, agent state, notifications and search are client
  projections from independent Node snapshots/events. Electron labels source and tracks freshness
  per Node.
- **UI-STATE-015:** There is no merged authoritative Fleet database or cross-Node transaction.
  Aggregate filters/sorts are presentation operations over authorized results.
- **UI-STATE-016:** A Node cursor gap resynchronizes only that Node's affected projections and does
  not invalidate healthy Node caches.

## Eviction

- **UI-STATE-017:** Task archive evicts view sessions and task-scoped transient/cache state after
  contributors receive a bounded presentation cleanup phase. It does not delete Node task history
  unless the archive command specifies it.
- **UI-STATE-018:** Workspace removal, Node unpair and owner-profile removal have separate eviction
  scopes and MUST prevent stale data appearing under a reused display name.
- **UI-STATE-019:** Storage pressure evicts least-recent non-sensitive query projections first,
  then inactive view state; it never silently evicts pairing identity or unsent user form state
  without host warning.

## Acceptance

- **UI-STATE-020:** Tests MUST restore multiple Nodes with colliding local IDs, switch owner
  profiles, remove/re-add a Node, disable/reinstall a plugin, archive a task, corrupt a slice,
  exhaust storage and prove no state crosses Node, profile, workspace or plugin boundaries.
