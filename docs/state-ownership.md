# State ownership

The key architectural rule is simple: the Node owns product data; the desktop owns presentation.
Client caches and persisted UI state are disposable and never prove that a mutation succeeded.

## Node-owned state

The Node is authoritative for workspaces, projects, tasks, branches, worktrees, Git status,
notes, memories, integrations, provider mirrors, terminal metadata, managed sessions, delegation
ownership, workflow runs, Docker/database configuration, saved requests, secrets, devices, plugin enablement, config trust,
and audit records.

Whether this node collects telemetry at all is node-owned too: one preference row,
`telemetry.enabled`, off unless it reads `'1'` ([telemetry.md](./telemetry.md) § The switch). It
belongs to the node rather than to a device because the collector runs whether or not a client is
attached, and because a schedule firing at 3 AM is exactly the thing worth a record. Settings →
Telemetry is the switch, and it writes this row like any other node preference. Turning it off in
one window stops every client paired with that node, which is what the promise has to mean: the
renderer reads the same row and turns its own emitter off with it.

What that page draws under the switch is owned by nothing and stored nowhere. The counts, the sink
list and the drop total live in the collector's memory and start again with the process, which is
why they are a route the page polls rather than state anything persists
([telemetry.md](./telemetry.md) § What the page shows). A history would need a table, and the
programme refused one.

It is also authoritative for what the owner *composes* about those resources — a task's pane layout,
a task's open editor files, a repo's PR filters, a task's context selection, the dashboard panels a
person built over plugin collections — held as per-user preferences (`GET|PUT /v2/core/prefs`). These
follow the resource, so any client that pairs with a Node renders that Node's arrangements and the
agent can read them.

Each Node has an independent data root and database set. A Node ID is part of every renderer query,
selection scope, layout scope, and fleet aggregate input.

## Client-owned durable state

The desktop persists:

- paired Node records, labels, endpoints, certificate fingerprints, and local-node identity;
- which Node this window talked to last, so the next launch can pick its cache partition before
  the fleet answers ([frontend.md](./frontend.md) § Painting before the node);
- device-scoped appearance, shortcuts, rail order, collapse state, and window geometry;
- the per-Node IndexedDB query cache;
- selection/restore state and local drafts.

Device tokens are held by the desktop helper's encrypted store, not by the renderer. Drafts are
best-effort client memory/persistence and can be lost on restart; they are never sent automatically
while a Node is offline.

## Scope rules

**State follows the resource it describes.** State about a Node's resources goes to that Node's
per-user prefs, so every client renders it; state about this machine or the person at it — theme,
style, keybindings, window and collapse state, notices, caches, trust, tokens — stays device-local on
purpose. There is no "home node" to store things on: `homeNode()` picks which Node a fresh window
opens on and nothing else, and the remembered last Node is an id this device draws a cache for,
not a place preferences live. Drafts stay device-local by a separate recorded decision, because losable
is acceptable for a draft and not for a composition.

Use the persistence scope that owns the state:

| State | Scope |
| --- | --- |
| Fleet membership and token custody | desktop installation; token in main, membership in fleet store |
| Appearance, notification settings ([notifications.md](./notifications.md) § Settings), shortcuts, rail order, notices, trust, tokens | device |
| How a list is drawn: the diff view, and the Changes pane's list or tree, sort, and grouping | device |
| Where a workflow's nodes sit in the graph view | device |
| Which backend and model every Generate control spends (`models.generatePick`) | device |
| Query cache | Node |
| Task layout, open files, PR filters, context selection | owning Node's prefs, keyed by Node + task/repo |
| Dashboard panel definitions and their placements | owning Node's prefs, one app-scoped slice |
| Last path, last task, last source, last Node | device |
| Last view per workspace; last workspace (terminal client) | owning Node's prefs, keyed by Node + workspace |
| Workspace/task selection | Node + workspace/task |
| Draft editor/comment text, and a commit message in the Changes pane | client + current task |
| Provider data and task mutations | owning Node |

