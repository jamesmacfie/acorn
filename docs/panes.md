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
([docs/plugins.md § The tree contract](./plugins.md)). A `frame` region is still available for a surface that owns
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
[@acorn/protocol/paneLayouts.ts](../packages/protocol/src/paneLayouts.ts).

**Which components draw them is the host package's,** the same way `KIT_COMPONENTS` is: the desktop's
are in `client-core/src/host/layouts` and the terminal's are in `apps/tui/src/layouts`, and a host
hands its table to `client-core/src/host/layouts/table.ts` before the first pane draws. The pane
registry used to name the desktop's table directly, which meant a declared layout came back as a
component only one host could mount.

**Eight names, seven components**, and the mismatch is deliberate: `document-over-frame` and
`frame-beside-document` are the same two regions with the axis flipped, so one component draws both.
Position is in the name rather than in a prop precisely so that it is never a knob a plugin turns.
Counts elsewhere in the docs are of the eight names.

Each layout carries three renderings: the desktop one and the **terminal** one, both built, plus a
**narrow** projection for a mobile PWA, written down and not built. Writing them is
the layout's half of the kit's admission rule
([docs/ui-design.md § The closed kit](./ui-design.md#the-closed-kit)): a layout earns a name when two
or more surfaces need it and cannot be expressed in the ones that exist, its regions are semantic
names rather than positions, and both projections are on this page before it lands. A knob is never
the answer; a new named layout is.

| Layout | Regions | Desktop | Narrow | Terminal |
| --- | --- | --- | --- | --- |
| `single` | `body` | one region, the pane's padding and focus group | unchanged | one frame, titled with the pane's name |
| `list-detail` | `list`, `detail`, optional `list-header`, `list-footer` | two columns, host-drawn split and drag handle; the list width is a style token | one region at a time: selecting in the list pushes the detail, and a back affordance returns | as narrow below 80 columns, two columns above it; a key switches groups. Two frames, `List` and `Detail`, and the header and footer strips stay inside the list's |
| `header-body-footer` | `header`, `body`, `footer`, all optional, so `header-body` is this layout with no footer | body scrolls, header and footer pinned | unchanged; the footer stays pinned | the body is framed and titled with the pane's name; the two pinned strips are bare, because a frame round one line is three rows of chrome |
| `tabs` | one `panel:<tab id>` per entry in `tabs`; the host draws the bar | the bar, then one panel at a time | the bar scrolls horizontally | the bar is one line; the panel is framed and titled with the open tab |
| `document-over-frame` | `document`, `frame` | a host-owned editor over a plugin region, with the handle between | the frame region collapses to a sheet the document can summon | both halves, each framed; the document is a host text view, read-only for now |
| `frame-beside-document` | the same two, with the axis flipped by the name rather than by a prop | side by side | as `document-over-frame` | the same |
| `stack-split` | `top`, `bottom` | two stacked regions with a handle | `bottom` becomes a full-height sheet | native, as on desktop, each region framed |
| `wizard` | `step`; the host draws the indicator and the back and next controls | one step at a time | unchanged | the step is framed and titled with the pane's name |

**Every terminal region draws a frame, and no rule between two of them.** A frame carries the region's
name in its top border and lights while the keys are inside it, which is what a landmark's label and
`:focus-within` do on the desktop. Two frames meeting already draw a line, so the rules that used to
separate regions are gone. Frames go one level deep only: the region is framed, the pane around it is
not ([docs/tui.md](./tui.md) § The screen).

Every region is a focus group: one chord moves between them, focus inside one is roving, and each
remembers the node it was last on
([docs/command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md)). The task layout row is
the outermost group.

A region may hold a `Slot` node, and a region may itself be a slot. The one layout rule that adds:
**a rectangle slot is a sibling region, never a child of another region's iframe**, and its position
is the region name — `pane.inline-below` is a `header-body-footer` footer, `pane.inline-beside` is a
`list-detail` detail ([docs/plugins.md § Cooperative extension points](./plugins.md)).

**Nothing in a layout reads the window width.** Breakpoints are style tokens so a mobile shell can set
them, and a drag clamps against the layout's own element (`shell.css` § Layouts). The terminal keeps
the same rule against the terminal's own size: a layout asks its own box how wide it turned out, and
`SIGWINCH` is the renderer's alone.

**Every handle is a key in a terminal**, because there is no grip to drag: the primary modifier with
Shift and an arrow moves a split, and the position is kept in the same host-owned session signal the
desktop's drag writes to. That is why `SplitHandle` and `SplitCell` are `absent` in the support
matrix — the handle is not a node there.

One projection changed on contact, in terminal phase 2. `document-over-frame` and
`frame-beside-document` were written as "the frame region is a rectangle and is absent, so the
document half fills the pane". That was drawn before it was clear what a `frame` region holds: a
loaded plugin's *tree*, which draws in cells like any other. What cannot cross is an iframe's pixels,
and a frame region is not one. Both halves are drawn.

**The host owns a region's inset.** A region's contents are a plugin's tree, and the kit takes no
`class`, so a chip row or a composer sitting flush against the pane's border is the one thing a plugin
cannot fix from inside. Every region that holds content takes the pane's inline padding: the scrolling
bodies of `single`, `header-body-footer` and `tabs`, both pinned strips of `header-body-footer`, and
`list-detail`'s detail column. Three kinds of child take it back, because they are edge-to-edge by
nature: a `Toolbar` or a `Tabs` strip, which carry that padding themselves and have a background that
has to reach the pane's edge; a `ListDetail`, whose divider is its columns' shared edge and whose
columns pad themselves; and a diff, which is a canvas.

`list-detail`'s detail column also takes a small pad below its last child and a gap between its
children, because the child at the bottom of it is a composer or a row of actions: without them the
agents composer sat on the pane's bottom border with the transcript touching it from above. A
`ListDetail` or a diff drops both along with the inline padding.

**The reading column stops at `--pane-measure`** and sits in the middle of whatever the pane has
left. A pane is as wide as the display someone gave it, and at 3700px an agent transcript ran to
about 480 characters a line. Two children are exempt. Chrome is, because a bar's background has to
reach the pane's edge whatever the measure is, so a `Toolbar` and a `Tabs` strip stay full-bleed.
So is a scroller: the cap goes on the list inside it rather than on the scroller itself, because a
narrowed scroller leaves a dead gutter on each side that the wheel does nothing over.

The host keeps the per-pane state a layout needs, under the pane ID: which tab a `tabs` pane is
showing, where a `list-detail` or `stack-split` handle sits. It is session-only, because it is a
reading posture rather than a preference.

A pane whose panels point at each other can say which tab it means, through `selectPaneTab` on
`@acorn/plugin-api/ui/host`. That is the only door to the selection, so a pane still never keeps a
second copy of it.

A pane may also hide a region, which drops it and gives the space to what is left. Notes uses this for
its library column, and it is the same mechanism the narrow projections need.

A region is a component, not an element, so a layout that draws one region at a time mounts only that
one. Regions of the same pane are mounted independently, which means anything two of them share has to
outlive either. Collapsing a library must not take the note being edited with it, and switching from
Overview to Files must not lose the pull request the reader had chosen.

The host holds that shared thing. A compiled pane declares a `model` beside its regions, and the host
builds it once per task inside its own reactive root, hands it to every region, and disposes it when
the task is evicted (`client-core/src/host/registries/panes/paneModels.ts`):

```ts
ctx.panes.register({
  id: 'notes', label: 'Notes', order: 30,
  layout: 'list-detail',
  model: (task) => createNotesModel(task.id, task.projectId),
  regions: { list: NotesList, detail: NoteBody },   // each region is handed { task, model }
})
```

A loaded plugin needs nothing added for this. Its regions are entries in one bundle running in one
worker, so module scope inside that bundle already is the shared thing: `mountTree({ list, detail })`,
and a model held beside them. The API pane is the worked example
(`plugins/http/src/tree/panelModel.ts`).

The seam exists because four compiled panes had each hand-rolled the same per-task root map, which is
the admission rule's own test. A pane whose regions share nothing omits `model` and its regions are
handed `undefined`.

The PR pane still keeps two maps of its own. One is keyed by the pull request, because a task can be
about several; the other is keyed by the task but holds a live subscription that must outlive the
pane's own mounts. Neither is a copy of this seam waiting to be deleted; if a third appears with a
task-shaped key and nothing to subscribe to, it belongs here.

**A split inside a region is the plugin's.** A pane's regions are its *outer* arrangement; a `ListDetail`
drawn inside one region is a different object with a different owner, which is why `ListDetail` and
`DocumentTabs` are kit nodes as well as layout names. The PR pane is a `single` layout whose one region
is a kit `Sections` — the pull request's own parts beside its diff, the same node the GitHub browse
surface draws — and that is correct rather than a pane that should have named `list-detail` or `tabs`.
The parts are one surface over one model, not regions the host mounts apart.

`Sections` is where that distinction pays. A pane layout is arranged by the host and its regions are
named by the pane contribution, so a surface that wants a different arrangement per host but the same
regions everywhere has to be a layout — except a browse source's detail region is not a pane and cannot
name one. So the shape is a kit node instead, and both call sites reach it: the desktop draws a header
over a column of folds beside the main region, and the terminal draws a strip of tabs over one panel
([ui-design.md § The closed kit](./ui-design.md)).

The node takes its two columns two ways, and both matter. A caller with an element to spare passes the
left one as `list`; a caller that cannot — a remote tree, whose props are JSON on a message port —
passes a `ListColumn` and a `DetailColumn` as children and sets `split`. Below 80 columns the first form
draws the detail alone, and the second stacks its two children, because the node has no keys of its own
to switch with and two columns of 38 cells is a column nobody can read.

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
its own registry (`client-core/host/registries/panes/projectSurfaces.ts`) so those consumers do not have to
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
(`client-core/host/registries/panes/refPanels.ts`). The shell holds which ref is open and draws it in one place,
so any surface that renders content can call `openRefPanel({ providerId, displayId })` and get any
installed provider's panel. One at a time: opening a second replaces the first. When the named
provider has no registered contribution, `openRefPanel` returns `false` instead of opening. A claim
can arrive from a plugin-supplied recognizer or from another plugin naming a provider it does not
own, and opening anyway would leave the shell showing an empty overlay with no dismiss affordance. A
refusal is not a dead end, because the caller's next fallback, such as the real browser URL, is still
there.

Any reference panel can offer a "find or create a task for this" action through one shared,
host-drawn component (`client-core/host/components/RefPanelTaskLink.tsx`), instead of each panel drawing
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
see `docs/plugins.md` § "The client half of a loaded plugin".

## Contributions

Each pane contributes its ID, label, order, default chord, minimum width, and optional availability
predicate through `paneRegistry`. It then draws itself one of two ways: with a `component`, or with a
`layout` and a `regions` record, in which case the registry builds the component. A pane may also
register palette rows, commands and keybindings, persisted state, and contributions to another
plugin's extension points, through its plugin.

```ts
ctx.panes.register({
  id: 'notes', label: 'Notes', glyph: 'notepad-text', order: 30,
  layout: 'list-detail',
  regions: { 'list-header': NotesHeader, list: NotesList, detail: NoteBody },
  hidden: (task) => (libraryCollapsed(task.id) ? ['list'] : []),
})
```

A loaded plugin declares the same two keys on a `frames` entry, and it has to: `layout` is required on
a `pane`, a `refPanel` and a `settings` surface. Omitting it used to mean "the whole surface is my
iframe", and that implicit path is gone. A surface that wants pixels says so with a `frame` region.

A region is one of three things:

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

A reference panel and a settings page name `layout: 'single'` and nothing wider: the host already draws
the box, the backdrop, the title and the dismiss for one and the settings page frame for the other, so
all that is left is one region. Naming it is how such a surface says whether its body is a tree or a
rectangle.

The three surfaces the host wraps entirely take no layout: an `overlay` is a full-screen picker, an
`importer` is a wizard the plugin owns, and a `coreSlot` replaces one of core's own surfaces outright.
Each is a rectangle by construction, with no arrangement to name and no second region to put anything
in.

A layout naming a region it does not have, or missing one it requires, throws at registration rather
than at render. The manifest parser refuses the same thing on the node, and the client repeats the
check over the roster row, because a manifest reaches a device as bytes a node sent.

Shared diff rendering, the editor surface, markdown, grid, xterm, form, and wizard primitives live in
client-core. Feature panes use those primitives without importing another plugin's implementation.

A pane contribution has no `freshness` hook of its own. A pane's query status can only be read
reactively, so a `freshness(task)` field returning a plain value would render a badge that never
updates after the first read; making it reactive would mean either a query subscription per pane
inside the host's render loop, or every pane publishing a signal it does not otherwise need. What the
host renders instead is the Node's own connection state, which is already reactive and is the
live/refreshing/stale/offline/error vocabulary `docs/ui-design.md` § States describes. A pane that
wants to say more about its own data draws it in its own header, where the query is already in scope.

A pane button in the right rail can still carry status markers, and that is not the same seam. A
marker comes from `features/tabs/railMarkers.ts`, which asks a plugin about a target it names — a task, a
rail source, or a pane — and gets marker *data* back
([ui-design.md § Rail controls and status markers](./ui-design.md)). The callback runs inside the
rail's own render, so it costs no subscription the plugin does not already hold, and it is for state
the plugin owns anyway rather than for the query status of the pane's own fetch.

Find-in-files is backed by a ripgrep subprocess, not an editor feature, and that is not a stopgap.
An editor component has no filesystem or process access, so it provides find-within-a-file and
nothing wider. Every editor that offers project-wide search implements it this way. There is no
editor feature to replace the subprocess with.

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
