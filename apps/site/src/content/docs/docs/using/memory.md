---
title: Memory
description: What agents save for later sessions, what they're told about it, and how you read, edit, undo, and import it.
sources:
  - docs/notes-and-memory.md
  - docs/notes-and-memory/memory-page.md
  - docs/managed-agents/sessions.md
checked: 90ded85ca
---

This page covers memory: the facts agents save so a later session doesn't start from nothing, how
each new session learns about them, and the Memory page where you read, change, undo, and import them.

## What agents save

An agent saves a memory when it learns something a later session would need: a convention the code
doesn't show, a decision and its reason, or how you like to work. Each memory is one Markdown file with
a name, a one-line description, a type, and a body.

| Type | For |
| --- | --- |
| `user` | Who you are and how you like to work |
| `feedback` | A correction or a confirmed approach, with the reason |
| `project` | Work, goals, and constraints the repository doesn't record |
| `reference` | Pointers to things outside the code, such as a dashboard |

A memory is **project** scope, for one project, or **private** scope, about you and shared across every
project. Memories are files on the Node's machine, in `~/.acorn/memory`, or in `memory/` under the
Node's data folder when the Node runs with `ACORN_DATA_DIR` set. Saving a memory never changes your
repository.

Before saving, acorn checks the memory: the description is one line of at most 200 characters, the
body is at most 16 KiB, and it refuses text that looks like a secret, a private key, or an instruction
trying to override yours.

## What a new session is told

Each new agent session starts with the memory contract, which tells the agent what memory is and
when to save, followed by two indexes: your private memories and this project's. The indexes hold each
memory's name and description, not its body, so the agent reads a body only when it needs one.

The private index is capped at 4,000 characters and the project index at 12,000, cutting at whole
lines and saying how many it left out. A session keeps the memory it started with. A memory saved
during the session reaches the next one, or any session that searches for it.

## The Memory page

Click **Memory** in the left rail. The page lists this project's memories, newest first, beside a
detail column. Private memories aren't listed here.

- **Find one.** Type in the filter. It matches every word across names, descriptions, and bodies, and
  shows up to 10 results.
- **Read one.** Select it to see its body, type, scope, when it changed, and who changed it. A change
  an agent made links to that agent's session.
- **Add one.** Click **New**, fill in the name, description, type, and body, and save. It's saved in
  project scope.
- **Change one.** Click **Edit**. If an agent changes the memory while you're editing, acorn keeps your
  draft and shows **Reload current version**.
- **Delete or restore.** **Delete** and **Restore** each ask for a second press. **History** lists up
  to 20 earlier versions, and **Restore** puts one back.

With nothing selected, the detail column shows three sections:

- **Recent changes** lists the last 50 changes in this project, with who made each. **Undo** appears on
  a change when nothing has changed that memory since.
- **Project context** shows exactly what a new session gets for this project: the contract and the
  index, with their sizes. You can change the project index's cap here, from 200 to 32,000 characters.
  Sessions that start after you save get the new cap.
- **Import memory** brings in memories from elsewhere.

## Undo an agent's change

When an agent saves or deletes a memory, its transcript shows a card with the memory's name and
description, and **Undo**. A project memory also has **Open**, which shows it on the Memory page. Undo
puts back what was there before, or deletes a memory the agent created. It refuses if the memory has
changed since.

## Import Claude memory files

**Import memory** finds two sources on the Node: Claude Code's memory folder for this repository, and a
`.acorn/memory` folder in the project's checkout.

1. Choose a source. acorn lists each file with its description, type, and body, and marks names that
   already exist.
2. Tick **Overwrite** on any file you want to replace an existing memory. Without it, a name that
   exists is skipped.
3. Import. Each file goes through the same checks as an agent's save, and a failure is reported for
   that file only.

The source files aren't changed. Files larger than 64 KiB, links, and `MEMORY.md` are skipped.

## From the command palette

**Search memory** searches this project's memories and opens the one you pick on the Memory page.

## In the terminal

The terminal client draws the same Memory page: the list, **Recent changes**, history, **Project
context**, and **Import memory**. To edit a memory's body, choose **Edit body in $EDITOR**, which opens
your editor on the body. When you exit the editor, the body comes back to the form, and **Save memory**
saves it.

## Limits

- The Memory page lists only project memories. Private memories reach every session, but you change
  them through an agent, or as files.
- Each memory keeps 20 earlier versions, and the change log keeps the last 1,000 changes.
- Undo refuses once anything else has changed that memory, including an edit outside acorn.
- A session's memory is fixed when it starts. A later save doesn't reach a running session unless it
  searches.
