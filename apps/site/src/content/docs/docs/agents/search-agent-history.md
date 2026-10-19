---
title: Search agent history
description: Find what an agent said or did in any session, including archived tasks, and how long that history is kept.
sources:
  - docs/managed-agents/transcript-search.md
  - docs/managed-agents/history-retention.md
  - docs/managed-agents/palette.md
  - docs/managed-agents/cross-session-reads.md
  - plugins/agents/src/shared/sessionDefaults.ts
checked: 52225e24f
---

This page covers searching agent transcripts: across tasks in Agent Center, in one task from the
palette, in the archive, and by agents themselves. It ends with how long acorn keeps history for
archived tasks.

Every search reads one full-text index on the Node, over every session's messages, tool calls, and
file changes. The index stays on the Node.

## Search across tasks

1. Open Agent Center: the **Agents** source in the left rail, or **Open Agents** in the palette.
2. Type in **Search sessions**. Narrow it with **Provider**, the scope, and the session state.
3. Pick a result to open that session in its task.

Matches in what you and the agent wrote rank above matches in tool output, so a file dump doesn't bury
the conversation.

## Search one task

From the command palette, **Find an agent session** searches the open task's sessions: their titles,
their events, and their artifacts. It returns up to 50 results, best match first.

## Search the archive

The archive page's search finds archived tasks by their agent history too
([Archive and restore](/docs/using/archive-and-restore/)). Opening a result previews the task,
including its Agent pane, read-only.

## How agents search history

Agents have read tools for history, in the **Read tools** tier:

- `session_history_search` and `session_history_read` let an agent find and page through its own
  session, such as after the harness shortened the conversation.
- `agent_session_list`, `agent_session_search`, and `agent_session_read` reach other sessions in the
  same project. They read only. They can't send to a session, stop it, or answer for it.

An agent gets old text marked as a record of what appeared, not as a new instruction. Search matches
words, so a paraphrase can miss.

## How long history is kept

By default, acorn keeps every session's history for as long as its task exists, archived or not.

To free space, set **Keep agent history for archived tasks** under **Settings** > **Agents** >
**Harnesses and defaults** to 30 days, 90 days, or 1 year. Once a task has been archived that long,
a daily pass removes each of its sessions' events, attachments, and files, and leaves one note in place
of the transcript, such as "Acorn removed this session's history because its task had been archived
for more than 90 days." Search then finds only the title and the note.

- The pass skips a session that's running, and tries again the next day.
- Restoring a task stops the clock, so an active task is never pruned.
- The session row stays, so the task still lists it, and you can still prompt it. The harness keeps
  its own copy of the conversation, so the agent remembers what the transcript lost.
- Removed history can't be brought back.

The database file keeps its size after a pass, and reuses the freed space for new history.

## In the terminal

The palette's **Find an agent session** and Agent Center's search work in the terminal client too.

## Limits

- Search is lexical: it matches words, not meaning.
- A window that had a pruned session open keeps showing what it drew until it reloads.
- Nothing deletes history from an active task. Archive the task first.
