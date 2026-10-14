# Pages matched to tasks in the browser extension

This page covers how the [browser extension](../browser-extension.md) knows which Acorn task the page
beside it belongs to: the `tasks.pages` read and its addresses, where the list lives and when it is
read again, matching in the browser, Home's **This page** section that draws the result, and the
branch marker on a local app. The [task chip](./handoffs.md#task-chips) on the page and the
[toolbar badge](./notifications.md) match from the same list. The code is in
`apps/cli/src/browser/handoffs.ts` (`taskPages`),
`apps/extension/src/taskPages.ts`, `apps/extension/src/background/taskPages.ts`, and
`apps/extension/src/sidebar/Home.tsx`.

## Pages that belong to a task

Each active task already records the addresses of its items. `tasks.pages` returns them for every
active task on the selected Node, each with the task's ID, title, project, and branch, and leaves out
a task with none. The host builds the list from the Node's own task list, `GET /v1/core/tasks`, the
same read and device authority `tasks.list` uses, so it costs no GitHub or other provider call:

- A pull request is the project's GitHub repository and the task's pull number, so its address is
  `https://github.com/<owner>/<name>/pull/<number>`, with `source` `github`.
- A link (a Linear issue, a Rollbar item, any provider's) carries its item's address when the
  provider stamped one in the link's reference, with the provider as `source`. A link with no
  `http` or `https` address adds nothing.
- A plugin that declares [task addresses](../plugin-authoring/browser-handoffs.md#task-addresses)
  says which exact origin on a loopback host a task's app answers at while it runs, such as Runn's
  `https://runn-05ea41.runn.localhost:5104`. The host reads the Node's discovery list and calls each
  such plugin's route beside the task list, with the plugin as `source`. Each of these addresses is at
  `/` and carries `status`: `{ label, state, tone }`, such as `Runn stack`, `running`, and `ok`. A
  plugin whose route fails, or answers anything the shared schema refuses, adds nothing, and the
  other addresses stand. An address for a task that isn't active is dropped.

Each address is in the [project sites](./project-sites.md#what-an-association-is) grammar: an exact
origin and a path prefix matched by whole segments. A pull request's address covers its tabs, such as
`/files` and `/checks`, a trailing slash, a query, and a fragment, and not `/pull/4821`. GitHub reads
owner and repository names in any case, so a `github` address matches its path without regard to case:
`/Acme/Runn/pull/482` is the same pull request as `/acme/runn/pull/482`. Every other source matches
its path exactly. An address at `/` covers a whole origin, port included, which is how a plugin's
local app address matches.

The background keeps the one copy of the list (`src/background/taskPages.ts`). It reads it again when
a Node is selected, when the selected Node's connection returns, when a hint has `missed` set, and on
the bridge's `tasks` and `projects` events, never on a timer. The host also sends `tasks` when a
plugin that declares task addresses broadcasts its status (`term:status` with its `pluginId`), which
Runn does when a command changes its stack and while a stack is starting. It sends each sidebar the list as
`{ type: 'taskPages', nodeId, tasks }`. The sidebar, the task chip, and the
[toolbar badge](./notifications.md#which-page-a-request-belongs-to) all match the page against it
in the browser (`pageTasks` in `src/taskPages.ts`), so no page address goes to the Node for it. A page
address still reaches the Node only on a click that resolves it: a handoff's **Look up in Acorn** or
the chip's **Start task**.

## This page

Home's **This page** section says what Acorn knows about the page beside the panel, in one of four
states:

1. **A task owns it.** Each task the page belongs to, with its project and branch, **Open in Acorn**
   on the pane that shows the item, and **Chat**, which opens the task's newest conversation or the
   new-chat picker. **Agents** below lists that task's conversations, and opening one makes the task
   current. The panel shows no item state, such as checks or review: the Node holds none for the
   page without a provider call. On an app a plugin published, the row leads with the branch, then
   "Task: <title> · <project>", then the plugin's state line, such as **Runn stack running**, and
   its link reads **Logs in Acorn**: the task on the plugin's pane, `runn` for Runn. When the person
   hid the branch marker on that origin, the row offers **Show the branch marker on this site**.
2. **An item no task holds.** The page matches a handoff and no task: **Look up in Acorn**, which
   opens the handoff card. Looking a page up sends its address to the Node, so it waits for this
   click. That is the same action for a site whose layout has no anchor, for a handoff that declares
   no anchors, such as Linear's and Rollbar's, and for Firefox.
3. **A project site with no item.** The project its [site associations](./project-sites.md) suggest,
   that project's open tasks, and **New task in Acorn**, which opens the project in the desktop app.

A page that matches none of these, or one the browser hides from the extension, shows only the Acorn
mark. The current task stays current there, so a capture still has somewhere to go, but Home doesn't
show it. **Current task** stays pinned below **This page** on a page whose task isn't the current
one. The sidebar reads the page again when the tab finishes loading, so the section follows the
tab. Sites to allow are under **Site access** in Settings.

## The branch marker

On a page whose origin matches an address a plugin published for a task, the content script draws a
pill in the bottom-right corner: Acorn's mark, the task's branch in a monospaced face (its name for a
task on the project's own checkout), and the plugin's state with its dot, such as **running**. It
draws in a closed shadow root, with the same rules as the [task chip](./handoffs.md#task-chips): text
only, the extension's own look, and the page's light or dark theme, read from the body's text colour.
A page with no plugin address gets no marker.

The marker needs page access like any chip. A local app's origin is a site like any other, so the
person allows it under **Site access**, where it's listed as **Branch marker on its pages**, or clicks
the toolbar button on the tab. The extension asks for nothing by itself. Browsers grant access by host
and not by port, so `https://runn-05ea41.runn.localhost:5104` asks for all of
`https://runn-05ea41.runn.localhost`.

A click opens the panel on Home with the task. The arrow beside it opens a menu: **Show in side
panel**, **Open in Acorn** (the task on the plugin's pane), **Copy Acorn link**, and **Hide on this
site**. In Firefox the click opens the menu, which says to click Acorn in the toolbar for the panel.
**Hide on this site** adds the page's origin to `hiddenMarkers` in `storage.local`
([browser storage](./conversations.md#browser-storage)), and the background takes the marker off
every tab on that origin. **This page** shows it again. The background checks a marker click against
the address the browser reports for the tab, as it does a chip's.

## Native operation

| Operation | Fields | Result |
| --- | --- | --- |
| `tasks.pages` | `nodeId` | `{ nodeId, tasks }`, each `{ id, title, branch, projectId, pages }`, with `pages` as `{ origin, pathPrefix, source, status? }` |

The host also sends `{ v, event: 'tasks', nodeId }` when the selected Node broadcasts `tasks:changed`,
or a `term:status` from a plugin that declares task addresses. A reply for a Node that is no longer
selected is refused as `not_selected`.

## Why

Matching in the browser keeps page addresses off the Node: the panel recognises a page only through
lists the Node already sent, and a page address goes to the Node only when the person clicks. Task
addresses use the project sites' grammar, so a plugin's exact origin, such as a local app's, needed no
grammar change. A plugin publishes only a loopback origin with no path, so it can't tie someone else's
site, such as github.com, to one of its tasks.
