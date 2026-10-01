# 08-12. Notes: a toggle that renames itself, a footer that jumps, and emoji marks

**Status:** not started. Batch B08b. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

Notes switches between edit and preview with one toggle whose label flips between **Preview** and
**Edit** while its pressed state also flips, so a pressed **Edit** means "you are in preview". The
diff's two views are a segmented control. The status strip sits at the bottom in edit mode and jumps
up under the text in preview. Scope and author marks are "◆ task", "ws", "🌐", "🤖", and "seed", and
the same helpers are copied into Context. The strip shows the note's size in bytes.

## Where to see it

**Review changed files** › **Notes**, on the fixture note "Review checklist". Switch to preview.

## The fix

The partial fix. Whether saving a note toasts is a product call (the comment at `NotesPane.tsx:171`
makes the toast deliberate), so the toast stays (plan decision 14; see [deferred.md](../deferred.md)).

- `plugins/notes/src/client/NotesPane.tsx:165-170`: the self-renaming `ToggleButton` becomes
  `SegmentedControl size="sm"` with **Edit** | **Preview**.
- `NotesPane.tsx:191-203`: remove the status strip. **Show in Context** moves to the header as ghost
  sm.
- `NotesPane.tsx:15-16` and `plugins/context/src/client/ContextPane.tsx:18-21`: scope and author are
  `Badge size="xs"` words from one shared helper.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `NotesPane.tsx:15` | ◆ task / ws / 🌐 | Rewrite | Task / Workspace / Everywhere, as `Badge size="xs"` |
| `NotesPane.tsx:16` | 🤖 / seed | Rewrite | By agent / From a workflow, as `Badge size="xs"`, or nothing for your own |
| `NotesPane.tsx:23` | filter… | Rewrite | Filter notes… |
| `NotesPane.tsx:75` | New {Task} note | Rewrite | New task note / New workspace note / New note for everywhere |
| `NotesPane.tsx:139` | Notes need the desktop app. | Keep | |
| `NotesPane.tsx:151` | Untitled | Keep | |
| `NotesPane.tsx:167` | Preview / Edit | Rewrite | A segmented **Edit** and **Preview**. |
| `NotesPane.tsx:172` | saving… | Rewrite | Saving… |
| `NotesPane.tsx:192` | {size} | Remove | |
| `NotesPane.tsx:201` | view in Context → | Rewrite | Show in Context |

Held: `notesModel.ts:183`'s "Note saved" toast waits with the toast decision. `NotesPane.tsx:61`'s
delete is already **Delete note?** (K1a). `:142` is done by
[08-15](../b08a-changes-and-diff/08-15-changes-states.md). The include box's tip is
[08-11](../b08a-changes-and-diff/08-11-checkboxes.md)'s.

## Risk and checks

- Before you start, check what else reads the status strip's size text.
- Screens: Notes with the scratchpad only, a note being edited, and preview.
- Tests: `plugins/notes`, `plugins/context`.
