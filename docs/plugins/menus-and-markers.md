# Context menus and rail markers

This page covers the declarative right-click menu and the status markers on rail controls. It's part
of the [plugin reference](../plugins.md).

## Context menus

`contextMenus` is the declarative right-click contribution. Its registry,
`packages/client-core/src/host/registries/panes/contextMenus.ts`, is core's as much as a plugin's: the
tab rail's own Pin, Unpin, Rename, and Archive rows are registrations on it. The button menu on a task
row and the right-click menu draw the same list from the same registry.

An entry is `{ id, location, surface?, label, icon?, order?, when?, action }`:

- **`location`** comes from a closed list in `@acorn/protocol/contextMenus.ts`. `task.row` is a row
  in the tab rail. `item.row` is a row in an integration's list, such as a Rollbar error, a Linear
  issue, or a GitHub pull request. `rail.source` and `rail.pane` are the desktop's left source icons
  and right task pane icons. The two rail locations require `surface`, the exact id of a source or
  task pane the declaring plugin owns. The Node and the client both check it. `file.row` is a file or
  folder in Editor's tree and `document.tab` an open document's tab. `agent.message` is a user or
  assistant message in an agent transcript, and `agent.turn` a finished turn. `content.selection` is
  text a person selected and asked for actions on. Any plugin may add rows to these five, and none
  takes a `surface`.
- **`when`** is a map of literals that must all equal the target's own facts, not an expression.
  `task.row` supplies `origin`, `projectId`, and `pinned`. `item.row` supplies `providerId` and
  `projectId`. `rail.source` supplies `projectId`, and `rail.pane` supplies `projectId`, `shown`, and
  `pinned`. `file.row` and `document.tab` supply `projectId`, `extension`, `directory`, and
  `readOnly`. `extension` is lowercase without the dot, and `""` for a folder, a dotfile, or a name
  with none. `readOnly` means Editor shows the file as an image. `agent.message` supplies
  `projectId`, `role` (`user` or `assistant`), and `status`, the status of its turn. `agent.turn`
  supplies `projectId` and `status`. `content.selection` supplies `contentKind` (`markdown`, `code`, or
  `document`), `languageId`, and `readOnly`. Naming any other fact is a parse error. Identity fields such as
  `id`, `title`, `path`, `text`, and `revision` aren't facts.
- **`action`** takes the narrow verb set a command takes. `createTask` and `navigate` aren't in it,
  because the thing under the cursor is a core resource.

The host binds the rest. The id becomes `plugin:<pluginId>:<id>`, so a package can't take a core
row's place. A row is hidden unless its plugin runs on the Node being looked at. The verb receives the
id of the thing that was right-clicked, never an id the descriptor chose. There's no `tone`, because
a red row claims that an action destroys a core resource, and only core makes that claim.

```json
{
  "contributions": {
    "contextMenus": [{
      "id": "open-card",
      "location": "task.row",
      "label": "Open the board card",
      "icon": "kanban",
      "when": { "origin": "board" },
      "action": { "verb": "runNodeAction", "path": "/v1/p/board/open" }
    }]
  }
}
```

For `runNodeAction` on a rail icon, the host sends `{ rail: { location, sourceId, projectId } }` or
`{ rail: { location, paneId, taskId, projectId } }`. A source icon supplies no task. Row menus keep the
`{ item: id }` body. A file row or tab sends `{ resource: { kind: 'file', taskId, projectId, path,
directory, readOnly, revision? } }`. `path` is Editor's confined worktree-relative path, case kept, and
`revision` is the SHA-256 of the disk version an open document last saw. No absolute path or file bytes
travel: a route that needs the file declares and calls Editor's `editor.files` capability. Before the
verb runs, the owner checks the menu's file is still the one it opened on, and the host checks its
Node is the one in view and its task is still on that Node in the same project.

A message sends `{ message: { taskId, projectId, sessionId, itemId, turnId, role, status, text,
textTruncated?, revision } }`, and a turn sends `{ turn: { taskId, projectId, sessionId, turnId,
status, revision } }`. `itemId` is the transcript card's stable ID. `revision` is the sequence number of
the newest event behind the card. `text` is what the card shows, cut to 64 KiB of whole characters,
and `textTruncated` is `true` when it was cut. Neither body carries the raw event, reasoning, or the
turn's other messages. A turn has a target only once it's completed, failed, cancelled, or
interrupted. The owner takes the target as the menu opens and refuses a row once the message, its
turn's status, or the session on the card has changed. The host then makes the same Node and task
checks as for a file. A row can't send, answer, retry, or edit anything in the session.

A selection sends `{ selection: { taskId?, projectId?, ownerId, contentKind, languageId?, readOnly,
text, revision, resource?, range? } }`. `ownerId` is the plugin that draws the content. `resource` is
`{ kind: 'file', path }` in Editor and `{ kind: 'message', sessionId, itemId }` in a transcript.
`revision` is a transcript message's newest event or an editor's live-buffer edit counter, so it
covers unsaved text. A `document` selection carries `range`, one-based lines and columns with an
exclusive end. Rendered Markdown sends the plain text selected and no `range`. A selection inside one
code fence is `code`, with the fence's language in the same ids an editor uses. Text over 64 KiB of
UTF-8 is refused whole: the menu says why and offers no row. The row can't replace the text, save,
send, or read the rest of the document.

