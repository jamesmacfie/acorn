# Pages matched to tasks in the browser extension

This page covers how the [browser extension](../browser-extension.md) knows which Acorn task the page
beside it belongs to: the `tasks.pages` read and its addresses, where the list lives and when it is
read again, matching in the browser, Home's **This page** section that draws the result, and the
branch marker on a local app. The [task chip](./handoffs.md#task-chips) on the page and the
[toolbar badge](./notifications.md) match from the same list. The code is in
`apps/cli/src/browser/handoffs.ts` (`taskPages`),
`apps/extension/src/taskPages.ts`, `apps/extension/src/background/taskPages.ts`, and
`apps/extension/src/sidebar/Home.tsx`. Home's task list, which lists the same tasks with their
agents' state, is described here too.

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

1. **A task owns it.** One row for each task the page belongs to: the
   [agent mark](#a-tasks-agents), the title in bold, the project and branch, and a chevron. The row
   opens the task, whose ⋯ menu has its Acorn links
   ([a task and its tabs](./navigation.md#a-task-and-its-tabs)). The panel shows no item state for
   the page itself. For the task's pull request, the GitHub plugin's **Pull request** tab under the
   task shows its state, checks, and reviews ([plugin panels](./plugin-panels.md)). On an app a
   plugin published, the row adds the plugin's state line before the chevron, such as **Runn stack
   running**. When the person hid the branch marker on that origin, the section offers **Show the
   branch marker on this site**.
2. **An item no task holds.** The page matches a handoff and no task: Home looks the item up and
   opens the handoff card, once for each page and Node, while the Node is online. That's the same for
   a site whose layout has no anchor, for a handoff that declares no anchors, such as Linear's and
   Rollbar's, and for Firefox. Home leaves the lookup to **Look up in Acorn** after the person
   dismisses the card, when several handoffs match the page, and while the Node is offline. The
   lookup runs only on Home. Under a task, the strip's **Start task** goes Home for it, and a chip's
   click goes Home with the card.
3. **A project site with no item.** The project its [site associations](./project-sites.md) suggest,
   that project's open tasks, and **New task in Acorn**, which opens the project in the desktop app.

A page that matches none of these has no **This page** section, and Home shows only its task list.
The sidebar reads the page again when the tab finishes loading, so the section follows the tab.
Sites to allow are under Settings → **Permissions**.

## Moving between pages

The panel follows the browser tab only to a page that belongs to a task, and never throws away what
you were reading. When the page moves, by navigating or by switching tabs, the panel applies these
rules in order (`followPage` in `apps/extension/src/sidebar/location.ts`):

1. Bridge setup, pairing, and Settings never move.
2. A page that belongs to no task leaves the panel where it is, so following a link from a pull
   request keeps the task and tab you were on.
3. An open conversation stays open, because pages are often visited to capture them into it. The
   strip under the top bar names the page's task, with **Switch**
   ([the strip under the bars](./navigation.md#the-strip-under-the-bars)).
4. Otherwise, a page that belongs to a task opens that task, on the tab last picked there.

The panel applies the same rules once more when the selected Node's task list first arrives, so a
panel that opens beside a pull request shows its task. A later list moves nothing, such as one with a
task just made for the page, so Home's handoff card stays where it is.

The tab you pick under a task is kept per task in `taskViews:<nodeId>`, and the task or conversation
the panel last showed in `destination:<nodeId>` ([browser storage](./conversations.md#browser-storage)).
When the panel opens, it returns to that task or conversation, then follows the page by the rules
above. A task the Node no longer lists sends the panel Home.

The task chip's **Show in side panel** opens the page's task, and its new chat about the page opens
the task's **Agents** tab, with the page waiting for the conversation you start or open next. An OS
notification, a request's **Open** on Home, and **Add to Acorn chat** open their conversation.

## Home's task list

Below **This page**, Home lists the open tasks of one workspace, grouped by project in the
workspace's order. `projects.list` returns each project's workspace and the workspaces in the
desktop rail's order, and the tasks are the `tasks.pages` list above. A project with no open task,
and a hidden project, has no group. The workspace's name beside **Tasks** opens the kit's picker of
workspaces. The sidebar keeps the choice per Node in `homeWorkspace:<nodeId>` in `storage.local`.
With no choice, it shows the page's task's workspace, or else the first one.

**Filter tasks** narrows the rows to those whose title or branch contains the text, in any case, and
hides a project group it leaves empty.

Each row is the kit's stacked row: the [agent mark](#a-tasks-agents), the title, and under it the
branch in a monospaced face, or "Project checkout" for a task with no branch, then "· needs you" or
"· working". At the right, a **This page** tag marks the page's own task. Another task with one of
its pages open in a browser tab, such as its pull request, has an icon button, **Switch to its tab**,
which brings that tab and its window forward. The row opens its task, whose ⋯ menu has its links
([a task and its tabs](./navigation.md#a-task-and-its-tabs)).

### A task's agents

A task's mark is the desktop's: an amber alert while one of its agents waits on the person, a
spinning loader while one works, and an idle dot otherwise. The alert wins over the spinner. The
counts come from `agentCounts` in `apps/extension/src/taskPages.ts`, which the task chip and the
task's **Agents** tab use too. Waiting comes from the requests the sidebar already holds, for every
task on the Node.

Working comes from the workspace's conversations. While Home is on screen, the sidebar reads them
with one `sessions.list` by `workspaceId`
([native messaging](./native-messaging.md#frames-and-operations)). It reads again when the workspace changes,
when the connection returns, and on an agent hint that names a task in the workspace or a
conversation it listed. The Node returns the newest 100 unarchived conversations. A working one is
recent, so the cut drops only idle ones. The page's task in another workspace shows only whether an
agent waits on the person.

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
