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
| `linear` | 90 | linked Linear issue |
| `rollbar` | 100 | loaded Rollbar frame; linked item or selected descriptor row |

Provider-gated panes appear when their linked provider is connected and the task has relevant data.

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
