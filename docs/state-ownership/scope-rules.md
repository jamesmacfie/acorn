# Scope rules

This page covers where a piece of client state is stored and how long it lives: on the device, in the
owning Node's preferences, or in memory for the session. Read it before you add a persisted slice, a
module-level signal, or a draft. It's part of [state ownership](../state-ownership.md).

## State follows the resource it describes

State about a Node's resources goes to that Node's per-user preferences, so every client renders it.
State about this machine or the person at it, such as theme, style, keybindings, window state, notices,
caches, trust, and tokens, stays on the device. There's no home Node to store things on: `homeNode()`
picks which Node a fresh window opens on and nothing else. Drafts stay on the device by a separate
decision, because losable is acceptable for a draft and not for a composition.

The preferences query reads Node-owned keys from the active Node and device-owned keys from local
storage, and never copies one owner's values into the other's store. A missing or inaccessible device
store leaves device preferences at their defaults, and a save made while it's unavailable stays only in
the current query cache. Task layouts stay in the owning Node's preferences, so switching Nodes doesn't
carry a layout across.

Device plugin state is prefix-aware, because installed plugin IDs aren't known at build time. Only IDs
in the device bundle roster use the `plugin:<device-plugin-id>:*` device prefix. Node-delivered plugin
state uses Node preferences. Uninstalling removes the device prefix and the enablement entry and keeps
manual trust acknowledgements.

`acorn.json` is a second interface to some device preferences: appearance, keybinding overrides, rail
order, collapse, plugin source visibility, and exclusive-slot picks. The desktop helper reads and
watches it in its user data directory, and the terminal client uses its own config directory. Incoming
values go through the normal device preference setter, which writes local storage before it updates the
query cache. A Settings change to a covered value writes the file. Unknown top-level keys survive a
write, and a parse error leaves the last valid state on screen with a line and column notice. A
`plugins` entry is an installation request shown to the user, never a trust grant. The file holds no
Node preferences, plugin state, credentials, commands, or executable paths.

## The scope table

