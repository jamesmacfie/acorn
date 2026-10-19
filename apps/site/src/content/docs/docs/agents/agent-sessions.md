---
title: Agent sessions
description: Start, read, and continue a conversation with a coding agent.
sources:
  - docs/managed-agents/sessions.md
  - docs/managed-agents/transcript.md
  - docs/managed-agents/composer.md
  - docs/managed-agents/client-surfaces.md
  - docs/managed-agents/palette.md
  - docs/terminal.md
  - plugins/agents/src/client/sessions/agentPaneModel.ts
  - plugins/agents/src/shared/schemas.ts
checked: '05009afda'
---

This page covers managed agent sessions: starting one in a task, writing to it, reading its
transcript, and what the session menu does. A managed session is a Claude Code or Codex conversation
that acorn drives and records, so you can read it, search it, and come back to it later.

## Start a session

A session belongs to one task and runs in that task's worktree.

1. Open a task, then open its **Agent** pane from the pane switcher.
2. With no sessions yet, the pane shows a card for each harness this Node can run. Click
   **Claude Code** or **Codex**. Once the task has sessions, use **New** in the pane's header instead.

The session opens with **Connecting…** above the message box, then says it's ready for its first turn.
A harness that isn't installed on the Node shows why on its card, such as
`codex is not available on PATH.`, and can't be picked.

From the command palette, **New agent session** lists the same harnesses and your
[custom agents](/docs/agents/custom-agents/). It needs an open task.

A new session starts on the settings you last used for that harness.
[Harnesses and defaults](/docs/agents/harnesses-and-defaults/) says how to change that.

## Write a turn

The message box sits under the transcript. Above it are the session's pickers, such as **Mode**,
**Model**, and **Effort**. The harness supplies the choices, so Claude Code and Codex show different
ones. A change applies from the next turn.

- Press Enter to send, and Shift+Enter for a new line.
- Type `@` to mention a file in the worktree, `/` for the harness's commands, and `$` for its skills.
  The lists are what the harness reported when the session last started.
- Press ⌘⇧↩ on macOS, or Ctrl+Shift+Enter elsewhere, to grow the box from three rows to 18. acorn
  remembers the size per session.
- **Attach** adds files and pictures, and **Context** adds task context or another session.
  [Files, attachments, and context](/docs/agents/files-attachments-and-context/) covers both.
- **Goal** sets a completion condition the agent keeps working toward.
  [Steering, queues, and follow-ups](/docs/agents/steering-queues-and-follow-ups/) covers goals.

Unsent text stays with its session, so switching sessions or tasks keeps what you typed.

The first message names the session. A first prompt of five words or more also gets a shorter title
that the same harness writes in the background, with tools off. A rename always wins over it.

## Read the transcript

The transcript draws each event as a card: your messages, the agent's replies, tool calls, plans,
file changes, and requests that need you.

- **A tool call is one card**, however many updates the harness sends. Its input and output sit behind
  a disclosure. A file edit opens onto its diff, with **Open in Changes**.
- **A request card** is where the agent is blocked: a permission, a question, or a form. Answer it in
  place. [Permissions and approvals](/docs/agents/permissions-and-approvals/) covers what each answer
  does.
- **Turn complete** ends each turn, with why it stopped on the left and how full the context window
  is on the right.
- **A subagent** is one card in its parent's transcript.
  [Delegation and subagents](/docs/agents/delegation-and-subagents/) covers it.

A long session draws its newest 200 cards. **Show earlier** adds 200 more, and **Go to top** draws
everything. The transcript follows the newest turn until you scroll away, and remembers your place
when you come back.

The toolbar above the transcript has **Show only agent and user messages**, which keeps questions and
anything still blocking, and **Collapse every tool card**. Whether tool cards start open is the
**Tool call display** setting.

An agent's message has a **Copy** menu for its text, Markdown, or JSON.

## The session menu

The ••• menu in the session header, **Session actions**, holds what you can do to the whole session.
The palette's **Agent session** group lists the same actions for the open session.

| Action | What it does |
| --- | --- |
| **Fork session** | Starts a new session, titled with **(fork)**, on the same settings. Codex forks its own thread. On other harnesses, acorn sends a copy of the transcript with the new session's first turn. Finish or stop the running turn first. |
| **Retry last turn with partial history** | Shown after a turn failed or was interrupted. Sends it again. |
| **Compact context** | Asks the harness to shorten the conversation. Codex offers it; Claude Code doesn't. |
| **Continue in terminal** | Hands the session to the harness's own CLI in the terminal drawer. |
| **Regenerate title** | Asks the harness for a new title from the first prompt. |
| **Rename session** | Sets the title yourself. |
| **Copy session ID** | Copies acorn's ID for the session. |
| **Summarize run…** | Writes a Markdown summary of the session with a model you pick. It adds no turn. |
| **Export Markdown**, **Export lossless JSON** | Saves the transcript as a file. |
| **Export Markdown without secrets**, **Export JSON without secrets** | The same, with likely secrets redacted in the copy. |
| **Archive session…** | Takes the session out of the live lists, after asking. |

## Hand a session to the terminal

**Continue in terminal** opens the harness's own CLI in the task's terminal drawer, on the same
conversation. While the terminal holds the session, the managed message box is turned off, so the two
can't write to it at once.

To come back, exit the CLI in the terminal, then choose **Return to managed mode** from the session
menu. acorn resumes the conversation from where the CLI left it. The item is turned off when the
harness gave acorn nothing to resume from.

## Archive a session

**Archive session…** asks first, then moves the session out of the Agent pane's list, Agent Center,
and the inbox. Agent Center's archived filter has **Restore** for a session you archived on its own.

Sessions under an archived task leave the live lists too, and their agent processes stop. After you
restore the task, the next prompt resumes each session. [Archive and restore](/docs/using/archive-and-restore/)
covers the task side.

## Agent Center

Agent Center is the **Agents** source in the left rail, or **Open Agents** in the palette. It
lists sessions across tasks with their state, counts how many are working and how many need you, and
shows each harness's health. Search there covers every session's transcript
([Search agent history](/docs/agents/search-agent-history/)).

## In the terminal

The terminal client draws the same Agent pane: the roster, the transcript, the message box, the
queue, and request cards. You can start a session, answer what it's waiting on, and send turns.
Some parts need the desktop app:

- **Attach**, the two **Export** rows, and an artifact's download, because they need a file picker.
- **Continue in terminal**, because the terminal client draws no terminal drawer.
- The palette's row per harness, such as **New Claude Code session**, and its two agent settings.

Press Alt+E to grow the message box in terminals that can't tell Ctrl+Shift+Enter from Enter.

Two more places reach a session: the browser panel, beside the page the work is about ([Talk to an
agent from the browser](/docs/browser-extension/talk-to-an-agent-from-the-browser/)), and the command
line's `acorn agent` commands, for scripts ([The command
line](/docs/automation/the-command-line/#agents-and-workflows)).

## Limits

- acorn has no control for importing a transcript from another tool. The Node accepts one through its
  HTTP API, as an imported session you can read and then reconnect with **Reconnect session**.
- Claude Code's subagents have no stop control of their own. Stop the parent turn instead.
- A fork on a harness other than Codex starts a fresh conversation. The agent reads a copy of the
  old transcript as context, not its own history, and the copy leaves out tool output.
