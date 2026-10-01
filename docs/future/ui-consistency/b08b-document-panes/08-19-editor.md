# 08-19. Editor: "$EDITOR → agent" reads as one phrase, and code is a different size from the diff

**Status:** not started. Batch B08b. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The editor's tab strip has two bare text buttons, 48 by 11, 3 pixels apart: "$EDITOR" then "→ agent",
which reads as "send $EDITOR to agent". A save error is an inline `Alert` inside the 48-pixel strip.
The editor draws code at 13 pixels while the diff draws the same file at 12, so opening a line from
the diff in the editor changes the text size.

## Where to see it

**Review changed files** › **Editor** pane. Open a file from the tree.

## The fix

- `plugins/editor/src/client/EditorPane.tsx:581-612`: **$EDITOR** stays a mode switch: a `ToggleButton
  iconOnly` with `square-terminal`, a `label`, `tip` "Edit in your terminal editor", and `tipSub` "Uses
  $EDITOR".
- **→ agent** becomes `IconButton icon="send"` with tip "Add to your message to the agent".
- The save-error `Alert` moves under the strip as a banner.
- `packages/client-core/src/features/editor/theme.ts:91-93`: `fontSize: token('--fs-sm')`.

Leave the diff's 20-pixel line height alone; its geometry depends on it.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `EditorPane.tsx:537` | Open a terminal first to map this repo's checkout. | Rewrite | Title "Can't find this task's files". Body "Open a terminal in this task, then try again." |
| `EditorPane.tsx:586, 589` | $EDITOR, tip "Edit in $EDITOR, in a terminal inside this pane" | Rewrite | Icon button, tip "Edit in your terminal editor", `tipSub` "Uses $EDITOR" |
| `EditorPane.tsx:594, 608` | → agent, tip "Add file/selection reference to the agent composer" | Rewrite | Icon button, tip "Add to your message to the agent" |
| (new, no file open) | (nothing) | Rewrite | Title "No file open". Body: name the command ("Pick one from the list, or use **Go to file**"), or show its bound chord through `formatChord`. |

The no-file empty state's placement over the editor box is deferred (it must not unmount CodeMirror),
so the last row lands only with it.

## What earlier batches give you

- **`formatChord`** (B02), from `@acorn/plugin-api/client`, for the plan's overrule on row 776: name
  the command or show the bound chord through the formatter, never a hard-coded "⌘P".
- **`IconButton` tip defaults to its label** (K3).

## Risk and checks

- Before you start, confirm the theme sets no font size today.
- The font size change reaches CodeMirror. Open a long file and check line layout and the cursor.
- Screens: the editor with no file and with a file open.
- Tests: `plugins/editor`, client-core.
