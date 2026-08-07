# State ownership

The key architectural rule is simple: the Node owns product data; the desktop owns presentation.
Client caches and persisted UI state are disposable and never prove that a mutation succeeded.

## Node-owned state

The Node is authoritative for workspaces, repositories, tasks, branches, worktrees, Git status,
notes, memories, integrations, provider mirrors, terminal metadata, managed sessions, workflow runs,
Docker/database configuration, saved requests, secrets, devices, plugin enablement, config trust,
and audit records.

Each Node has an independent data root and database set. A Node ID is part of every renderer query,
selection scope, layout scope, and fleet aggregate input.

## Client-owned durable state

The desktop persists:

- paired Node records, labels, endpoints, certificate fingerprints, and local-node identity;
- device-scoped appearance, shortcuts, pane layouts, task ordering, and window geometry;
- the per-Node IndexedDB query cache;
- selection/restore state and local drafts.

Device tokens are held by Electron main's `safeStorage` store, not by the renderer. Drafts are
best-effort client memory/persistence and can be lost on restart; they are never sent automatically
while a Node is offline.

## Scope rules

Use the persistence scope that owns the state:

| State | Scope |
| --- | --- |
| Fleet membership and token custody | desktop installation; token in main, membership in fleet store |
| Appearance and shortcuts | device |
| Query cache | Node |
| Task layout and last source | Node + task |
| Workspace/task selection | Node + workspace/task |
| Draft editor/comment text | client + current task |
| Provider data and task mutations | owning Node |

Module-level signals or maps that reference a task/workspace must either include the Node ID or be
cleared on `runtime:node-switched`. `scopedEviction.ts` handles cache and runtime eviction events.

## Freshness

Node-backed data is displayed with freshness derived from the query result and broker state. The
client may render stale/offline cache, but writes target the owning Node and report errors directly.
There is no optimistic assumption that an invalidated cache reflects a completed mutation.

## Restore and disablement

The shell restores fleet and Node scope before task scope. Switching Nodes remounts Node-scoped
client state so effects and query clients cannot retain the previous Node's assumptions.

Disabling a plugin removes its client contributions at activation and stops its Node routes/services
on the next Node initialization. Its data file remains in the Node root until the owner explicitly
deletes it.
