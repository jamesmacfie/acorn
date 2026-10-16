# Sidebar navigation in the browser extension

This page covers how the [browser extension](../browser-extension.md)'s sidebar is laid out: its
three levels, the top bar at each, the tabs under a task, **Back**, and the strip under the bars. How
the panel follows the browser tab is in [moving between pages](./task-pages.md#moving-between-pages).
The code is in `apps/extension/src/sidebar/location.ts`, which holds the level and the moves between
levels, `apps/extension/src/sidebar/TopBar.tsx`, and `apps/extension/src/sidebar/Workspace.tsx`.

## Levels and Back

The panel is always at one of three levels, as the desktop is: **Home**, one task, or one
conversation inside a task. **Settings** sits beside them. The top bar says which, and the task it
names is the subject of everything under it.

**Back** goes up one level. From a conversation it opens the tab the conversation came from: **Runs**
for a workflow step's conversation, and **Agents** for any other. From a task or Settings it goes
Home.

## Home

Home's top bar holds the acorn, with a dot for the selected Node's state, and the Settings gear. The
dot is green while the Node answers, amber while its live updates pause, and red when it doesn't
answer. Home lists, top to bottom:

1. **Waiting for you**, only while an agent waits on a request, across every project on the Node.
   Each request answers in place with the same buttons the conversation uses
   ([request notifications](./notifications.md#the-waiting-list)).
2. **This page**: what Acorn knows about the page, in one of three states: the task it belongs to, an
   item no task holds with its handoff, or the project its site suggests with that project's open
   tasks ([This page](./task-pages.md#this-page)). A page that matches none of them has no
   **This page** section.
3. **Tasks**: one workspace's open tasks, grouped by project. A row opens its task
   ([Home's task list](./task-pages.md#homes-task-list)).

## A task and its tabs

A task's top bar holds **Back**, then the task's title over its project and branch. A **This page**
tag follows when the page beside the panel belongs to the task. Under the bar, the kit's tab strip
holds the task's panes:

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
it. A workflow step's conversation shows the step's name, with its run's name above it. The
conversation has **Open in Acorn** and **Copy Acorn link** ([the panel's
verbs](./handoffs.md#the-panels-verbs)). The composer's toolbar holds the three
[capture](./page-capture.md) buttons, and each capture shows as a chip in the draft. Each
conversation keeps its own draft ([agent conversations](./conversations.md)).

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
