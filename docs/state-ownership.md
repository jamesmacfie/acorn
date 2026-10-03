# State ownership

This page covers which state the Node owns, which the device owns, and what's disposable. Read it before
you decide where a new piece of state lives.

The rule: the Node owns product data, and the client owns presentation. Client caches and persisted UI
state are disposable and never prove that a mutation succeeded.

## Pages

<a id="scope-rules"></a>
<a id="which-mechanism-holds-a-given-fact"></a>

[Scope rules](./state-ownership/scope-rules.md) covers where client state is stored: the scope table,
the three mechanisms, `DEVICE_KEYS`, eviction on a Node switch, drafts, and the device and Node
decisions behind particular keys.

[Reading places](./state-ownership/reading-places.md) covers list, timeline, and diff positions, and the
measurements and parsed rows that go with them.

## Node-owned state

The Node is authoritative for workspaces, projects, tasks, branches, worktrees, Git status, notes,
memories, integrations, provider mirrors, terminal metadata, managed sessions, delegation ownership,
workflow drafts, immutable revisions, publication recovery, workflow runs, workflow schedule bindings
and occurrences, processing checkpoints, Docker and database configuration, saved requests, secrets,
devices, plugin enablement, config trust, and audit records.

It's also authoritative for what the owner composes about those resources: a task's pane layout, a
task's open editor files, a repository's PR filters, a task's context selection, dashboard placement and
layout, and typed dashboard definitions. These follow the resource, so any client that pairs with the
Node renders its arrangements, and an agent can read them.

Workflow schedule drafts are Node-owned too. The renderer may hold unsaved form edits while the modal is
open, but **Save draft** writes a disabled core cadence and its workflow-owned binding. **Activate** is
an immediate device-only mutation, and a disconnected renderer reports the failure rather than keeping
an intent to replay.

Whether the Node collects telemetry is one Node preference, `telemetry.enabled`
([the switch](./telemetry/model.md#the-switch)). It belongs to the Node because the collector runs
whether or not a client is attached, and turning it off in one window stops every client paired with
that Node. What Settings → Telemetry draws under the switch lives in the collector's memory and starts
again with the process.

Each Node has its own data root and databases. A Node ID is part of every renderer query, selection
scope, layout scope, and fleet aggregate. The Node's loaded plugin runtime identity is process-owned:
`active` records the declaration and client hash the running service captured, and the installed
package is a separate disk candidate. An install or a cached roster answer can't change what the process
serves.

## Client-owned durable state

Plugin bundle bytes and exact `(pluginId, hash)` trust decisions belong to device custody, which
verifies bytes before it writes them. The renderer's per-Node distribution snapshot is transient: it
derives selections from Node observations and custody decisions and is never persisted. Revoking a
decision updates the snapshot and withdraws the code.

Saved query drafts and typed dashboard drafts are Node-owned, with compare-and-swap revisions. Their
device recovery copies are keyed by Node, entity, and base revision, and stay until acknowledged or
discarded. Reconnecting shows conflicts instead of overwriting Node content
([query recovery](./data-sources.md#workspace-query-library)). The shared query editor autosaves a saved
query to the Node, and a stale save opens explicit conflict choices. An inline query stays inside its
workflow or panel draft, and **Customize for this use** copies saved content into that consumer.
Dashboard placements reference the stable published panel ID, so publishing changes a definition, not
the geometry of every surface that places it.

AI authoring conversations are device-local drafts. The recovery key includes the active Node, feature,
and target ID, and the value holds bounded context, a pending clarification or proposal, the model pick,
and the sample opt-in. Applying a proposal enters the owning feature's draft and validation path, and the
conversation never proves that a save or publication succeeded.

The desktop persists:

- paired Node records, labels, endpoints, certificate fingerprints, and local-Node identity;
- which Node this window talked to last, so the next launch picks its cache partition before the fleet
  answers ([startup readiness](./frontend.md#startup-readiness));
- device-scoped appearance, shortcuts, rail order, and window geometry;
- device-held plugin enablement and `plugin:<device-plugin-id>:*` state;
- the per-Node IndexedDB query cache;
- selection and restore state, and local drafts.

The desktop helper holds device tokens in its encrypted store, never the renderer. Drafts are
best-effort and can be lost on restart.

## Freshness

The client shows Node-backed data with freshness derived from the query result and broker state. It may
render a stale or offline cache, but writes target the owning Node and report errors directly. An
invalidated cache never stands in for a completed mutation.

## Restore and disablement

The shell restores fleet and Node scope before task scope. Switching Nodes remounts Node-scoped client
state, so effects and query clients can't keep the previous Node's assumptions.

Preference writes capture their QueryClient's Node before any asynchronous ordering or cleanup, so a
captured missing target can't follow a later selection. Confirmation, ordering, and optimistic rollback
are per QueryClient and key. Device keys are written to device storage before query-cache observers are
notified.

Startup restore captures the same QueryClient for scoped-key generation and hydration, and hydrates
workspace, view, and pane phases before it arms writes. Each bound slice has its own disposable effect,
so a change in one slice doesn't serialize the others. Equivalent queued values keep their first
deadline, and a reversion cancels stale queued work. Late plugins hydrate before writing, disablement
keeps stored data, removed scopes write tombstones, and disposal flushes pending writes to their
captured Node.

Disabling a plugin removes its client contributions at once and stops its Node routes and services at
the next Node start. Its data file stays in the root until the owner deletes it.

Notes body and title recovery is device state keyed by Node, scope address, and slug. It stays until the
exact local edit is acknowledged or the note is deleted, with no size cap that drops dirty text
([notes and memory](./notes-and-memory.md)). Notes don't use the compare-and-swap contract saved queries
do.

Compiled pane models carry a captured Node shell generation. One task model per pane is shared across
regions, survives pane removal, and retires with task replacement, task eviction, a Node switch, or host
destruction. A late lease release can't retire a returning generation with the same ID.

## Retained preview documents

The Node owns preview configuration. The desktop shell owns each retained local preview's configured
home, browsing location, loading state, and navigation cursor, outside the Node database and the query
cache. Unmounting a pane hides the page. Node switches retire every preview, so task IDs can't cross Node
ownership, and archive and shutdown release native resources. Browser process loss and app exit can
discard unsaved page state ([host-owned webviews](./shell.md#host-owned-webviews)).
