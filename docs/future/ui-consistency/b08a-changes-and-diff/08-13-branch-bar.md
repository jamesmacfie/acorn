# 08-13. The branch bar cuts the branch name and keeps the project name

**Status:** not started. Batch B08a. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The branch bar under the Changes list holds the branch icon, "repo /", the branch, a copy button, a
spacer, "no upstream", **Publish**, and a chevron. It needs 347 pixels in 300, so the two texts before
the spacer give way and the branch reads "m.". The copy button copies the project folder, not the
branch. The branch is the one fact the bar exists to show.

## Where to see it

**Review changed files** › Changes, the bar under the file list.

## Already done

- K2's P11 moved the divider: the list footer draws `--chrome-divider` on top, and its first toolbar
  drops its bottom rule.
- B02's 02-2 puts the project in the top bar on a task, so the bar no longer needs to name it.
- K4a put **Force push** below a separator in the remote menu.

## The fix

- `plugins/changes/src/client/RemoteBar.tsx:150-173`: drop "{project} /" and the folder copy button.
  The branch text goes first.
- The ahead and behind counts stay short ("↓2 ↑1"), with a tip in words ("2 behind, 1 ahead").
- K1a noted the footer's generate button is a bare button with an icon child, not `iconOnly`, and
  measures 11 by 11. Make it an `IconButton` while you are here.

## Copy

Branch bar rows, and the commit editor rows in the same footer that no other finding owns.

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `RemoteBar.tsx:152` | {project} / | Remove | |
| `RemoteBar.tsx:153` | detached HEAD | Rewrite | No branch (detached) |
| `RemoteBar.tsx:158` | Copy the project folder: {path} (`title`) | Remove | The button goes. |
| `RemoteBar.tsx:104` | Fetch, pull, push (`title`) | Rewrite, as `tip` | More sync actions |
| `RemoteBar.tsx:77` | Resolve the conflicts in the editor or a terminal, then commit. Or abort and start again. | Keep | |
| `model.ts:155-158` | no upstream / ↓{n} ↑{n} | Rewrite | "Not published". Keep "↓{n} ↑{n}" visible, with the tip "{n} behind, {n} ahead". |
| `ChangesPane.tsx:401` | Write the message in a bigger box (`title`) | Rewrite, as `tip` | Open a bigger editor |
| `commitEditor.tsx:108` | Amend, sign-off, and skipping git's hooks (`title`) | Rewrite, as `tip` | Commit options |
| `commitEditor.tsx:120` | Rewrite the last commit instead of adding one. Fills an empty message from it. | Keep | |
| `commitEditor.tsx:136` | git's pre-commit and commit-msg hooks; acorn's before-commit chain still runs. | Rewrite | Skips Git's pre-commit and commit-msg hooks. acorn's own checks still run. |
| `commitEditor.tsx:18` | Commit tracked | Keep | |
| `GenerateButton.tsx:68` | Which provider writes the message. Now: {label} (`title`) | Rewrite, as `tip` | Choose who writes the message. `tipSub`: {label} |

The `model.ts` row follows the plan's overrule: the short counts stay visible, and the words go in the
tip.

## Risk and checks

- Before you start, confirm B02's top bar names the project on a task.
- Screens: the branch bar with and without an upstream, and the remote menu.
- Tests: `plugins/changes`.
