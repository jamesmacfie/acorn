# Frontend

The renderer is a SolidJS application bundled into the Electron desktop. It loads from
`app://acorn`; it does not run from a Node origin and cannot make direct network requests.

## Composition

`apps/desktop/src/app/client/index.tsx` creates the renderer runtime and mounts `App.tsx`. The
runtime installs the client plugin host, scoped persistence, query clients, broker event handling,
notification sources, and the shell registries before rendering.

`App.tsx` composes the top bar, TabRail, main view, task view, notices, overlays, Node gate, and
appearance. It selects a Node-aware cache scope and keys task content by Node/task identity so a
switch disposes the previous task scope.

## Registries and plugins

The client plugin host activates `apps/desktop/src/app/client/plugins.ts`. Plugins register panes,
rail sources, settings pages, shell/task slots, palette rows, context sections, ref panels, agent
contexts/renderers, pollers, persisted-state slices, Node stats, and attention sources. The host owns
the returned disposables so a plugin can be disabled and reactivated without duplicate entries.

The shell imports no feature UI directly. `App.tsx`, `TaskView.tsx`, and `CommandPalette.tsx` consume
registry entries and client-core contracts. A feature that needs native behavior uses typed
`window.acorn` capabilities through client-core; plugins do not import Electron.

## Node data access

`packages/client-core/src/apiClient.ts` uses route builders and response types from
`@acorn/protocol/api.ts`. In the desktop it calls `window.acorn.nodeFetch(nodeId, request)`, which
Electron main sends through the pinned broker. The standalone server can be tested with a direct
fetch client, but it does not provide a renderer shell.

TanStack Query is the server-data cache. There is one QueryClient/persister scope per Node. Query
keys do not need an ad hoc Node prefix because the cache itself is partitioned. Fleet queries fan out
per Node and must not write aggregate shapes into ordinary per-Node keys.

## Connection and freshness UI

The broker exposes `online`, `degraded`, `offline`, `incompatible`, and `revoked`. Client-core maps
these plus query state to `live`, `refreshing`, `stale`, `offline`, `disabled`, and `error` displays.
Offline reads use cached values with a Node badge; mutations fail fast and retain drafts.

The event client tracks per-connection sequence numbers and reconnects with backoff. A gap, heartbeat
failure, or Node restart marks the scope stale and refetches active queries. Feature streams render
attached/disconnected state independently of whether a process is still alive.

## Shell state

The TabRail is source → workspace → task. The main region can show Fleet home, a source, or the active
task. Task panes are an ordered/resizable row with persisted widths, pinning, and layout recipes.
The terminal drawer is a task surface and is available when the desktop terminal capability exists.

Overlays are shell-owned: command palette, settings, onboarding, notices, confirmations, and secret
entry are not rendered by arbitrary pane content. Native preview views are positioned by the main
process over a renderer pane host and hidden while overlays cover them.

## Restore and persistence

Launch restore proceeds in this order: fleet membership and Node records, active Node, selection and
main view, task, task layout, and pane-local state. Missing Nodes and unknown pane IDs render repair
states rather than throwing.

Device presentation preferences include theme, style pack, keybindings, and layout. Node preferences
include operational settings and setup state. Draft text remains client-local and is not treated as
successful server state. Secret fields are never persisted in renderer storage.
