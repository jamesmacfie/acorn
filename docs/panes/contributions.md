# Pane contributions

This page covers what a pane contribution declares, for compiled and loaded plugins. Read it before
you register a pane or add a field to the contract. It's part of [panes](../panes.md).

## Contributions

Each pane contributes its ID, label, order, default chord, minimum width, and an optional
availability check through `paneRegistry`. It then draws itself in one of two ways: with a
`component`, or with a `layout` and a `regions` record, in which case the registry builds the
component. Through its plugin, a pane can also register palette rows, commands and keybindings,
persisted state, and contributions to another plugin's extension points.

```ts
ctx.panes.register({
  id: 'notes', label: 'Notes', glyph: 'notepad-text', order: 30,
  layout: 'list-detail',
  regions: { 'list-header': NotesHeader, list: NotesList, detail: NoteBody },
  hidden: (task) => (libraryCollapsed(task.id) ? ['list'] : []),
})
```

### Hidden and collapsible regions

`hidden` drops a region outright. `collapsible`, on a `list-detail` pane, keeps the column and
narrows it to the width of the icon rails, with each row shown as one mark. It's opt-in, because the
pane has to do the second half: read the same signal
(`packages/client-core/src/kit/lib/layout/collapseState.ts`) and pass each `Row` a `collapsed` slot.
A pane that collapses without doing that gets full-width rows clipped mid-word. A pane drawn from a
remote tree can't read a host signal from its worker, so it leaves the flag off and keeps a column
that resizes but doesn't collapse. See [two-column panes](../ui-design/two-column-panes.md#two-column-panes).

### Archived tasks

`readsArchived` says a task pane can draw an archived task. The archive page previews one in the
ordinary pane host and hands each pane a task with `status: 'archived'`. Only panes that set the
flag appear in that preview's layout and switcher. They draw from stored history and turn off
anything that would start work, as the Agent pane does with its composer. It's opt-in, because an
archived task has no worktree. An editor, a diff, a container, or a run target would find nothing,
and a pane that can start work would start it on a task nobody meant to reopen. Agent and Notes set
it ([workspaces and tasks](../workspaces-and-tasks.md) § Restoring a task).

A compiled pane sets `readsArchived: true` on its contribution. A loaded plugin sets the same
optional field on a task-scoped `frames` entry whose `target` is `pane`. It's invalid on a
project-scoped pane or any other frame target. Leaving it out keeps the pane out of archived
previews.

### Availability

A compiled pane hides itself on a task with nothing to draw by giving its contribution a `when`. A
loaded plugin can't ship a function to the host, so its task-scoped `frames` entry names an
`availability` route instead, one of its own under `/v1/p/<id>/`. A GET returns
`{ [taskId]: boolean }` for every active task on the Node, and the pane appears only on a task the
answer marks `true`.

The host reads the route once per Node and keeps the answer in memory
(`packages/client-core/src/host/frames/paneAvailability.ts`), because the pane strip asks `when` on
every draw. It reads again on a project change, an unseen task, a Node switch, a reconnect, window
focus, and every two minutes. Until the first answer arrives, the pane is hidden. A failed read keeps
the last answer, so one dropped request doesn't make the button flicker. A `404` means a package
built before the route existed, and the pane then shows on every task. The route lists every active
task, so it should refuse a task-scoped caller. Answer "is this set up", not "is it running": an
answer that turns false while a dev server restarts closes a pane you're looking at.

## Regions a loaded plugin declares

A loaded plugin declares `layout` and `regions` on a `frames` entry. `layout` is required on a
`pane`, a `refPanel`, and a `settings` surface. A surface that wants pixels says so with a `frame`
region. A region is one of three things:

| Region | What fills it |
| --- | --- |
| `{ "kind": "remote", "entry": "pane" }` | A tree the plugin's bundle emits from a worker, named by a key of the object it passed to `mountTree`. The host mounts its own components for it. |
| `"frame"` | The plugin's own bundle in a sandboxed iframe, drawing its own pixels. |
| `{ "kind": "document", "read": "/v1/p/<id>/…" }` | A host-drawn editor. The plugin contributes routes and a language ID, and no code. |

A pane whose regions are all documents runs none of the plugin's code, so it's gated like a
descriptor, without the bundle-hash prompt. A `remote` region is gated exactly as a `frame` region
is, because the tree path changes where a plugin's code runs, not whose code it is.

```json
"frames": [{
  "target": "pane", "id": "database", "label": "Database",
  "layout": "document-over-frame",
  "regions": {
    "document": { "kind": "document", "languageId": "sql", "read": "/v1/p/database/tasks/:taskId/scratch" },
    "frame": { "kind": "remote", "entry": "panel" }
  }
}]
```

A reference panel and a settings page name `layout: 'single'`. The host already draws the box,
backdrop, title, and dismiss for one and the page frame for the other, so one region is all that's
left. Naming it says whether the body is a tree or a rectangle.

The three surfaces the host wraps entirely take no layout. An `overlay` is a full-screen picker, an
`importer` is a wizard the plugin owns, and a `coreSlot` replaces one of core's own views. Each is a
rectangle with nothing to arrange.

A layout naming a region it doesn't have, or missing one it requires, throws at registration, not at
render. The manifest parser refuses the same thing on the Node, and the client repeats the check on
the plugin list it receives, because a manifest reaches a device as bytes a Node sent.

Shared diff rendering, the editor, markdown, grid, xterm, form, and wizard components live in
client-core. Feature panes use them without importing another plugin's code.

## Prefetch

A pane can declare `prefetch(task, queryClient)`. The task rail calls it when the pointer rests on a
task row for 150 milliseconds (`PANE_PREFETCH_HOVER_MS`), long enough that scrolling the rail fetches
nothing. The rail asks every pane the task could show. It's best effort: it returns nothing, and a
failure only means the first paint isn't instant.

Put the pane's first read in it, and only when that read is a row and not work. The editor warms the
task's checkout path, the request its mount makes before it can draw. The agent pane warms the task's
session list, which its model asks for on open and the store serves from a five-second window. The
changes pane declares none, because its first read starts a `git` process.

A pane contribution has no `freshness` hook. A pane's query status can only be read reactively, so a
plain value would draw a badge that never updates. The host draws the Node's connection state
instead, using the vocabulary in [UI design](../ui-design/states.md) § States. A pane that wants to say more
about its data draws it in its own header, where the query is in scope.

### Rail markers

A pane button in the right rail can still carry status markers through a different seam.
`packages/client-core/src/features/tabs/railMarkers.ts` asks a plugin about a target it names, which
is a task, a rail source, or a pane, and gets marker data back
([UI design](../ui-design/shell-hierarchy.md) § Rail controls and status markers). The callback runs inside the
rail's render, so it adds no subscription the plugin doesn't already hold. It's for state the plugin
owns, not for the status of the pane's own fetch.

## Find in files

Find in files runs a ripgrep process, not an editor feature. An editor component has no file system
or process access, so it can only find within a file. Every editor that offers project-wide search
works this way.

The results are a panel in the editor pane's sidebar, beside the file tree, because a result click
opens a file in the editor. `⌘⇧F` and the **Find in files…** palette row open the editor pane with
the search panel focused, through an `editor:search` pane intent. The tree and the search panel stay
mounted together, so switching between them keeps the query, its results, and the tree's open
folders. The shared sidebar collapses to an empty rail with its panels still mounted. The search and
**Reveal active file** commands expand it so the panel you asked for shows.
