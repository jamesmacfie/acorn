# 08-11. Checkboxes mean three things in three places

**Status:** not started. Batch B08a. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

In Changes, ticking a row's box stages the file. In Notes it lets the agent read the note. In GitHub's
file list it marks the file viewed. The box sits trailing in Changes and leading in Notes. In Changes
the group's box does not line up with the row boxes it controls; it sits over the rows' "···". In Notes
the scratchpad row has no box, so its title starts 20 pixels left of the row under it. The same square
means "commit this", "let the agent read this", and "I've seen this" one click apart.

## Where to see it

**Review changed files** › Changes, and the Notes pane on any task with a note ("Review checklist" on
the fixture task).

## Already done

- K3 routes a `Checkbox`'s `title` to the styled tip, so each box already says what it does on hover
  and focus. The copy below sharpens the words.
- K1a's 08-4 made `RowActions` hide until hover, focus, or selection.

## The fix

One rule for an include or stage box in a list: it is the row's last trailing control, lined up with
its group's box, and it has a styled tip.

- `plugins/changes/src/client/ChangesPane.tsx:234-251`: in `trailing`, `<FileTools/>` first, then the
  box, lined up with the group box.
- `plugins/notes/src/client/NotesPane.tsx:33-67, 110-116`: the include box moves to `trailing` and
  loses its reveal. The delete "x" moves into `RowActions`, so the row can drop `reveal`.
- In a full-width pane (Context), the box leads instead. That is [08-8](../b08b-document-panes/08-8-context.md).

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `ChangesPane.tsx:215` | Staged, then edited again — stage the rest (tip) | Rewrite | Partly staged. Tick to stage the rest. |
| `ChangesPane.tsx:215` | Unstage this file / Stage this file | Keep | |
| `ChangesPane.tsx:224` | {path} — unmerged; staging it marks the conflict resolved | Rewrite | {path} has conflicts. Staging it marks them resolved. |
| `ChangesPane.tsx:289, 352` | Stage everything under {title} / Unstage everything under {title} | Rewrite | Stage all {title} files / Unstage all {title} files (lower-case group word) |
| `NotesPane.tsx:37, 162` | Included in agent context / Excluded from agent context | Rewrite, as `tip` | "Include in the agent's context". The plan's overrule uses this one phrase for the include box in Notes and Context. |
| `fileTools.tsx:32` | Add a file reference to the composer (`title`) | Rewrite | Adds this file to your message to the agent |
| `fileTools.tsx:41` | Put this file back the way the last commit has it — cannot be undone (`title`) | Rewrite | Throws away your changes to this file. You can't undo this. |
| `fileTools.tsx:40` | Discard? | Keep | |

## Risk and checks

- Before you start, measure the row box and the group box x positions; they must match after.
- Rows in the Changes list sit in a virtual list. Change order and props only, not row height.
- Screens: the Changes list (both groups), and Notes with the scratchpad and a note.
- Tests: `plugins/changes`, `plugins/notes`.
