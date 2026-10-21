# Pane models

This page covers the state a pane's regions share, how long the host keeps it, and why panes have no
`keepAlive`. Read it before you give a pane state that two regions, or two mounts, need. It's part
of [panes](../panes.md).

## Pane models

Regions of one pane mount independently, so anything two of them share has to outlive both.
Collapsing the Notes library mustn't take the open note with it, and switching from Overview to Files
mustn't lose the pull request you'd chosen.

The Changes tab shows why. You type the commit message in the `list-footer`, and below 80 columns
`list-detail` shows one side at a time. Typing half a message and then looking at the diff unmounts
the field. So the draft lives on the pane's model, above every region
(`plugins/git/src/client/changes/commitState.ts`). The two commit chords are registered there too,
because a shortcut that comes and goes with a column isn't a shortcut.

The host holds the shared state. A compiled pane declares a `model` beside its regions. The host
builds one model per pane and task inside a detached reactive root, and shares it across the regions.
It keeps the models of the last few tasks each pane drew, and disposes one when the task falls out of
that list, the task is evicted, or the Node shell retires
(`packages/client-core/src/host/registries/panes/paneModels.ts`):

```ts
ctx.panes.register({
  id: 'notes', label: 'Notes', order: 30,
  layout: 'list-detail',
  model: (task) => createNotesModel(task.id, task.projectId),
  regions: { list: NotesList, detail: NoteBody },   // each region is handed { task, model }
})
```

A pane whose regions share nothing omits `model`, and its regions get `undefined`.

A loaded plugin needs nothing extra. Its regions are entries in one bundle running in one worker, so
module scope inside that bundle is already shared: call `mountTree({ list, detail })` and keep a
model beside them. The API pane is the worked example (`plugins/http/src/tree/panelModel.ts`).

## How long a model lives

The model outlives the pane that asked for it, and the task too. Each pane keeps models for as many
recent tasks as **Keep task state in memory** allows, under Settings > General > Performance. The
choices are 1, 3, 5, or 10, and the default is 5. The setting is a device preference that
`keptTasks` reads straight from `localStorage`. Every use of a model makes its task the most recent.
Building a model for a new task disposes the least recent ones past the limit, and disposing is what
flushes their pending saves. A model also goes when its task is evicted, or when the Node shell or
provider that owns it is destroyed. Closing a pane or unmounting a region keeps the model.

The shell mounts the `PaneModelHost` component inside its selected QueryClient provider. The Node
generation it captures decides whether a model and its drawn marks can be reused. Scope eviction on a
switch retires observers before the incoming shell builds. Late cleanup from an earlier generation
can't release a replacement model or its drawn marks. A builder that throws disposes its partly built
root before a retry.

The host calls `model(task, pane)`, and `pane.shown()` is true only while a mounted pane is drawing
that task. It's false on another task, behind a rail source such as Home, and while the same task
shows a different pane. Several tasks' models are alive at once, so an effect that polls, runs a
timer, re-reads on an event, or marks something as seen reads it first. The agent pane marks sessions
read and acknowledges finished turns only while it's drawn. The Changes tab skips its status poll
while hidden and fetches once when it's drawn again. The Git pane's History and Worktrees queries are
disabled while their tab is hidden, so Git events only mark them stale. The Workflows pane stops its
elapsed clock and owes one re-read for whatever arrived while it was hidden.

A query a model creates passes `enabled: … && pane.shown()`. A disabled observer keeps its cached data,
but it doesn't count as active, so a reconnect, a `ws:shed`, or an invalidation only marks it stale
instead of fetching for a task nobody sees. The agent pane's harness and custom agent lists, the
Changes tab's projects and preferences, and Notes' workspaces read this way. Solid Query has no
`subscribed` option, which is the React adapter's name for the same thing.

A kept model can also hold older data than the Node. A model that reads once, rather than through a
query or a live store, reads again when `shown` turns true. Notes re-reads its lists and the open note
unless that note has unsaved edits, because a note save doesn't check for a newer copy. Context
re-reads its inventory. The editor marks every kept file stale when it mounts again, because nothing
listened for worktree events while it was unmounted.

## Closing and opening again

The model is also what makes a pane cheap to close and open again. A pane that draws itself with one
`component` instead of a layout can use the same holder directly: `paneModel(paneId, taskId, build)`
on `@acorn/plugin-api/client`. The editor does this for its per-file documents. The text, undo
history, and cursor of every open file survive toggling the pane off and on, because they belong to
the task, not to the mount ([editor](../editor.md)). For a task past the retention limit, the query
cache does this job instead, warmed by `prefetch` ([contributions](./contributions.md#prefetch)), and
the editor reopens its files from the saved tab list and view states.

## There is no keepAlive

The pane contract has no `keepAlive` field. A hidden element tree per task is the memory cost the
agent transcript already declined ([managed agents](../managed-agents.md)), and models plus the
query cache cover what such a field would offer. A test in
`packages/client-core/src/host/registries/panes/panes.test.tsx` fails to compile if the field comes
back.

The one view that does outlive its task is a terminal. It isn't a pane, and the host doesn't keep it.
The terminal plugin holds each open tab's xterm from its first open until the tab closes, and lends
it to whichever drawer draws it ([terminal](../terminal.md) § Client). A terminal is a running
program you expect to keep running, and its state is the emulator's buffer, which no query cache can
rebuild. Neither is true of a pane.

The PR pane keeps two maps of its own. One is keyed by pull request, because a task can be about
several. The other is keyed by task but holds a live subscription that has to outlive the pane's
mounts. If a third map appears with a task key and nothing to subscribe to, it belongs on the model.
