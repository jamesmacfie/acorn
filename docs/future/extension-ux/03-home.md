# Phase 3: Home's task list

Date: October 16, 2026. Status: proposed. Depends on [phase 1](./01-navigation.md).

## Goal

Home answers two questions: does anything need me, and where's my work. This phase draws the second
half. The task list shows one workspace's tasks, grouped by project, each with the desktop's agent
markers. A row opens its task. The **This page** section shows the page's task as one row.

## In the prototype

- Scenario: **Home**. Switch the workspace from **Acme** to **Platform**, and type in **Filter
  tasks**.
- Notes: `home` at line 1288.
- Code: `homeView` at line 854 draws Home. `taskRow` at line 867 draws a task row, and `stateIcon` at
  line 622 picks its icon. `thisPage` at line 875 draws the **This page** row for a page that belongs
  to a task. `taskState` at line 616 says whether a task needs you, is working, or is idle.
- Today: `references/extension-ux/today/04-home-task-page-dark.png` and `13-home-plain-dark.png`.

## Starting point

- `Tasks` in `apps/extension/src/sidebar/Home.tsx`, at about line 328, draws the list. Its workspace
  control is a native `<select name="workspace">`. Each row expands to show its links, with **Switch
  to tab**, **Open in Acorn**, and **Chat**.
- `loadHomeWorkspace` and `saveHomeWorkspace` in `apps/extension/src/localState.ts` remember the
  workspace per Node.
- `ThisPage` in the same file draws the page's task with its own links.
- `agentCounts` in `apps/extension/src/taskPages.ts` turns a task's sessions and the pending requests
  into waiting and working counts. The task chip already uses it.
- The sidebar reads sessions one task at a time with `sessions.list`. The Node's session list route
  also filters by `workspaceId`, through `sessionListQuerySchema` in
  `plugins/agents/src/shared/sessionList.ts`, and returns at most 100 rows.

[Home's task list](../../browser-extension/task-pages.md#homes-task-list) documents today's behavior.

## The design

### The Tasks section

A section header reading **Tasks**, with the workspace as a small ghost button at its right that
opens the kit's `Picker` with the placeholder "Filter workspaces". Under it, a filter field with a
filter icon and the placeholder "Filter tasks", which narrows the rows by title and branch and hides
a project group left empty.

One group per project in the workspace, in `projects.list` order, each under a small header with the
project's name. Hidden projects stay out, as they do today.

### A task row

The kit's stacked row, with these parts:

- Leading, the state icon: an amber `circle-alert` when an agent waits on you, a spinning
  `loader-circle` while one works, and an idle dot otherwise. The alert wins over the spinner, as on
  the desktop's Agent button.
- The title.
- Under it, the branch in monospace, or "Project checkout" for a task with no branch, then "· needs
  you" in amber or "· working" when that's the state.
- Trailing, a **This page** tag when the page beside the panel belongs to the task. Otherwise, when
  one of the task's pages is open in another browser tab, an icon button with `arrow-right-left` and
  the label "Switch to its tab".

The row opens the task with `openTask`. Its other links moved to the task's ⋯ menu in phase 2.

### This page, for a task

When the page belongs to a task, **This page** shows a section header with the page's host at its
right, and one row: the state icon, the title in bold, the project and branch, and a chevron. It opens
the task. Phase 5 draws this section for an issue and for a project site.

### Agent state for every task in the workspace

Waiting comes from the pending requests the sidebar already holds. Working needs each task's
sessions.

Let `sessions.list` take a `workspaceId` instead of a `taskId`, exactly one of the two, and pass it
to the Node's list route. Group the rows by task and hand each group to `agentCounts`. Read it again
on each `agent` hint whose `tasks` include a task in the workspace, and on reconnect, as the sidebar
does for a task's list today.

The route returns at most 100 sessions, newest first. A working session is recent, so 100 is enough in
practice. Write that limit in a comment where you read it. If it proves too few, add a filter for
running sessions to the Node's route, not a second page.

## Changes

1. Replace the native workspace select with a `Picker`. Keep `saveHomeWorkspace`.
2. Add the filter field.
3. Redraw the task row as above. Remove the expanding links.
4. Redraw **This page** for a page's task as one row.
5. Add `workspaceId` to `sessions.list` in the protocol, the host, and the host's tests. Update
   [native messaging](../../browser-extension/native-messaging.md).
6. Compute each task's state with `agentCounts` and draw it.
7. Test the filter, the workspace switch, each state icon, the **This page** tag, and the switch
   button. Update `ProjectSites.test.tsx` where it reads the old rows.
8. Rewrite [Home's task list](../../browser-extension/task-pages.md#homes-task-list).

## Acceptance

- Home shows the remembered workspace's tasks, grouped by project.
- A task with a working agent shows a spinner and "working". A task with an agent waiting on a
  permission shows the amber alert and "needs you", even while another of its agents works.
- Typing in **Filter tasks** hides other tasks and empty project groups.
- With the task's pull request open in another tab, the row's switch button moves to that tab.

## Risks

A workspace read on every agent hint costs one Node call per hint. Hints already arrive debounced.
Read only when a hinted task belongs to the workspace on screen.
