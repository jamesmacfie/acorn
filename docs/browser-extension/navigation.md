# Sidebar navigation in the browser extension

This page covers how the [browser extension](../browser-extension.md)'s sidebar is laid out: its
three levels, the top bar at each, **Go to task**, the ⋯ menus, the tabs under a task, **Back**, and
the strip under the bars. How the panel follows the browser tab is in
[moving between pages](./task-pages.md#moving-between-pages). The code is in
`apps/extension/src/sidebar/location.ts`, which holds the level and the moves between levels,
`apps/extension/src/sidebar/TopBar.tsx`, `apps/extension/src/sidebar/GoToTask.tsx`,
`apps/extension/src/sidebar/TopBarMenus.tsx`, and `apps/extension/src/sidebar/Workspace.tsx`.

## Levels and Back

The panel is always at one of three levels, as the desktop is: **Home**, one task, or one
conversation inside a task. **Settings** sits beside them. The top bar says which, and the task it
names is the subject of everything under it.

**Back** goes up one level. From a conversation it opens the tab the conversation came from: **Runs**
for a workflow step's conversation, and **Agents** for any other. From a task or Settings it goes
Home.

## Home

Home's top bar holds the acorn, with a dot for the selected Node's state, the **Go to task** button
with its key, and the Settings gear. The dot is green while the Node answers, amber while its live updates pause, and red when it doesn't
answer. Home lists, top to bottom:

1. **Waiting for you**, only while an agent waits on a request, across every project on the Node.
   Each request answers in place with the same buttons the conversation uses
   ([request notifications](./notifications.md#the-waiting-list)).
2. **This page**: what Acorn knows about the page, in one of three states: the task it belongs to, an
   item no task holds with its handoff, or the project its site suggests with that project's open
   tasks ([This page](./task-pages.md#this-page)). A page that matches none of them has no
   **This page** section.
3. **Tasks**: one workspace's open tasks, grouped by project, with a filter and each task's agent
   mark. A row opens its task ([Home's task list](./task-pages.md#homes-task-list)).

## A task and its tabs

A task's top bar holds **Back**, then the task's title over its project and branch. A **This page**
tag follows when the page beside the panel belongs to the task. The title opens
[Go to task](#go-to-task). The ⋯ at the right holds the task's menu:

- **Open in Acorn** and **Copy Acorn link** ([the panel's verbs](./handoffs.md#the-panels-verbs)).
- **Pages**, when the task has any: each pull request, other address, or app a plugin published for
  it. A row says **This tab** when it's the page beside the panel, **Switch to tab** when another tab
  shows it, and **Open** otherwise. An app shows its state instead. Choosing one brings that tab and
  its window forward, or opens the page in a new tab. The sidebar learns which tabs show what from
  the `tabs` permission, and reads the tabs again when one navigates or closes.
- **Settings**.

Under the bar, the kit's tab strip holds the task's panes:

- **Agents**, always: every conversation in the task, grouped as **Managed sessions**, **Workflow
  runs**, and **Inline chats**, each with its agent, title, and state. A row opens the conversation.
  **New chat** starts another from the desktop's New picker: each harness or named login, then each
  custom agent. The tab carries the desktop Agent button's marker: the alert glyph while an agent
  waits on the person, or else a turning loader while one works.
- **Runs**, while the Node runs the workflows plugin, with a turning loader while a run runs
  ([the Runs tab](./workflows.md#the-runs-tab)).
- One tab for each [plugin panel](./plugin-panels.md) the task has.

A task opens on the tab last picked there, or on **Agents**. A tab the task turns out not to have,
such as a panel whose plugin stopped, gives way to **Agents**. The open tab stays drawn while its view
loads, so it doesn't vanish under the person.

## A conversation

A conversation's top bar holds **Back**, then the conversation's title, with its task's title above
it. A workflow step's conversation shows the step's name, with its run's name above it. The ⋯ at the
right holds **Open in Acorn**, **Copy Acorn link** ([the panel's
verbs](./handoffs.md#the-panels-verbs)), and **Archive chat**. Archiving sends `session.archive`,
which archives the conversation as the desktop's Archive does, so it leaves every list. The panel
then goes back to the tab the conversation came from and reads its list again. The composer's toolbar holds the three
[capture](./page-capture.md) buttons, and each capture shows as a chip in the draft. Each
conversation keeps its own draft ([agent conversations](./conversations.md)).

## Go to task

**Go to task** works like the desktop's palette. **⌘K** on a Mac, or **Ctrl+K** elsewhere, opens it
from any level once the panel has focus, and so do Home's **Go to task** button and a task's title.
A side panel gets keyboard focus only after a click into it, which is the browser's rule.

It hangs under the top bar and lists **Home**, then a **This page** group with the page's task, then
one group per project, labelled "Workspace › project", in the order `projects.list` returns. The
page's task isn't repeated. Each row shows the task's title over its branch, or "Project checkout"
for a task with no branch, and the task the top bar names has a check. Typing filters by title and
branch. The arrow keys move, **Enter** opens, and **Escape** closes. The tasks are the `tasks.pages`
list the sidebar already keeps, so opening it reads nothing.

The footer names the selected Node with a dot for its state. **Switch Node** opens Settings.

## The strip under the bars

At most one strip shows under the bars, chosen in this order:

1. The selected Node can't be worked with. An offline Node reads "**<Node>** is offline", with
   **Retry**, which asks the bridge again. Any other state gives its next step
   ([what the sidebar shows](./setup.md#what-the-sidebar-shows)). The acorn's dot turns red, and what
   the panel shows stays readable.
2. The page belongs to another task than the one shown: "This page is in **<task>**", with
   **Switch**, which opens that task.
3. The page carries an item a handoff matches and no task holds: "This page has no task", with **Start
   task**, which goes Home, where **This page** looks the item up.

A problem with the bridge itself shows as a line under the top bar, with the next step.

## Settings

Settings holds the Node list, where **Use** switches Nodes and **Forget** forgets one, pairing, site
access, each project's sites, notifications, and appearance ([set up](./setup.md)). Settings stays
open when you switch Nodes there.