Module-level signals or maps that reference a task or workspace must either include the Node ID or be
cleared on a node switch. A state owner registers its OWN evictor beside the signal it clears, through
`onScopeEvicted` (`client-core/host/registries/shell/scopeEviction.ts`); the shell only maps runtime lifecycle
events onto scopes. It used to hold the list of evictors itself, which meant every new signal had to
remember to add itself there, and forgetting was silent.

Choosing between "keyed by node" and "cleared on switch" is not taste. A LIVE roster clears — the
agent list, terminal sessions, the node's plugin list — because it refetches for the new node within a
tick, so clearing costs nothing and keying would buy nothing. DURABLE memory is keyed — editor scroll,
the active terminal tab, the workspace view — because switching back should restore what was there.

**A draft is device-local because it is losable, and keyed by the task because it belongs to a
worktree.** Every draft goes through one helper, which writes `localStorage` under a prefix its caller
names (`client-core/kit/lib/draftState.ts`): a comment box uses `comment-draft:`, and the Changes
pane's commit message uses `changes:commit-draft:<taskId>`. The node id is deliberately absent from
that key. A commit message is about the files in front of the reader, and the same task on another
node is another worktree with another set of changes in it.

**A workflow's node positions are the device's, because a definition is portable.** A definition can
be saved back into a repository as TOML and read on somebody else's screen, so x and y have no place
in it: they would be noise in every diff and wrong on every other monitor. They live under
`plugin:workflows:layout:<defId>` in device storage instead, as `Record<nodeName, { x, y }>`
(`plugins/workflows/src/client/layoutPrefs.ts`). Renaming a node carries its position with it and
deleting a definition drops its layout. A drag writes 400 ms after it stops, and a draft with no row
yet keeps its positions in memory for the session. Which of rows and graph the run pane draws its
nodes as is the same kind of thing and sits beside it, under `plugin:workflows:runs:nodeView`. The
terminal client has no `localStorage`, so both writes land nowhere there — and neither is missed,
because that host draws the graph as the list either way.

**One "Generate with" default, and it is the device's.** Every Generate control in the app — the
commit-message wand, the workflow generator, the Settings section that edits it on its own — opens on
`models.generatePick`, a `{ backendId, modelId }` pair in one key
(`client-core/features/settings/models/generatePick.ts`). One key rather than one per dialog because
the list now holds agent CLIs installed on the machine beside stored API keys, so re-picking is the
common case and a pick made in one dialog should be what the next one opens on. It is the device's for
the reason `theme` is: the backends a node offers are the same everywhere, but which of them you want
to spend is yours, and it should not follow you to a machine where you were working on somebody
else's budget. A remembered pick whose backend has gone is not honoured — it falls back to the first
backend, because a disconnected provider or an uninstalled CLI in a preference is a stale note rather
than a decision.

**The SQL dialog is the one Generate control outside that default, and it is a known limit rather
than a choice.** It is a remote tree drawn in the database plugin's worker
(`plugins/database/src/tree/GenerateSqlModal.tsx`), and the default is a device preference: it lives
in the host's `localStorage`, `/v2/core/prefs` has no bridge scope on purpose, and `bridge.state` is
that same store namespaced `plugin:<id>:*`, which is what keeps one plugin out of core's keys. So the
dialog opens on the first backend every time and remembers nothing, and a pick made in it is not
carried anywhere else. Closing it takes one of two things: a narrow pair of bridge verbs for that one
key, which is a plugin-API decision rather than a preferences one, or the dialog moving to the
compiled client tier, where reading a preference is an import.

**Where you were looking is the node's, not the device's.** Which rail source or task each workspace
was left on is `core.workspace-views`, one key per workspace
(`client-core/features/tasks/tasks.ts`, `infra/persistence/stateSlices.ts`). It sits with the pane
layouts rather than with `last_source` above, and for the same two reasons: it is keyed by that
node's workspace ids, so it means nothing anywhere else, and both clients paired with a node should
return you to the same place in it. The terminal client also has no `localStorage`, so a device key
there is written nowhere and read back as nothing — which is why `last_workspace`, the one thing that
host restores on top of this, is the node's too (`apps/tui/src/chrome/restore.ts`).

