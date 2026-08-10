# Panes

A task is rendered as a flat, ordered row of plugin-contributed panes. `PaneId` is a persisted
string owned by the contribution; core does not maintain a closed union of feature IDs.

## Shipped panes

| ID | Order | Surface |
| --- | ---: | --- |
| `pr` | 10 | linked GitHub pull request |
| `agents` | 15 | managed Agent pane |
| `changes` | 20 | worktree diff and review notes |
| `notes` | 30 | task/workspace/global notes |
| `context` | 40 | context selection and sync |
| `editor` | 50 | worktree editor |
| `search` | 60 | worktree search |
| `database` | 70 | PostgreSQL browser/editor |
| `docker` | 75 | task container surface |
| `http` | 76 | API request client |
| `preview` | 80 | browser preview |
| `linear` | 90 | loaded Linear frame; linked issue, selected descriptor row, or content-link target |
| `rollbar` | 100 | loaded Rollbar frame; linked item or selected descriptor row |

Compiled provider panes appear when their linked provider is connected and the task has relevant data.
The two loaded ones — `linear` and `rollbar` — are frame surfaces declared in a manifest, which has no
form for either condition: they are offered whenever the plugin is running on the node the window is
talking to, and a task with nothing linked gets the frame's own empty state.

## Layout model

The persisted task layout contains pane IDs, optional relative weights, and pinned IDs. The layout
reducer owns show/add, close/unpin, pin, move, resize, equalize, maximize, and recipe replacement.
Pinned panes survive a switcher selection; a normal selection focuses the target. Closing the last
unpinned pane falls back to the PR pane when one is available.

Widths are clamped to pane minimums and normalized on load. Unknown IDs become placeholders so a
disabled plugin or a stale layout cannot crash the task view. Maximize/focus is session UI state and
does not rewrite the durable row.

## Addressing a pane

A task's URL is `/t/:taskId` and stays that way — the layout is a row with focus and maximise state, and a
URL that tried to own it would be wrong the moment the owner moved a pane. What is addressable is the thing
`PaneIntent` already models: `/t/:taskId?pane=<paneId>&item=<id>` opens that pane on that item.

The params are consumed once and stripped (`tasks/taskDeepLink.ts`), because the layout restores itself from
its own persisted state and a lingering `?pane=` would keep asserting a view the owner has since left. An
unknown pane id is rejected rather than dispatched, so a bad link cannot push a placeholder into the durable
layout. Every pane gets this without contributing a route.

## Pane scope

Everything above is a **task-scoped** pane, which is what a pane means unless something says otherwise.
A loaded plugin may also declare a **project-scoped** pane (`"scope": "project"` in its manifest). That
is a different thing wearing the same rectangle: it is drawn beside its own rail Source's list at
`/p/:projectId`, it has no task, and it never enters a task layout — so none of the layout model,
`?pane=`/`?item=` addressing, or `paneRegistry` above applies to it. It lives in its own registry
(`client-core/registries/projectSurfaces.ts`) precisely so those consumers do not have to branch on a
scope they cannot act on.

Because it has no layout state to keep a selection in, its selection lives in the URL — one route per
surface, confined to the host-minted `/p/:projectId/x/<plugin-id>/` prefix — which makes a clicked rail
row, a pasted link, and the back button the same mechanism. The task-scoped verb (`openPane`) and the
project-scoped one (`navigate`) name disjoint sets of surfaces, checked when the manifest is parsed, so
neither can reach a surface it could only fail on. See `docs/plugins.md`.

## Not a pane: the reference panel

A **reference panel** is the other thing a plugin's item can open into, and it is deliberately none of the
above — no layout entry, no `PaneId`, no `?pane=` address, nothing persisted. It is one item shown over
whatever the reader was already looking at, and it is dismissed rather than closed. A plugin contributes
one keyed by the provider whose items it renders and may only name its own provider
(`client-core/registries/refPanels.ts`); the shell holds which ref is open and draws it in exactly one
place, so *any* surface that renders content can call `openRefPanel({ providerId, displayId })` and get
*any* installed provider's panel. One at a time: opening a second replaces the first.

The pair matters because a content link has both destinations available and they answer different
questions. The pane is "show me this provider's items for this task" — richer, and it costs the reader the
rectangle they were using. The panel is "let me glance at this one thing" — it needs no task, so it also
works in classic browse and beside a rail list, and it keeps the reader's place. Which one a click gets is
the clicking surface's preference, with the other as fallback; see `docs/plugins.md` § "Loaded plugins: the
client half".

## Contributions

Each pane contributes its ID, label, order, default chord, minimum width, component, and optional
availability predicate through `paneRegistry`. A pane may also register context sections, task slots,
palette rows, commands/keybindings, agent-tool renderers, and persisted state through its plugin.

Shared diff rendering, Monaco setup, markdown, grid, xterm, form, and wizard primitives live in
client-core. Feature panes use those primitives without importing another plugin's implementation.

Find-in-files is a separate pane backed by a ripgrep subprocess, not an editor feature, and that is
not a stopgap: Monaco is an editor component with no filesystem or process access, so it provides
find-within-a-file and nothing wider. Every editor that offers project-wide search — including the
one Monaco was extracted from — implements it exactly this way. Folding the results UI into the
editor pane would be a reasonable product change; replacing the subprocess with an editor feature
is not available.

## Data and actions

Pane reads use the active Node's typed API client and TanStack Query cache. Pane writes target the
task's owning Node. Offline reads remain visible as stale; mutations fail fast and retain local text.
Preview and loaded-plugin `webview` panes are backed by main-owned `WebContentsView`s. Plugin pages
use manifest host allowlists and isolated ephemeral sessions and have no CDP access; terminal and
agent panes use the Node event/stream socket.
