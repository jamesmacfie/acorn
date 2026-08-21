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
| `editor` | 50 | worktree editor, with find-in-files as a sidebar panel |
| `database` | 70 | loaded database pane; a host-drawn SQL editor over the plugin's own result grid |
| `docker` | 75 | task container surface |
| `http` | 76 | loaded HTTP frame; API request client for this task |
| `preview` | 80 | browser preview |
| `linear` | 90 | loaded Linear frame; linked issue, selected descriptor row, or content-link target |
| `rollbar` | 100 | loaded Rollbar frame; linked item or selected descriptor row |

Compiled provider panes appear when their linked provider is connected and the task has relevant data.
The four loaded ones — `database`, `http`, `linear` and `rollbar` — are frame surfaces declared in a
manifest, which has no form for either condition: they are offered whenever the plugin is running on the
node the window is talking to, and a task with nothing linked gets the frame's own empty state.

`database` is the one COMPOSED pane: its manifest declares a `document-over-frame` layout, so the host
draws the SQL editor and the drag handle and the plugin's frame draws everything below them. To the
layout model it is still one pane with one id, which is the point — the reader has one rectangle, and
the split inside it is not something a task layout knows about (`docs/plugins.md` § Document surfaces).

Two of those plugins also declare a PROJECT-scoped pane, which is not in this table because it is not
part of a task's layout: `http-project` and `linear-issue` are drawn beside their plugin's rail list at
`/p/:projectId`, addressed by a manifest route under `/p/:projectId/x/<plugin-id>/`. They exist because a
rail row click often has no task, and `openPane` needs one.

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
*any* installed provider's panel. One at a time: opening a second replaces the first. `openRefPanel`
refuses and returns `false` rather than opening the panel when the named provider has no registered
contribution: a claim can arrive from a plugin-supplied recognizer or from another plugin naming a
provider it does not own, and opening anyway would leave the shell showing an empty overlay with no
dismiss affordance. A refusal is not a dead end; the caller's next rung, such as the real browser URL,
is still there.

Any reference panel can offer a "find or create a task for this" action through one shared,
host-drawn component (`client-core/registries/RefPanelTaskLink.tsx`), instead of each panel drawing
its own. Creating a task is a core write that makes a worktree on disk and needs `core.tasks:write`;
a plugin drawing this button itself would have to hold that permission for everything it ever does,
just to earn one click. The host draws the button and does the write instead, and the same component
works whether the host wraps the panel (a loaded plugin's `refPanel` frame) or the panel draws its own
chrome (a first-party panel), so the logic lives in one place rather than two that can drift.

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

A pane contribution has no `freshness` hook of its own. A pane's query status can only be read
reactively, so a `freshness(task)` field returning a plain value would render a badge that never
updates after the first read; making it reactive would mean either a query subscription per pane
inside the host's render loop, or every pane publishing a signal it does not otherwise need. What the
host renders instead is the Node's own connection state, which is already reactive and is the
live/refreshing/stale/offline/error vocabulary `docs/ui-design.md` § States describes. A pane that
wants to say more about its own data draws it in its own header, where the query is already in scope.

Find-in-files is backed by a ripgrep subprocess, not an editor feature, and that is not a stopgap:
Monaco is an editor component with no filesystem or process access, so it provides find-within-a-file
and nothing wider. Every editor that offers project-wide search — including the one Monaco was
extracted from — implements it exactly this way. Replacing the subprocess with an editor feature is
not available.

What did change is where the results are shown. Find-in-files was its own rail pane and is now a panel
in the editor pane's sidebar, beside the file tree, the way VS Code's sidebar works: a result click
already opened a file in the editor, so as two panes it was a cross-pane hop for one mental model
("find something in this project, open it"). The route, the ripgrep runner and the byte-offset
conversion are untouched. `⌘⇧F` and the "Find in files…" palette row now open the editor pane with the
search panel focused, through a retained `editor:search` pane intent — that entry point had to survive
the fold, because otherwise searching would start with "open the editor first". Tree and search stay
mounted together, so flipping between them keeps a query, its results and the tree's open folders.

## Data and actions

Pane reads use the active Node's typed API client and TanStack Query cache. Pane writes target the
task's owning Node. Offline reads remain visible as stale; mutations fail fast and retain local text.
Preview and loaded-plugin `webview` panes are backed by main-owned `WebContentsView`s. Plugin pages
use manifest host allowlists and isolated ephemeral sessions and have no CDP access; terminal and
agent panes use the Node event/stream socket.
