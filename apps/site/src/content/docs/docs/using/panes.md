---
title: Panes
description: Show, add, close, pin, move, resize, and maximize the panes in a task's row.
sources:
  - docs/panes.md
  - docs/panes/layout.md
  - packages/client-core/src/features/tasks/TaskPaneHost.tsx
  - packages/client-core/src/features/tasks/PaneSwitcher.tsx
  - apps/desktop/src/client/TaskView.tsx
checked: 90ded85ca
---

This page covers the row of panes a task shows: which panes there are, and how to show, add, close,
pin, move, resize, and maximize them. A pane is one view of a task, such as the Agent pane or Git.

## The panes acorn ships

The pane switcher on the right edge of the window lists the panes this task can show, in this order:

| Pane | What it shows |
| --- | --- |
| Pull request | The task's GitHub pull request. Only on a task with one. |
| Agent | The task's agent sessions. |
| Git | **Changes**, **History**, **Stashes**, and **Worktrees** for the task's branch. |
| Workflows | Workflow runs on the task. Only once a workflow has run on it. |
| Notes | Task, workspace, and global notes. |
| Context | What an agent gets about the task. [Task context](/docs/using/task-context/) covers it. |
| Editor | The worktree's files, with find in files. |
| Database | A PostgreSQL client for the task. Only when the task has a database connection. |
| Docker | The task's containers. Only when it has some. |
| API | An HTTP request client for the task. |
| Preview | A browser view of the task's app. Only when the task has a URL to show. |
| Linear and Rollbar | The issues or errors linked to the task. Only on a task with a link. |

Plugins you install can add more.

## Show, add, and close panes

- **Show a pane.** Click it in the pane switcher. It takes the place of the panes on screen, except
  pinned ones.
- **Add a pane beside the others.** ⌘-click it in the switcher, or right-click it and choose **Open
  beside**.
- **Close a pane.** Click the **×** at the top right of the pane, or right-click it in the switcher and
  choose **Close**. The last pane can't be closed.

Many panes have their own shortcut, such as ⇧⌘A for Agent, ⇧⌘G for Git, and ⇧⌘E for Editor. Hover over
a pane in the switcher to see its shortcut. [Keyboard shortcuts](/docs/using/keyboard-shortcuts/) lists
them all.

## Pin a pane

A pinned pane stays when you show another one, so you can keep the Agent pane beside whatever you're
reading. Click the pin at the top right of the pane, or right-click it in the switcher and choose
**Pin**. Click the pin again, or choose **Unpin**, to release it. A pinned pane has to be unpinned
before it closes.

## Move, resize, and maximize

- **Move a pane.** Run **Move pane left** or **Move pane right** from the **Panes** group in the
  command palette.
- **Resize two panes.** Drag the handle between them. With the handle focused, the arrow keys move it.
  Double-click the handle to make every pane the same width.
- **Maximize a pane.** Press ⇧⌘↩ to fill the task with the focused pane, and again to bring the row
  back. Esc brings the row back too.

The **Panes** group in the palette also shows, closes, and pins each pane by name.

## What acorn saves

acorn saves each task's row, its order, widths, and pins, on the Node, so it's the same on every device
paired with that Node. Which pane is maximized and which has focus aren't saved.

A link can open a task on a given pane. [Links into acorn](/docs/using/links-into-acorn/) covers it.

## A pane no plugin provides

If you turn off or remove the plugin behind a pane, the pane leaves the row, but its place in the saved
row stays. Turn the plugin back on and the pane returns where it was. If none of a task's saved panes
can draw, the task shows the first pane it can.

## In the terminal

The terminal client shows one pane at a time, with a strip of the task's pane labels above it. The
shown pane's label is in brackets, such as `[Agent]`. A pane's markers show as `+N` after its label.
Switching panes switches which one is drawn, and there's nothing to resize, pin, or maximize. Inside a
pane, Ctrl+Shift and an arrow move the split between its two halves.

## Limits

- The row is the same for everyone who opens the task, because the Node saves it.
- A pane that needs something the task doesn't have, such as a pull request or a database connection,
  doesn't appear in the switcher.
