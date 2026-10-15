# Pages matched to tasks in the browser extension

This page covers how the [browser extension](../browser-extension.md) knows which Acorn task the page
beside it belongs to: the `tasks.pages` read and its addresses, where the list lives and when it is
read again, matching in the browser, Home's **This page** section that draws the result, and the
branch marker on a local app. The [task chip](./handoffs.md#task-chips) on the page and the
[toolbar badge](./notifications.md) match from the same list. The code is in
`apps/cli/src/browser/handoffs.ts` (`taskPages`),
`apps/extension/src/taskPages.ts`, `apps/extension/src/background/taskPages.ts`, and
`apps/extension/src/sidebar/Home.tsx`. Home's task list, which lists the same tasks with their links,
is described here too.

## Pages that belong to a task

Each active task already records the addresses of its items. `tasks.pages` returns them for every
active task on the selected Node, each with the task's ID, title, project, and branch. A task with no
address has an empty list, so Home's task list can show every task. The host builds the list from the Node's own task list, `GET /v1/core/tasks`, the
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
address reaches the Node only when a handoff resolves it: Home looking up a page a handoff matches,
**Look up in Acorn**, or the chip's **Start task**.

## This page

Home's **This page** section says what Acorn knows about the page beside the panel, in one of four
states:

1. **A task owns it.** Each task the page belongs to, with its project and branch, **Open in Acorn**
   on the pane that shows the item, and **Chat**, which opens the task's newest conversation or the
   new-chat picker. **Agents** below lists that task's conversations, and opening one makes the task
   current. The panel shows no item state for the page itself. For the task's pull request, the
   GitHub plugin's **Pull request** nav item shows its state, checks, and reviews
   ([plugin panels](./plugin-panels.md)). On an app a plugin published, the row leads with the branch, then
   "Task: <title> · <project>", then the plugin's state line, such as **Runn stack running**, and
   its link reads **Logs in Acorn**: the task on the plugin's pane, `runn` for Runn. When the person
   hid the branch marker on that origin, the row offers **Show the branch marker on this site**.
2. **An item no task holds.** The page matches a handoff and no task: Home looks the item up and
   opens the handoff card, once for each page and Node, while the Node is online. That's the same for
   a site whose layout has no anchor, for a handoff that declares no anchors, such as Linear's and
   Rollbar's, and for Firefox. Home leaves the lookup to **Look up in Acorn** after the person
   dismisses the card, when several handoffs match the page, and while the Node is offline. The
   lookup leaves a conversation open under **Agents** alone, which a chip's click doesn't.
3. **A project site with no item.** The project its [site associations](./project-sites.md) suggest,
   that project's open tasks, and **New task in Acorn**, which opens the project in the desktop app.

A page that matches none of these has no **This page** section, and Home shows only its task list.
The current task stays current there, so a capture still has somewhere to go, but Home doesn't show
it. **Current task** stays pinned below **This page** on a page whose task isn't the current
one. The sidebar reads the page again when the tab finishes loading, so the section follows the
tab. Sites to allow are under Settings → **Permissions**.

## Moving between pages

The sidebar remembers what it showed for each task: the tab, and the conversation or workflow run
open in it. It keeps that as it changes, and skips Home, which belongs to no task. When the page
moves to another task's page, by navigating or by switching tabs, the sidebar shows what it last
showed for that task. With nothing remembered, **Agents** over an open conversation moves to that
task's newest conversation, **Workflows** gives way to Home when the task has no runs, and anything
else stays.

When the page moves to one no task holds, even on a project's site, **Agents**, **Workflows**, or a
[plugin panel](./plugin-panels.md) gives way to Home. An open conversation waits under **Agents**, so
one click brings it back to capture the page into it. Coming back to a task's page from there shows
what the sidebar last showed for it.

Home stays on Home as pages change, unless the sidebar went there by itself. The task list arriving,
or a plugin publishing the page's address, moves nothing.

**Agents** in the bottom bar, the page's own task row on Home, and **Switch** on the banner over
another task's conversation all show the page's task. A conversation left open in another task gives
way to what the sidebar last showed in the page's task, or its newest conversation. A conversation
the person opens from another task's row stays, with the banner, until they ask for the page's task.
The panel reopens the last conversation only when the page doesn't belong to another task.

**Agents** in the bottom bar carries the same marker as the desktop's Agent button, for the page's
task: a turning loader while an agent works, and the alert glyph instead when one waits on the person.
It counts as the [task chip](./handoffs.md#task-chips) does. The sidebar reads the task's conversations
again on each hint that touches them, even under an open conversation, so the marker stays current.

## Home's task list

Below **This page**, Home lists the open tasks of one workspace, grouped by project in the
workspace's order. `projects.list` returns each project's workspace and the workspaces in the
desktop rail's order, and the tasks are the `tasks.pages` list above, so the list costs no extra read.
The picker beside **Tasks** chooses the workspace. The sidebar keeps the choice per Node in
`homeWorkspace:<nodeId>` in `storage.local`. With no choice, it shows the current task's workspace,
or else the first one.

A row shows the task's links under it, one task at a time:

- Each address the task is known by, as its host and path, or as the plugin's state line for an app
  a plugin published. **Switch to tab** brings forward the tab already showing it, matched the same way
  a page is matched to its task, and focuses that tab's window. **Open** opens it in a new tab.
- **Open in Acorn** on the task, and **Chat**, which opens the task's newest conversation. A task with
  no address says so.

The page's own task is the exception. Its row, here or under **This page**, opens **Agents**, which
lists that task's conversations.

The sidebar learns which links are open from the `tabs` permission, which gives every tab's address.
It reads the tabs again when one navigates or closes. Tab addresses stay in the browser.

## The branch marker

On a page whose origin matches an address a plugin published for a task, the content script draws a
pill in the bottom-right corner: Acorn's mark, the task's branch in a monospaced face (its name for a
task on the project's own checkout), and the plugin's state with its dot, such as **running**. It
draws in a closed shadow root, with the same rules as the [task chip](./handoffs.md#task-chips): text
only, the extension's own look, and the page's light or dark theme, read from the body's text colour.
A page with no plugin address gets no marker.

The marker needs page access like any chip. A local app's origin is a site like any other, so the
person allows it under Settings → **Permissions**, where it's listed as **Branch marker on its pages**, or clicks
the toolbar button on the tab. The extension asks for nothing by itself. Browsers grant access by host
and not by port, so `https://runn-05ea41.runn.localhost:5104` asks for all of
`https://runn-05ea41.runn.localhost`.

A click opens the panel on Home with the task. The arrow beside it opens a menu: **Show in side
panel**, **Open in Acorn** (the task on the plugin's pane), **Ask about an element** (the
[element picker](./element-picker.md)), **Copy Acorn link**, and **Hide on this site**. In Firefox
the click opens the menu, which says to click Acorn in the toolbar for the panel.
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
lists the Node already sent. A page address goes to the Node only for a page a handoff matches,
which is a narrow pattern such as a pull request, and only to the person's own Node. Task
addresses use the project sites' grammar, so a plugin's exact origin, such as a local app's, needed no
grammar change. A plugin publishes only a loopback origin with no path, so it can't tie someone else's
site, such as github.com, to one of its tasks.