The desktop restores `last_path`, `last_task` and `last_source` on first load and consults the
per-workspace memory only when you move to a workspace this session has not been in yet, so the two
never argue. It records on the way out, in the one effect that sees the workspace change; the
terminal records as you move, because it has no last-task and last-source to fall back on and the
workspace open when the process ends has to already know its own view.

### Which mechanism holds a given fact

Three mechanisms, and the choice follows from the question "who is the source of truth, and how long
should this outlive the tab?":

| Mechanism | Use when | Example |
| --- | --- | --- |
| TanStack query | The Node owns it and the client is caching a read | tasks, workspaces, a PR's files |
| Persisted state slice | It must survive a relaunch | appearance, pane layout, open editor files |
| Module-level signal | The client owns it and it is session-only | a live roster, a scroll position, a draft |

A persisted state slice is a shape, not a location. Where its value lands is decided by one set,
`DEVICE_KEYS` in `client-core/infra/persistence/devicePrefs.ts`: listed keys go to `localStorage`, and
everything else — including every scoped slice — goes to the owning Node through `savePref`. Unknown
means Node, deliberately, so a new per-task or per-repo slice is portable by default. The cost is
honest: editing a layout while its Node is offline stalls the write until reconnect, where
`localStorage` never stalled. That is the right trade for state that is *about* that Node.

The dashboard model (`core.dashboards`, one `app`-scoped slice, version 1) is the clearest case of
that rule and worth reading as the worked example
([dashboards.md § Persistence](./dashboards.md)). A panel is a saved question about a Node's
resources, so it follows the Node: build a board once and every client paired with that Node draws
it, and the agent can read it through `/v2` like anything else. Device storage would have made it a
per-laptop artefact of the machine it happened to be composed on. It is one blob rather than a key
per panel — the whole model is read together by every surface that draws one — holding panel
definitions by id and placements by scope key, with placements *referencing* definitions rather than
embedding them so a second placement is an addition rather than a migration. Unknown ids are retained
inert on the pane-layout rule: parsing asks "is this shaped like a panel?", never "is that plugin
installed here?", so a composition is never collateral damage of toggling a plugin off.

A module-level signal is the default for anything ephemeral, and the cost of that default is exactly
the eviction question above — so a signal keyed by task, workspace or node owes an `onScopeEvicted`
registration in the same file.

**Where a list's place lives.** Two of those signals are the host's answer for the keyboard, and both
are session-only by choice. `client-core/kit/keys/collectionState.ts` holds `active`, `selected` and
`offset` for every collection node, keyed by the collection's id and by each item's own key, never by
its index: a list rebuilt from a fresh response is a new array of new objects, and an index into it
points at whatever moved into that slot. Keying by the item's key is what makes a refetch keep your
place, and it is why the state sits outside the rows rather than inside them.
`client-core/host/keys/focusRegions.ts` holds which region of which pane has focus, and it is the one place
`focusedPane` gets written and the one place the `runtime:focus-changed` event is emitted from.
Neither is persisted. Where you are in a list is a reading posture, not a preference, and restoring
one across a relaunch would need a scope and an eviction rule nobody has asked for. See
[command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md) § Focus and typing.

**A slice reads its own keys and nothing else.** Every slice used to carry a `legacy` reader as well,
a second function that pulled the pre-scoped aggregate key the scoped keys replaced —
`task_layouts` and `task_panes` for the layout slice, `editor_open_files`, `pr_filters`. Those went on
2026-08-28. The migration was confirmed complete on the live data root first: none of the four
aggregate keys was still in `prefs`, and the scoped `core:task-layouts:*`, `editor:open-files:*`,
`github:pr-filters:*` and `context:section-selection:*` keys were all present. The four `app`-scoped
shell slices (`core.last-path`, `core.last-task`, `core.last-source`, `core.left-collapsed`) had a
`legacy` reader too, and for those it was always a no-op: `storageKeyFor` returns the declared key
unchanged for an `app` slice, so the canonical read and the legacy read were the same key.

The pre-scoped keys are still listed as *not* device-owned in `devicePrefs.ts`, and that is not
leftovers. `mergePrefs` lets the device win, so a straggler in some device's `localStorage` under
`task_layouts` must keep draining to the node rather than being classified as device state and
shadowing the node's copy forever.

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