Nothing watches the selection as it changes. The owner wraps its content in the host's
`SelectionActions` (`@acorn/plugin-api/ui/host`), which reads the selection only when the person asks
and calls the owner's `select` for the target. On the desktop the person right-clicks the selection,
or presses Shift+F10 or the menu key while focus is inside the owner. The menu has **Copy** and the
rows. With no row to offer, a link under the pointer, Option held, or a selection that crosses into
another owner, the platform's menu opens instead. The terminal has no text selection, so it offers an
owner's whole block from an explicit **Actions for the whole text** menu. A transcript message offers
its text there; Editor and plugin document editors offer nothing. Before a row runs, the owner's
`isCurrent` checks the content hasn't changed, and the host makes the Node and task checks. The
owners are `transcriptMenus.tsx`, `EditorPane.tsx`, and `DocumentSurface.tsx`.

Disposal and target, Node, and availability checks stop an open menu from
invoking a replacement plugin after a reload. A manifest may declare at most 32 rows, because a
plugin may own more than eight source and pane icons. Rail menus are desktop-only.

A document owner opts in by building its target with `fileMenuTarget` and drawing
`contextMenuItems(target.location, target)` after its own rows. Editor's adapter is
`plugins/editor/src/client/contributedMenuRows.tsx`. The transcript's is
`plugins/agents/src/client/sessions/transcriptMenus.tsx`.

Compiled plugins register rail rows through `ctx.contextMenus.register` after their source or pane,
and the host stamps the owner. A replacement `rail` or `pane.switcher` provider may call the optional
`openContextMenu(id, { x, y })`. A worker tree sends the same method with `{ id, at: { x, y } }`, and
the host validates the id and point. A terminal provider gets no DOM menu and may ignore the method.

### Three lists, one menu

Core's rail list for descriptor sources (`ChromeSourcePanel.tsx`) and GitHub's pull-request list
(`PullList.tsx`) both draw from `contextMenuItems('item.row', target)`. Each contributes its own
**Create task** row: core's promotes through the source's registered `promotion`, and GitHub's finds or
makes the pull request's task with its Linear links. A third party can add a row too. The workflows
plugin's **Start workflow…** is one.

An `item.row` target carries `id`, `title`, `body`, `link`, and `item`, the provider's own row handed
back untouched. None of them is a fact, so no `when` can match them.

`registerContextMenuItems` adds rows. `contextMenuItems` and `runContextMenuItem` serve a plugin that
draws a list and wants the registry's rows in it. No component crosses: each host loops over the rows
with its own `Menu.Item`, which keeps the menu working in a terminal.

No context menu is reachable from a plugin frame. The host fills the registry from manifests the
device read, and the bridge has no message kind for it.

## Rail markers

A rail marker is a small, non-interactive status icon on a rail control: a task row, a rail source,
or a pane button. A compiled plugin publishes markers through `ctx.railMarkers`, next to the state
that owns them:

```ts
ctx.railMarkers.register({
  id: 'docker',
  order: 50,
  markers: (target) => {
    if (target.kind !== 'task') return []
    const running = dockerTaskSummary(target.id)?.running ?? 0
    return running ? [{
      id: 'running',
      label: `${running} running container${running === 1 ? '' : 's'}`,
      icon: 'brand:docker',
      tone: 'accent',
      placements: ['top-start', 'bottom-start'],
    }] : []
  },
})
```

The host owns three things:

- **Where a marker goes.** `placements` is an ordered wish list, and the host hands out the first free
  entry, so two plugins asking for the same corner get different corners.
- **What it looks like.** `tone` is semantic, and the host owns the color, the spin, and icon
  resolution.
- **Whether it outranks anything.** Contributed priorities are clamped below core's, so a plugin
  can't push a core state such as "archiving" out of its slot. A marker with no free position keeps
  its place in the tooltip legend and the accessible description.

Markers have no click verb, because a marker lives inside a button. The action belongs to the rail
control, a context menu, or a command. `markers()` runs inside the consuming render, so it may read
signals the plugin owns. Registering through `ctx` lets the host remove the markers when the plugin
is disabled.

The agents plugin's marker is the task row's top-right corner: a spinning loader while any agent in
the task is working, replaced by the alert glyph when one needs the owner. It answers the same for the
task's Agent button in the pane rail, so the state shows on both sides. The Workflows button gets the
spinner only while one of the task's workflow agents is working, so a spinner on the Agent button with
none on Workflows means the working agent isn't the workflow's. Docker marks its pane button with a
green dot in the top-right corner, in place of the whale the button already draws. The changes plugin puts a dot
on its own pane button: green when the uncommitted changes only add lines, red when they only remove
them, and the `diff` dot, half green and half red, for both.

A dot marker's `dotTone` is one of `ok`, `warn`, `bad`, `mixed` (half red, half yellow), or `diff`
(half green, half red).

A loaded plugin publishes task status through an `extensions` entry aimed at the `core:task`
annotation point ([task annotations](./rows-and-annotations.md#task-annotations)). The host turns the
marks into rail markers, and the plugin supplies no placement, color, CSS, or action. Source and pane
markers stay compiled until an owner declares an annotation point for those surfaces.
