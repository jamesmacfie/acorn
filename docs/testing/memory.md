# Memory checks

Run these checks when you change the memory plugin, the Memory page, or how agents write memory.
[Notes and memory](../notes-and-memory.md) § Memory owns the behavior. The automated storage, import,
preview, and route tests are in the memory plugin. Run `pnpm --filter @acorn/plugin-memory test` and
`pnpm lint` first.

## Real-window checks

Run these in an isolated `pnpm dev:agent` session:

1. Add a project memory from the Memory page and open its body. Confirm that the file and its change
   log stay under the session's data root.
2. Open a `memory_write` transcript card from a task URL. **Open** shows that task's project memory.
   **Undo** removes a newly created file or restores its earlier version.
3. Confirm that the Context pane has no memory section.
4. Add a memory, edit it, and race an agent update against an open draft. Confirm that the draft
   survives, the current body shows, and saving asks for a reload.
5. Delete the memory and restore a retained history version.
6. Save three agent memories and confirm that the feed links to their tasks and sessions. Undo the
   second creation and confirm that only that memory goes.
7. Set the project index cap to 500 characters. Confirm that the preview's truncation marker matches a
   fresh session's standing context, and that an older session keeps its snapshot.
8. Preview and import a fixture Claude folder. Check the bodies, mapped types, regenerated index,
   import attribution, the skip and overwrite choices for collisions, and that the source files
   didn't change.
9. In the isolated terminal driver at 120 by 40, repeat library reading, Undo, the context preview,
   and editing in `$EDITOR`.

## Recorded results

The October 2, 2026, delivery checks covered the isolated Tauri page and transcript **Open** and
**Undo**. They also covered conflicting edits with the draft kept, delete and restore, body-only
search, the standing-context preview, and cap settings. Isolated terminal checks at 120 by 40 covered
reading, session links, the context preview, and Undo. A real PTY test covered the disposable
`$EDITOR` draft. These checks don't establish how an external model behaves in ordinary use.

## Open acceptance

Use managed Claude, managed Codex, and terminal agents in ordinary work to check useful memory saves,
standing-context delivery, and snapshot behavior on resume. Driver and admission tests check prompt
delivery and stored snapshots, but they can't show whether a model chooses useful memories.

Over two weeks of ordinary work, record:

- Writes per project.
- Owner Undo and delete counts, with reasons.
- Examples of good and bad saves.
- Whether the owner wants a review queue.

The owner asked to remove Findings before this measurement finished. The measurement is still open.
