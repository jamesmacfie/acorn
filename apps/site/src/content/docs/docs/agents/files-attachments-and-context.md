---
title: Files, attachments, and context
description: Attach files and pictures to a turn, point an agent at files in the worktree, and choose the context it starts with.
sources:
  - docs/managed-agents/attachments.md
  - docs/managed-agents/composer.md
  - docs/agent-tools/context-sections.md
  - plugins/agents/src/server/sessions/attachmentStore.ts
  - plugins/agents/src/client/composer/attachmentOperations.ts
checked: 52225e24f
---

This page covers the three ways something reaches an agent besides what you type: files you attach,
files you mention in the worktree, and the task's context. Read it when an agent says it can't see
something you meant it to.

## Attach a file or a picture

1. Click **Attach** below the message box, or paste or drop a file onto it.
2. The file shows as a tile above the box. Click its remove button to take it off.
3. Send the turn.

acorn accepts JPEG, PNG, GIF, WebP, PDF, and UTF-8 text or source files:

- Each file is at most 10 MiB, and a text file at most 1 MiB.
- A turn holds at most eight attachments, 25 MiB together.

If one file fails, the others stay attached. A sent picture draws as a tile in the transcript and opens
full size when you click it. Any other file downloads.

Claude Code gets a picture's or a text file's contents in the message. A PDF goes as a path to a copy in
the session's own folder. Codex reads pictures and files from their paths itself.

Before sending, acorn checks attached files for credential-shaped text, as it does before a commit
([Credentials and secrets](/docs/security/credentials-and-secrets/)).

## Point at a file in the worktree

Type `@` in the message box to pick a file from the task's worktree. The mention is drawn in color
when it matches a file exactly, and the agent gets it as a file reference. An `@` that matches nothing
stays plain text.

The agent works in the worktree already, so it can open any file there with its own tools. A mention
saves it the search.

## The task's context

A new session gets the task's context with its first message: the pull request, linked issues, notes
you included, and sections plugins add. The message box shows it as **Task context · attached**, with
its size. **Preview sent context** shows exactly what goes.

Choose what's in it on the task's **Context** pane ([Task context](/docs/using/task-context/)). When the
context changes after a session has it, the message box says so, and the refreshed context goes with
your next message.

An agent can also read the context at any time with the `task_context` tool.

## Reference Acorn context with #

Type `#` in the message box to name something in acorn: another session, a terminal, a container, the
task's context, or a plugin's saved items.

1. Type `#`. The list shows each source, such as `#agent` for sessions and `#terminal` for terminals.
2. Choose one. The list shows its items: for `#agent`, the task's other sessions, newest activity
   first, without the one you're writing to or any subagent.
3. Choose an item. Its token, such as `#agent:refactor-login`, goes into your message, underlined.
4. Send.

**Context** below the message box opens the same list. Tick the items you want, and their tokens go
in at the caret. Untick one, or delete its token, and it's no longer attached.

acorn reads what each token names when you send, and the agent gets it next to your message, marked
with the token:

- `#agent:…` sends a copy of that session's conversation: messages, plans, and file changes, without
  tool output, up to its last 200 events and 100,000 characters. The agent gets it as reference
  material, not as your instructions.
- `#terminal:…` sends the terminal's last 200 lines of output, with token-shaped values such as
  `sk-…` and `Bearer …` redacted. It catches common shapes, not every secret, and you don't see the
  output first.
- `#docker:…` sends a container's image, state, and ports, without environment values or logs.
- `#task` sends the task's context as it stands, the same as a new session's first message.

If acorn can't read one, the message isn't sent, and the error names the token. A message's context
can't pass 512 KiB. In the transcript, a sent token is a link back to what it named.

## In the terminal

The terminal client has no file picker, so **Attach** does nothing there. `@` mentions, task context,
and `#` references work the same way, completing the last word you typed.

## Limits

- An attachment's copy is fixed when you send it. Editing the file later doesn't change what the agent
  got.
- A session's context is a snapshot. An agent sees later changes only when you send again.
- An attachment's preview in the transcript draws pictures up to 8 MiB inline. A larger one is a
  download.
