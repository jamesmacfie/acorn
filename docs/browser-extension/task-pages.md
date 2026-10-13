# Pages matched to tasks in the browser extension

This page covers how the [browser extension](../browser-extension.md) knows which Acorn task the page
beside it belongs to: the `tasks.pages` read and its addresses, where the list lives and when it is
read again, matching in the browser, and Home's **This page** section that draws the result. The
[task chip](./handoffs.md#task-chips) on the page and the [toolbar badge](./notifications.md) match
from the same list. The code is in `apps/cli/src/browser/handoffs.ts` (`taskPages`),
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

Each address is in the [project sites](./project-sites.md#what-an-association-is) grammar: an exact
origin and a path prefix matched by whole segments. A pull request's address covers its tabs, such as
`/files` and `/checks`, a trailing slash, a query, and a fragment, and not `/pull/4821`. An address at
`/` covers a whole origin, port included, which is how a plugin can publish a local app's address
without a grammar change.

The background keeps the one copy of the list (`src/background/taskPages.ts`). It reads it again when
a Node is selected, when the selected Node's connection returns, when a hint has `missed` set, and on
the bridge's `tasks` and `projects` events, never on a timer. It sends each sidebar the list as
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
   page without a provider call.
2. **An item no task holds.** The page matches a handoff and no task: **Look up in Acorn**, which
   opens the handoff card. Looking a page up sends its address to the Node, so it waits for this
   click. That is the same action for a site whose layout has no anchor, for a handoff that declares
   no anchors, such as Linear's and Rollbar's, and for Firefox.
3. **A project site with no item.** The project its [site associations](./project-sites.md) suggest,
   that project's open tasks, and **New task in Acorn**, which opens the project in the desktop app.
4. **Nothing matches.** One line, and an offer to tie the page's site to a project, which adds the
   origin as one of that project's sites.

**Current task** stays pinned below on a page whose task isn't the current one, and on a page that
matches nothing, so a capture always has somewhere to go. The sidebar reads the page again when the
tab finishes loading, so the section follows the tab, and says so when the page is one it may not
read.

## Native operation

| Operation | Fields | Result |
| --- | --- | --- |
| `tasks.pages` | `nodeId` | `{ nodeId, tasks }`, each `{ id, title, branch, projectId, pages }`, with `pages` as `{ origin, pathPrefix, source }` |

The host also sends `{ v, event: 'tasks', nodeId }` when the selected Node broadcasts `tasks:changed`.
A reply for a Node that is no longer selected is refused as `not_selected`.

## Why

Matching in the browser keeps page addresses off the Node: the panel recognises a page only through
lists the Node already sent, and a page address goes to the Node only when the person clicks. Task
addresses use the project sites' grammar, so a plugin can later publish an exact origin, such as a
local app's, with no grammar change.
