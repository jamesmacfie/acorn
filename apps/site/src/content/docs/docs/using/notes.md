---
title: Notes
description: Keep Markdown notes on a task, a project or workspace, or everywhere, and hand them to an agent.
sources:
  - docs/notes-and-memory.md
  - docs/agent-tools/context-sections.md
  - plugins/notes/src/client/NotesPane.tsx
  - plugins/notes/src/client/commands.ts
checked: 90ded85ca
---

This page covers the Notes pane: the three places a note can live, writing and finding notes, and how
a note reaches an agent. Use notes for anything you'd otherwise keep in a scratch file: a plan, a
checklist, the command that reproduces a bug.

## Where a note lives

A note has one of three scopes, and the Notes pane lists all three in one column:

| Scope | Who sees it |
| --- | --- |
| **Task** | Only this task. Every task starts with a **Scratchpad**, which is saved the first time you type in it. |
| **Workspace**, or **Project** with projects separate | Every task in the workspace. |
| **Everywhere** | Every task on the Node. |

Notes are Markdown files on the Node, under `notes/` in its data folder, so you can read or edit one
with any editor.

## Write a note

1. Open the task's **Notes** pane from the pane switcher, or press ⇧⌘D.
2. Click the **+** beside a scope: **New task note**, **New project note** (or workspace note), or
   **New note for everywhere**.
3. Type a title in **Note title** and the body below it. **Edit** and **Preview** switch between the
   Markdown and how it reads.

Notes save as you type, after a short pause. If a save fails, your text stays in the pane, and on this
device, until a save goes through. To delete a note, open the actions menu on its row in the list,
choose **Delete**, and confirm. Each row also has its own box for including it in the agent's context.

From the command palette, **Create a task note** asks for a title and creates the note. **Find a note**
searches all three scopes at once.

## Send a note to an agent

A note reaches an agent through the task's context:

1. Open the note, and tick **Include in the agent's context**.
2. Click **Show in Context** to see it in the Context pane, with the size it adds.

An included note goes to the agent with the task's context. A new agent session gets it with its first
message. When you change a note an agent already has, the message box says the context changed, and
the refreshed context goes with your next message. [Task context](/docs/using/task-context/) covers it.

Agents can also read notes, and add to them, with their own tools. A note an agent writes is marked as
the agent's, with the session that wrote it. An agent can't include or leave out a note for itself:
**Include in the agent's context** is yours to set.

When an agent starts another agent, the new one gets a copy of the included notes that apply to
its work, in a **Notes · attached** fold in its transcript. The copy holds
up to 10 notes, each cut at 2,000 bytes.

## Notes made for you

A task made from a GitHub pull request starts with notes holding the pull request's description, its
comments, and its linked Linear issue, one note per source. They reach the agent with the task's
context, and they don't show in the pane's list, because you didn't write them.

## In the terminal

The terminal client draws the same Notes pane, with the same scopes and controls. The palette's
**Find a note** and **Create a task note** work there too.

## Limits

- Two clients editing one note at the same time don't merge. The last save wins.
- The copy a new agent gets is fixed when it starts. Editing a note later doesn't change it.
- Notes stay on the Node they were written on. They don't sync between Nodes.
