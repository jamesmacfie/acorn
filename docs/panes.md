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
| `database` | 70 | loaded database tree; a host-drawn SQL editor over the plugin's own result grid |
| `docker` | 75 | task container surface |
| `http` | 76 | loaded HTTP tree; API request client for this task |
| `preview` | 80 | browser preview |
| `linear` | 90 | loaded Linear tree; linked issue, selected descriptor row, or content-link target |
| `rollbar` | 100 | loaded Rollbar tree; linked item or selected descriptor row |

Compiled provider panes appear when their linked provider is connected and the task has relevant
data. The four loaded ones, `database`, `http`, `linear`, and `rollbar`, are declared in a manifest and
offered whenever the plugin is running on the node the window is talking to. All four draw **trees**:
their code runs in a worker and emits a tree of the host's own components, which the host mounts, so
they inherit its focus behaviour, keys, ARIA and appearance pack and ship no stylesheet of their own
(`docs/future/layout/06-remote-tree.md`). A `frame` region is still available for a surface that owns
its pixels; none of the four needs one. A task
pane whose manifest also names a `providerId` (`linear` and `rollbar` do) is a linked-items view, and
the host hides it on tasks with no link from that provider. `database` and `http` are useful with
nothing linked and stay unconditional.

`database` is the one composed pane. Its manifest declares a `document-over-frame` layout with a
`document` region and a `frame` region, so the host draws the SQL editor and the drag handle and the
plugin draws everything below them. The lower region names a `remote` entry rather than `'frame'`, so
both halves of that pane are now host-drawn components; the region keeps the name the layout gave it. To the task layout row it is one pane with one id, which
is the point: the reader has one rectangle, and the row knows nothing about the split inside it
(`docs/plugins.md` § Document surfaces).

Two of those plugins also declare a project-scoped pane, which is not in this table because it is not
part of a task's layout. `http-project` and `linear-issue` are drawn beside their plugin's rail list
at `/p/:projectId`, addressed by a manifest route under `/p/:projectId/x/<plugin-id>/`. They exist
because a rail row click often has no task, and `openPane` needs one.

## Layout model

There are two layers of layout, and they answer different questions.

**The task layout row** is the persisted list of pane IDs, optional relative weights, and pinned IDs.
The layout reducer owns show/add, close/unpin, pin, move, resize, equalize, maximize, and recipe
replacement. Pinned panes survive a switcher selection; a normal selection focuses the target. Closing
the last unpinned pane falls back to the PR pane when one is available.

Widths are clamped to pane minimums and normalized on load. Unknown IDs become placeholders so a
disabled plugin or a stale layout cannot crash the task view. Maximize/focus is session UI state and
does not rewrite the durable row.

**Inside a pane** the host owns the arrangement. A pane names one of the layouts below and supplies a
component per region; it never draws the split, the divider, or the drag handle itself. The names and
each layout's region set are in
[@acorn/protocol/paneLayouts.ts](../packages/protocol/src/paneLayouts.ts), the components are in
`client-core/src/layouts`, and the desktop rendering plus the narrow and terminal projections are in
[docs/future/layout/05-layouts.md](./future/layout/05-layouts.md).

| Layout | Regions |
| --- | --- |
| `single` | `body` |
| `list-detail` | `list`, `detail`, and optionally `list-header` and `list-footer` |
| `header-body-footer` | `header`, `body`, `footer`, all optional, so `header-body` is this layout with no footer |
| `tabs` | one `panel:<tab id>` per entry in `tabs`; the host draws the bar |
| `document-over-frame` | `document`, `frame` |
| `frame-beside-document` | the same two, with the axis flipped by the name rather than by a prop |
| `stack-split` | `top`, `bottom` |
| `wizard` | `step`; the host draws the indicator and the back and next controls |

Position is in the name, never in a knob. A surface that needs an arrangement none of these expresses
gets a new named layout, and it has to state its regions and both projections before it lands.

The host keeps the per-pane state a layout needs, under the pane ID: which tab a `tabs` pane is
showing, where a `list-detail` or `stack-split` handle sits. It is session-only, because it is a
reading posture rather than a preference.

A pane may also hide a region, which drops it and gives the space to what is left. Notes uses this for
its library column, and it is the same mechanism the narrow projections need.