| State | Scope |
| --- | --- |
| Fleet membership and token custody | Desktop installation: the token in the helper, membership in the fleet store |
| Appearance, notification settings ([notifications](../notifications/channels.md#settings)), shortcuts, rail order, notices, trust, and tokens | Device |
| How a list is drawn: the diff view, and the Changes pane's list or tree, sort, and grouping | Device |
| Where a workflow's nodes sit in the graph view | Device |
| Which workflow task roots are expanded in the rail | Device |
| Which backend and model every Generate control spends (`models.generatePick`) | Device |
| The query cache | Node |
| Task layout, open files, PR filters, and context selection | Owning Node's preferences, keyed by Node and task or repository |
| Dashboard panel definitions and their placements | Owning Node's preferences, one app-scoped slice |
| Last view per workspace | Owning Node's preferences, keyed by Node and workspace |
| Last workspace and the two-workspace shortcut pair | Active Node's app-scoped preferences |
| Workspace and task selection | Node and workspace or task |
| Draft editor and comment text, and a Changes commit message | Client and current task |
| Provider data and task mutations | Owning Node |
| Computer Use app-access grants ([app-access approval](../managed-agents.md#app-access-approval)) | The Computer Use integration on the Node's computer. The Node keeps only the decision |

## Which mechanism holds a given fact

Pick by asking who's the source of truth and how long the fact should outlive the tab:

| Mechanism | Use when | Example |
| --- | --- | --- |
| TanStack query | The Node owns it and the client caches a read | Tasks, workspaces, a PR's files |
| Persisted state slice | It must survive a relaunch | Appearance, pane layout, open editor files |
| Module-level signal | The client owns it and it's session-only | A live roster, a scroll position, a draft |

A persisted slice is a shape, not a location. `DEVICE_KEYS` in
`packages/client-core/src/infra/persistence/devicePrefs.ts` decides where its value lands: listed keys
go to `localStorage`, and everything else, every scoped slice included, goes to the owning Node through
`savePref`. Unknown means Node, so a new per-task or per-repository slice is portable by default. The
cost is that editing a layout while its Node is offline holds the write until reconnect. The old
pre-scoped aggregate keys, such as `task_layouts`, aren't device keys either, so a straggler in some
device's `localStorage` drains to the Node instead of shadowing its copy. A slice reads only its own
keys.

The dashboard model, `core.dashboards`, one app-scoped slice at version 1, is the worked example
([dashboards](../dashboards.md)). A panel is a saved question about a Node's resources, so it follows
the Node: build a board once and every client paired with that Node draws it, and the agent can read it
over `/v1`. It's one blob, holding panel definitions by id and placements by scope key, and placements
reference definitions so a second placement is an addition, not a migration. Unknown ids are kept
inert: parsing asks "is this shaped like a panel?", never "is that plugin installed here?".

A module-level signal is the default for anything ephemeral. A map or signal that references a task,
workspace, or Node must include the Node ID or be cleared on a Node switch. The state's owner registers
its own evictor beside the signal through `onScopeEvicted`
(`packages/client-core/src/host/registries/shell/scopeEviction.ts`), and the shell only maps lifecycle
events onto scopes. A live roster clears, such as the agent list, terminal sessions, or the plugin list,
because it fetches again for the new Node within a tick. Durable memory is keyed, such as editor scroll,
the active terminal tab, or the workspace view, because switching back should restore it.
[Reading places](./reading-places.md) covers list, timeline, and diff positions.

## Particular decisions

**A draft is device-local because it's losable, and keyed by the task because it belongs to a
worktree.** Every draft goes through one helper that writes `localStorage` under a prefix its caller
names (`packages/client-core/src/kit/lib/state/draftState.ts`): `comment-draft:` for a comment box, and
`changes:commit-draft:<taskId>` for the Changes commit message. The Node id isn't in the key, because
the same task on another Node is another worktree with other changes. Drafts are never sent
automatically while a Node is offline.

**A workflow's node positions are the device's, because a definition is portable.** A definition can go
back into a repository as TOML and be read on someone else's screen, so x and y would be noise in every
diff. They live under `plugin:workflows:layout:<defId>` as `Record<nodeName, { x, y }>`
(`plugins/workflows/src/client/layoutPrefs.ts`). Renaming a node carries its position, and deleting a
definition drops its layout. A drag writes 400 ms after it stops. The run pane's rows-or-graph choice
sits beside it, under `plugin:workflows:runs:nodeView`. The terminal client has no `localStorage`, so
both writes land nowhere there, and it draws the graph as a list anyway.

**One "Generate with" default, and it's the device's.** Every Generate control opens on
`models.generatePick`, a `{ backendId, modelId }` pair
(`packages/client-core/src/features/settings/models/generatePick.ts`). It's one key, so a pick made in
one dialog is what the next one opens on. It's the device's for the same reason as `theme`: the
backends a Node offers are the same everywhere, but which you want to spend is yours. A pick whose
backend has gone falls back to the first backend.

**The SQL dialog is the one Generate control outside that default, and that's a known limit.** It's a
remote tree in the database plugin's worker (`plugins/database/src/tree/GenerateSqlModal.tsx`).
`/v1/core/prefs` has no bridge scope, and `bridge.state` is namespaced `plugin:<id>:*`, so the dialog
opens on the first backend every time and remembers nothing. Closing the gap needs a narrow pair of
bridge verbs for that key, or the dialog moving to the compiled tier.

**Where you were looking is the Node's.** Which rail source or task each workspace was left on is
`core.workspace-views`, one key per workspace (`packages/client-core/src/features/tasks/tasks.ts`,
`infra/persistence/stateSlices.ts`). A source view also keeps its page, so a relaunch returns to the
open pull request. It's keyed by that Node's workspace ids, so it means nothing elsewhere, and both
clients paired with a Node return to the same place. `last_workspace` picks the workspace and is the
Node's too, because the terminal client has no `localStorage`.

Both clients record as you move and reopen the same way: `last_workspace` picks the workspace, and its
memory picks the view. The desktop differs in three ways, all in `apps/desktop/src/client/App.tsx`. An
address that already names a place wins, which keeps a reload where it was. The restore waits for the
Node's own answer to its preferences unless the Node is known to be offline, because the first value is
the persisted cache, written at most every five seconds. And the place opens only after the whole
restore, because opening a task with no layout in memory would give it a default one.
