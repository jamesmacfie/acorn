# Phase 3: the Memory page and import

Status: implemented, 2026-10-02. Depends on [phase 2](./02-remove-findings.md), which removes the review
section this page replaces.

## Goal

The Memory page becomes a plain library the owner can trust: every memory readable and editable, every
recent agent write visible with **Undo**, every earlier version restorable, and the exact text a new
session receives on show. The owner can also bring in memory written elsewhere, once.

## What the owner gets at the end

- One page per project, reached from the rail as it is today, listing that project's memories and the
  owner's private memories.
- A change feed at the top: what agents saved or deleted, when, in which task and session, with **Undo**.
- A reader and an editor for each memory, with its version history and **Restore**.
- A preview of standing context: the contract and the two capped indexes, exactly as a new session
  would get them, with the truncation marker where it applies.
- A settings section for the two index caps.
- **Import memory**, which copies memories from Claude Code's memory folder for this project and from
  any `.acorn/memory` folder in the project's checkout.

## Starting point

- The page is `plugins/memory/src/client/MemoryCenter.tsx`, with a manual add form and a name filter.
- The device routes are in `plugins/memory/src/server/routes/knowledge.ts`.
- Phase 1 writes `changes.jsonl` and `.history/`. Phase 2 makes every read a file scan.

## Requirements

### The library

1. The page lists project and private memories in two groups, each most recently updated first.
2. The filter box matches name, description, and body, through the same scan as `memory_search`.
3. Selecting a memory shows its body, type, scope, `updatedAt`, and who last wrote it: the owner, or an
   agent with a link to the session.
4. **Edit** changes the name, description, type, body, or scope. Moving scope moves the file. Saving
   uses the same hash rule as the agent tools, so an edit that races an agent write reports a conflict
   instead of overwriting.
5. **Delete** moves the memory to history, like `memory_delete`.
6. **History** lists up to 20 earlier versions with their timestamps and authors. **Restore** writes a
   version back as current.
7. **Add memory** keeps the four fields it has today: name, type, scope, and body, plus a description.

### The change feed

8. The feed shows the 50 most recent lines of `changes.jsonl` for this project and for private scope.
9. Each line names the action, the memory, the author, and the time, links to the task and session when
   an agent made it, and offers **Undo** while the change is still the latest for that memory.
10. The feed updates when `plugin:memory:memories-changed` arrives.

### Standing context

11. A **What agents see** section renders the text the capability from phase 1 would return for a new
    session in this project.
12. It shows each index's character count against its cap.
13. The two caps are editable here and stored in memory preferences. A change applies to sessions
    created after it.

### Import

14. **Import memory** lists candidate sources that exist on the machine:
    - Claude Code's memory folder for this project's checkout.
    - A `.acorn/memory` folder in the project's primary checkout.
15. The owner picks a source and sees every file it would import, with name collisions marked.
16. Import copies files into project scope. It maps each file's type to the four-value set, keeps names,
    and skips collisions unless the owner chooses to overwrite. Every imported file gets a change log
    line with author `import`.
17. Import never modifies or deletes the source.
18. The same import is offered to the TUI and the CLI, as `acorn plugin memory import`.

### Terminal client

19. The TUI's memory surface offers the library, the feed with **Undo**, and the standing context
    preview. Editing a body opens the file in `$EDITOR`.

## Out of scope

- Deduplicating imported memories against existing ones beyond exact name collisions.
- Importing from Codex or other harnesses. Add each once someone confirms where it keeps memory.
- Bulk edit.

## Steps and checkpoints

### 1. Library and history

**Checkpoint 1.** Edit a memory on the page while an agent in another window updates the same one. The
second save reports a conflict and shows the other version. Delete a memory, then restore it from
history.

### 2. The change feed

**Checkpoint 2.** Ask an agent to save three memories. The feed shows three lines within a second, each
linking to the session. **Undo** on the second one removes only that memory.

### 3. Standing context preview

**Checkpoint 3.** Lower the project cap to 500 characters. The preview shows the marker, a new chat
quotes the same marker, and a chat created before the change does not.

### 4. Import

**Checkpoint 4.** On a machine with a Claude Code memory folder for the project, import it. Every file
appears in project scope with its body intact, `MEMORY.md` is regenerated, and the Claude Code folder
is unchanged.

### 5. Terminal

Run the TUI flow in the isolated PTY driver, as [local development](../../local-development.md)
describes.

**Checkpoint 5.** In the TUI, open memory, read a memory, undo the latest change, and see the standing
context preview at 120 by 40.

## Docs that change

- [Notes and memory](../../notes-and-memory.md) § The Memory page: the library, feed, history,
  preview, caps, and import.
- [Command palette and shortcuts](../../command-palette-and-shortcuts.md): the memory commands.
- [CLI](../../cli.md): `acorn plugin memory import`.
- [Testing](../../testing.md): the manual checks above.

## Verify before building

- How Claude Code names a project's memory folder, including for a worktree of a repository. On the
  owner's machine, sessions in Acorn worktrees used the folder of the main checkout.
- Whether the memory page belongs on the project route or on its own rail entry once the review
  section is gone.
- The TUI's current memory surface, if it has one.
- Whether a compiled plugin can register a CLI command the way a loaded manifest's `cliCommands` does.
  If it cannot, import stays in the desktop and TUI.

## Delivery record

The library, hash-checked edits and scope moves, history and restore, change feed and Undo,
standing-context preview and cap settings, and source preview/import are implemented. Desktop and
TUI use the same project rail source. The TUI body editor uses a disposable file and the guarded save
path. The owning contract is [notes and memory](../../notes-and-memory.md).

The compiled Node plugin context does not expose CLI command registration, and compiled descriptors
have no manifest `cliCommands` source. Per the fallback above, import stays in desktop and TUI.
Claude discovery follows Git's common directory to the main repository and honors the Node's Claude
config directory and project-name environment overrides. Custom `autoMemoryDirectory` settings
remain outside this phase's source discovery.

### Verification

- `pnpm lint`: all 36 packages pass. Memory: 55 tests pass; TUI: 663 pass and two existing skips;
  architecture: 74 pass; Node route registry: 36 pass.
- The isolated Tauri window verified a racing agent write with the owner draft preserved and the
  current body shown, delete/restore, body-only search, exact standing context, and saved cap settings.
- The isolated PTY at 120 by 40 verified reading a memory, its session link, the context preview,
  and Undo removing the memory and refreshing the index. A real PTY test verifies `$EDITOR` returns
  the edited draft and removes its temporary directory. Both acceptance sessions were stopped.
- Acceptance exposed two supporting fixes: the Node build now embeds the contract before TypeScript
  transformation, and the TUI shell replaces each source's render and focus lifetime together. The
  source-switch regression fails on the previous shell and passes with the fix.
- The Node build passes its service budget. The TUI compiles, but its existing startup gate remains
  over budget: 1,198,199 bytes against 1,175,000. Before the source fix, a diagnostic build replacing
  the entire memory page with an empty component had the same 1,198,244-byte startup graph as the
  feature build. Functional PTY checks used the compiled bundle with `--no-build`.
- The generic `navigation` flow was attempted and failed at its `Agents 1` target before the source
  fix. The memory-specific checks above were driven explicitly; that generic flow is not recorded
  as passing.