A region is a component, not an element, so a layout that draws one region at a time mounts only that
one. Regions of the same pane are mounted independently, which means anything two of them share has to
outlive either. Notes, Context and Changes each hold that shared state in a reactive root keyed by task,
built on first ask and disposed when the task is evicted. Collapsing a library must not take the note
being edited with it.

A wizard is the one arrangement a non-pane surface can reach for. Onboarding is a component in the
`overlay` slot rather than a pane, so it imports `Wizard` from `@acorn/plugin-api/ui/host` and fills its
`step` region. Every other surface names a layout on its contribution and never imports one.

## Addressing a pane

A task's URL is `/t/:taskId` and stays that way. The layout is a row with focus and maximise state,
and a URL that tried to own it would be wrong the moment the owner moved a pane. What is addressable
is what `PaneIntent` already models: `/t/:taskId?pane=<paneId>&item=<id>` opens that pane on that
item.

The params are consumed once and stripped (`tasks/taskDeepLink.ts`), because the layout restores
itself from its own persisted state and a lingering `?pane=` would keep asserting a view the owner
has left. An unknown pane id is rejected rather than dispatched, so a bad link cannot push a
placeholder into the durable layout. Every pane gets this without contributing a route.

## Pane scope

Everything above is a _task-scoped_ pane, which is what a pane means unless something says
otherwise. A loaded plugin may also declare a _project-scoped_ pane (`"scope": "project"` in its
manifest). That is a different thing wearing the same rectangle. It is drawn beside its own rail
Source's list at `/p/:projectId`, it has no task, and it never enters a task layout, so none of the
layout model, `?pane=` and `?item=` addressing, or `paneRegistry` above applies to it. It lives in
its own registry (`client-core/registries/projectSurfaces.ts`) so those consumers do not have to
branch on a scope they cannot act on.

It has no layout state to keep a selection in, so its selection lives in the URL: one route per
surface, confined to the host-minted `/p/:projectId/x/<plugin-id>/` prefix. That makes a clicked rail
row, a pasted link, and the back button the same mechanism. The task-scoped verb (`openPane`) and the
project-scoped one (`navigate`) name disjoint sets of surfaces, checked when the manifest is parsed,
so neither can reach a surface it could only fail on. For more information, see `docs/plugins.md`.

## Not a pane: the reference panel

A _reference panel_ is the other thing a plugin's item can open into, and it is deliberately none of
the above: no layout entry, no `PaneId`, no `?pane=` address, nothing persisted. It is one item shown
over whatever the reader was already looking at, and it is dismissed rather than closed. A plugin
contributes one keyed by the provider whose items it renders and may only name its own provider
(`client-core/registries/refPanels.ts`). The shell holds which ref is open and draws it in one place,
so any surface that renders content can call `openRefPanel({ providerId, displayId })` and get any
installed provider's panel. One at a time: opening a second replaces the first. When the named
provider has no registered contribution, `openRefPanel` returns `false` instead of opening. A claim
can arrive from a plugin-supplied recognizer or from another plugin naming a provider it does not
own, and opening anyway would leave the shell showing an empty overlay with no dismiss affordance. A
refusal is not a dead end, because the caller's next fallback, such as the real browser URL, is still
there.

