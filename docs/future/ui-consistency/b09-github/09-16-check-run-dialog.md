# 09-16. The check run dialog uppercases its steps and has no link to GitHub

**Status:** not started. Batch B09. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The check run dialog's step folds use the group level, so step names are uppercased. It has no footer
and no link to the run on GitHub, which is where a person goes next.

## Where to see it

GitHub with the area 09 seed › #42 › **Checks** › press a check.

## Already done

- K4a changed every modal title to sentence case at 15px with a close button, so the job's own case
  shows ("Test (ubuntu-latest, node 24)") and there is a visible way out. The title part of this finding
  is done.

## The fix

In `plugins/github/src/client/checks/ChecksPanel.tsx:63-96`:

- Step folds use `level="sub"`.
- A `Modal.Actions` footer with **Open on GitHub** and **Close**.
- Pass the check's `url` (`plugins/github/src/shared/api.ts`, around `:112`) through `openCheck`
  (`prSections.tsx:131`, `prModel.ts:179`).

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| (new) footer | (none) | Rewrite | **Open on GitHub**, **Close** |
| `ChecksPanel.tsx:83` | Loading log… | Keep | |

## What earlier batches give you

- **The dialog shape** (K4b), in `docs/ui-design.md` § Chrome and overlays: the footer is any extra
  secondary, a spacer, **Close** ghost (when there is nothing to cancel), then one solid primary. Here
  **Open on GitHub** is the primary.

## Risk and checks

- Before you start, confirm the check row carries a `url`.
- Screens: the check run dialog with steps (from code if the seed has none) and a failed load.
- Tests: `plugins/github`.
