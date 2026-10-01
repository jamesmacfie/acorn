# 07-19. Three status marks in the editor header

**Status:** done 2026-10-02 on `more-ui`. Batch B07a. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

The editor header shows a layer glyph (with the browser's tooltip "Kept in this workspace"), a save
badge, and a publish badge. The save badge flips through "Draft saved", "Saving", "Saved on this
device", "Could not save", and "Not saved". "Saved on this device" shows during every 750 ms autosave
gap, which reads as a different, worse state. "Published r1" is shorthand.

## Where to see it

Workflows › any definition. Type in a field and watch the header. Publish a throwaway workflow to see
the publish badge change.

## The fix

In `plugins/workflows/src/client/editor/WorkflowEditor.tsx:315-337` and `draftStore.ts:85-274`:

- One save badge: **Saving…**, **Saved**, or **Not saved**. **Not saved** is danger-toned and has a
  `tip` saying the changes are kept on this computer.
- One publish badge: **Published** or **Not published**, with the revision in its `tip`.
- The layer glyph's meaning moves to the styled tip (B07b does the same in the rail,
  [07-12](../b07b-workflow-runs/07-12-rail-list.md)).
- **Save** stays. Plan decision 14 keeps it, and its code comment says why.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `draftStore.ts:85, 264` | Draft saved | Rewrite | Saved |
| `draftStore.ts:240` | Saving | Rewrite | Saving… |
| `draftStore.ts:138, 244, 274` | Saved on this device / Could not save / Not saved | Rewrite | "Saving…" while the node write is pending; "Not saved" otherwise, with tip "acorn couldn't reach the node. Your changes are kept on this computer." |
| `draftStore.ts:138, 255` | Resolve save conflict | Keep | |
| `WorkflowEditor.tsx:321` | Published r{n} / Not published | Rewrite | **Published**, tip "Version {n}. Runs and schedules use this version." / **Not published** |
| `draftStore.ts:35` | Kept in this workspace / A file the repository commits / A file of yours on this machine | Rewrite, move to the styled tip | Saved in this workspace / Saved in the repository / Saved on this computer |

## What earlier batches give you

- **`Badge tip`** (K3's P14). An optional string. A tipped badge is a keyboard tab stop with
  `role="note"`. Its accessible name stays its word, and the tip describes it.
- `Icon`'s `title` already routes to the styled tip (K3), so the layer glyph may only need the new
  words.

## Risk and checks

- Before you start, list every save state `draftStore.ts` can reach, so none falls through to a blank
  badge.
- Screens: the header while typing, after a save, with the node unreachable (read from code), and
  after publishing.
- Tests: `plugins/workflows` (`draft`, `WorkflowEditor.test.tsx`).