Any reference panel can offer a "find or create a task for this" action through one shared,
host-drawn component (`client-core/registries/RefPanelTaskLink.tsx`), instead of each panel drawing
its own. Creating a task is a core write that makes a worktree on disk and needs `core.tasks:write`;
a plugin drawing this button itself would have to hold that permission for everything it ever does,
to earn one click. The host draws the button and does the write instead, and the same component works
whether the host wraps the panel (a loaded plugin's `refPanel` frame) or the panel draws its own
chrome (a first-party panel), so the logic lives in one place rather than two that can drift.

The pair matters because a content link has both destinations available and they answer different
questions. The pane is "show me this provider's items for this task": richer, and it costs the reader
the rectangle they were using. The panel is "let me glance at this one thing": it needs no task, so
it also works in classic browse and beside a rail list, and it keeps the reader's place. Which one a
click gets is the clicking surface's preference, with the other as fallback. For more information,
see `docs/plugins.md` § "Loaded plugins: the client half".

## Contributions

Each pane contributes its ID, label, order, default chord, minimum width, and optional availability
predicate through `paneRegistry`. It then draws itself one of two ways: with a `component`, or with a
`layout` and a `regions` record, in which case the registry builds the component. A pane may also
register context sections, task slots, palette rows, commands/keybindings, agent-tool renderers, and
persisted state through its plugin.

```ts
ctx.panes.register({
  id: 'notes', label: 'Notes', glyph: 'notepad-text', order: 30,
  layout: 'list-detail',
  regions: { 'list-header': NotesHeader, list: NotesList, detail: NoteBody },
  hidden: (task) => (libraryCollapsed(task.id) ? ['list'] : []),
})
```

A loaded plugin declares the same two keys on a `frames` entry, and a region there is one of three
things:

| Region | What fills it |
| --- | --- |
| `{ "kind": "remote", "entry": "pane" }` | A tree the plugin's bundle emits from a worker, named by a key of the object it passed to `mountTree`. The host mounts its own components for it. |
| `"frame"` | The plugin's own bundle in a sandboxed iframe, drawing its own pixels. |
| `{ "kind": "document", "read": "/v2/p/<id>/…" }` | A host-drawn editor. The plugin contributes routes and a language id, and no code at all. |

A pane whose regions are all documents runs none of the plugin's code, so it is gated like a descriptor
rather than behind the bytes-hash prompt. A `remote` region is gated exactly as a `frame` one is: the
tree path changes where a plugin's bytes run, not whose they are.

```json
"frames": [{
  "target": "pane", "id": "database", "label": "Database",
  "layout": "document-over-frame",
  "regions": {
    "document": { "kind": "document", "languageId": "sql", "read": "/v2/p/database/tasks/:taskId/scratch" },
    "frame": { "kind": "remote", "entry": "panel" }
  }
}]
```

A reference panel and a settings page may name `layout: 'single'` too, and nothing wider: the host
already draws the box, the backdrop, the title and the dismiss for one and the settings page frame for
the other, so all that is left is one region. Naming it is how such a surface says its body is a tree.

A layout naming a region it does not have, or missing one it requires, throws at registration rather
than at render. The manifest parser refuses the same thing on the node, and the client repeats the
check over the roster row, because a manifest reaches a device as bytes a node sent.

Shared diff rendering, Monaco setup, markdown, grid, xterm, form, and wizard primitives live in
client-core. Feature panes use those primitives without importing another plugin's implementation.

A pane contribution has no `freshness` hook of its own. A pane's query status can only be read
reactively, so a `freshness(task)` field returning a plain value would render a badge that never
updates after the first read; making it reactive would mean either a query subscription per pane
inside the host's render loop, or every pane publishing a signal it does not otherwise need. What the
host renders instead is the Node's own connection state, which is already reactive and is the
live/refreshing/stale/offline/error vocabulary `docs/ui-design.md` § States describes. A pane that
wants to say more about its own data draws it in its own header, where the query is already in scope.

A pane button in the right rail can still carry status markers, and that is not the same seam. A
marker comes from `registries/railMarkers.ts`, which asks a plugin about a target it names — a task, a
rail source, or a pane — and gets marker *data* back
([ui-design.md § Rail controls and status markers](./ui-design.md)). The callback runs inside the
rail's own render, so it costs no subscription the plugin does not already hold, and it is for state
the plugin owns anyway rather than for the query status of the pane's own fetch.

Find-in-files is backed by a ripgrep subprocess, not an editor feature, and that is not a stopgap.
Monaco is an editor component with no filesystem or process access, so it provides find-within-a-file
and nothing wider. Every editor that offers project-wide search, including the one Monaco was
extracted from, implements it this way. There is no editor feature to replace the subprocess with.

The results are a panel in the editor pane's sidebar, beside the file tree. A result click opens a
file in the editor, so a separate rail pane made one mental model ("find something in this project,
open it") into a cross-pane hop. `⌘⇧F` and the "Find in files…" palette row open the editor pane with
the search panel focused, through an `editor:search` pane intent. Keep that entry point, or searching
starts with "open the editor first". Tree and search stay mounted together, so flipping between them
keeps a query, its results, and the tree's open folders.

## Data and actions

Pane reads use the active Node's typed API client and TanStack Query cache. Pane writes target the
task's owning Node. Offline reads remain visible as stale; mutations fail fast and retain local text.
Preview and loaded-plugin `webview` panes are backed by shell-owned child webviews. Plugin pages use
manifest host allowlists and isolated ephemeral data stores, and have no debugger access. Terminal
and agent panes use the Node event and stream socket.
