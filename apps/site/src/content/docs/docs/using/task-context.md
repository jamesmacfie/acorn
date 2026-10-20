---
title: Task context
description: Choose what an agent knows about its task, preview it, see its size, and send it to a session.
sources:
  - docs/agent-tools/context-sections.md
  - docs/notes-and-memory.md
  - plugins/context/src/client/ContextPane.tsx
  - plugins/context/src/client/contextModel.ts
checked: '70489f534'
---

This page covers task context: the bundle of facts an agent gets about the task it works in, and the
Context pane where you choose, preview, size, and send it. Read it when an agent doesn't know something
about the task that acorn already does.

## What's in it

Task context is built from sections, in this order:

| Section | What it holds |
| --- | --- |
| Pull request | The task's pull request and its description |
| Issues | The Linear issues and Rollbar items linked to the task, and the tools the agent can use to read more |
| Notes | The notes you've included in the agent's context |
| Task scripts | Whether setup and teardown ran and how they ended, without their output |

A section appears only when the task has something for it. Plugins can add sections of their own, and
some, such as **Plugin authoring**, are off until you tick them.

acorn keeps the whole bundle under 512 KiB, and each section within its own share. A section that's
too long says how many items it left out.

## Choose and preview

Open the **Context** pane from the pane switcher, press ⇧⌘X, or run **Open the Context pane** from the
command palette.

1. Each section has a box: **Include \<section\> in the agent's context**. Tick or clear it. Your choice
   is saved on this device.
2. Each section shows its size, and a meter for how much of its share it uses. Expand an item to read
   it. A note has **Edit in Notes**, which opens it in the Notes pane.
3. **What the agent gets**, at the bottom, is the exact text a send delivers, with its size.

**Refresh** at the top reads every section again.

## Send it to a session

A new agent session gets the task's context with its first message on its own. The message box shows a
**Task context** chip with its size, and **Preview sent context** shows the exact text.

To send it to a session that's already running:

1. In the Context pane, click the session picker and choose a session. Only this task's sessions are
   listed.
2. Click **Send context**.

The pane then says when you last sent it, such as **Sent 2m ago**. When the task's context changes
afterward, it says how many changes there have been since. In the session itself, the message box says
the context changed, and the refreshed context goes with your next message.

## Where memory fits

Memory isn't a section. Each new session gets your memory indexes on its own, when it starts.
[Memory](/docs/using/memory/) covers it.

## In the terminal

The terminal client draws the same Context pane, with the same boxes, sizes, preview, and **Send
context**.

## Limits

- An agent sees the context as it was when it was sent, until the next send.
- Your section choices are per device. An agent that another agent starts doesn't use them, and gets
  every note marked **Include in the agent's context** for its work.
- The total is capped at 512 KiB, so a large pull request or a long note can be cut short.
