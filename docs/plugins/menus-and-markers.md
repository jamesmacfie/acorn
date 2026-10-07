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
  task pane the declaring plugin owns. The Node and the client both check it.
- **`when`** is a map of literals that must all equal the target's own facts, not an expression.
  `task.row` supplies `origin`, `projectId`, and `pinned`. `item.row` supplies `providerId` and
  `projectId`. `rail.source` supplies `projectId`, and `rail.pane` supplies `projectId`, `shown`, and
  `pinned`. Naming any other fact is a parse error. Identity fields such as `id` and `title` aren't
  facts.
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
`{ item: id }` body. Disposal and target, Node, and availability checks stop an open menu from
invoking a replacement plugin after a reload. A manifest may declare at most 32 rows, because a
plugin may own more than eight source and pane icons. Rail menus are desktop-only.

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
