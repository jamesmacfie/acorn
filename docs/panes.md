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
| `rollbar` | 100 | linked Rollbar item |

Provider-gated panes appear when their linked provider is connected and the task has relevant data.

## Layout model

The persisted task layout contains pane IDs, optional relative weights, and pinned IDs. The layout
reducer owns show/add, close/unpin, pin, move, resize, equalize, maximize, and recipe replacement.
Pinned panes survive a switcher selection; a normal selection focuses the target. Closing the last
unpinned pane falls back to the PR pane when one is available.

Widths are clamped to pane minimums and normalized on load. Unknown IDs become placeholders so a
disabled plugin or a stale layout cannot crash the task view. Maximize/focus is session UI state and
does not rewrite the durable row.

## Contributions

Each pane contributes its ID, label, order, default chord, minimum width, component, and optional
availability predicate through `paneRegistry`. A pane may also register context sections, task slots,
palette rows, agent-tool renderers, and persisted state through its plugin.

Shared diff rendering, Monaco setup, markdown, grid, xterm, form, and wizard primitives live in
client-core. Feature panes use those primitives without importing another plugin's implementation.

## Data and actions

Pane reads use the active Node's typed API client and TanStack Query cache. Pane writes target the
task's owning Node. Offline reads remain visible as stale; mutations fail fast and retain local text.
The preview pane is backed by a main-owned `WebContentsView`; terminal and agent panes use the Node
event/stream socket.
