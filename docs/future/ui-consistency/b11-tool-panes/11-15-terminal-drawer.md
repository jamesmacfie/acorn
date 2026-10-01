# 11-15. The terminal drawer names every shell after the task

**Status:** not started. Batch B11. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

Every shell tab in a task's terminal drawer is named after the task ("Review changed files"), so two
tabs cannot be told apart. An error is an inline `Alert` on the drawer's edge with no inset. The empty
state has no title and tells you to press a glyph. An idle agent tab explains itself only in a native
`title`.

## Where to see it

**Review changed files** › open the terminal drawer, and open a second shell.

## Already done

- B02's 02-18 fixed the drawer strip: **Stop** with its tip and ⌃C, **New terminal**, and **Hide
  terminals** with "They keep running.".
- K4a applied area 03's menu rows: a missing CLI reads **Not installed** with the tip "acorn can't find
  {name} on your PATH.", and the no-tmux item reads **Closes when acorn quits**. The profile menu part
  of this finding is done.
- K3 routes a tab's `title` to the styled tip.

## The fix

In `plugins/terminal/src/client/TerminalPanel.tsx`:

- `:196-201`: shells are named "Shell", "Shell 2" when created, with the task in the tab's tip. The
  title is saved on the node, so pick the number at creation.
- `:265`: the idle tip, per the copy below.
- `:323`: the error `Alert` as a banner in the drawer's inset.
- `:343-346`: `EmptyState` "No terminals" with **New terminal**.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `:198` (`titleFor`) | the task's title, for every shell | Rewrite | Shell, Shell 2, … (the task in the tab's tip) |
| `:217` | Failed to start the session. | Rewrite | Couldn't start the terminal. |
| `:265` | Agent idle — may be waiting for input (native title) | Rewrite | tip "Idle. It may be waiting for you." |
| `:345` | Launching… / No sessions. Press + to open one. | Rewrite | Starting… / Title "No terminals", action **New terminal** |

## Risk and checks

- Before you start, check how a shell's title is stored, so renaming on creation does not rename old
  sessions.
- B02 left a terminal session running in **Review changed files**. It is fine to use; do not close the
  user's sessions elsewhere.
- Screens: the drawer with two shells, and the empty and error states (from code).
- Tests: `plugins/terminal`.
