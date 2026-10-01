# 08-15. Empty, loading, and error states in the Changes pane take several shapes

**Status:** not started. Batch B08a. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

With a clean tree, the list says "Working tree clean." in the middle of its column while the diff says
"No files." in its corner: one fact, two shapes, side by side. A non-Git folder gets a list message and
a second line in the diff. A segment that fails to load shows inline text and a bare 12-high **Retry**.
Notes, Context, and editor search each word their idle or loading state differently.

## Where to see it

Changes on a clean worktree and on a folder that is not Git (read from code; the fixture has neither).
A failed segment is also read from code.

## The fix

The baseline wins over the area file here, per area 08's own spot check. Findings' detail is the
model: centred, a title, a body only when it helps.

- `plugins/changes/src/client/ChangesPane.tsx:367`: the list says "No changes" as a start-aligned sm
  line, or nothing. The detail shows the centred "No changes" / "Everything is committed.".
- `ChangesPane.tsx:427-436` (and `:430`): the non-Git and empty cases keep a centred detail, never
  blank.
- `packages/client-core/src/features/diff/DiffPane.tsx:610`: centred, with a title (GitHub uses this
  fallback).
- `packages/client-core/src/features/diff/DiffCanvas.tsx:214-219`: the segment **Retry** becomes a
  ghost xs "Try again". xs, because the segment placeholder holds a fixed height.
- `plugins/notes/src/client/NotesPane.tsx:142`, `plugins/editor/src/client/search/SearchPanel.tsx:86`,
  and `plugins/context/src/client/ContextPane.tsx:155`: copy only.

The editor's empty state drawn over its `Rectangle` is deferred (see [deferred.md](../deferred.md)).

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `ChangesPane.tsx:327` | Not a Git project / Changes are unavailable here. | Rewrite | Title "Not a Git project". Body "This folder isn't a Git repository, so there are no changes to show." |
| `ChangesPane.tsx:367` | Working tree clean. | Rewrite | Title "No changes". Body "Everything is committed." |
| `ChangesPane.tsx:430` | Nothing to diff. | Rewrite | A centred detail, never blank. The area file said remove; the plan overrules it with the baseline. |
| `DiffRows.tsx:66` | No diff (binary or too large). | Rewrite | Can't show this file. It's binary or too large. |
| `DiffRows.tsx:73`, `DiffCanvas.tsx:216` | Loading diff… / Could not load diff. | Rewrite | Loading… / Couldn't load this part. |
| `DiffRows.tsx:76`, `DiffCanvas.tsx:218` | Retry | Rewrite | Try again |
| `DiffPane.tsx:610` | Loading… / No files. | Rewrite | Title "No changes". Busy: "Loading…". |
| `NotesPane.tsx:142` | Select or create a note. | Rewrite | Title "No note open". Body "Pick one from the list, or press + to start one." |
| `SearchPanel.tsx:86` | Type to search the worktree. | Rewrite | Type to search this task's files. |
| `ContextPane.tsx:155` | Assembling… | Rewrite | Loading context… |

The Notes, search, and Context rows are in area 08's B08b sections. They are applied here because this
finding owns the states; B08b skips them.

## Risk and checks

- Before you start, confirm how `ChangesDiff` decides it has nothing to draw.
- `DiffCanvas` is perf-sensitive. Change only the button's variant, size, and words. Do not change the
  placeholder's height.
- Screens: Changes clean and non-Git (from code if needed), the segment failure (from code), Notes with
  nothing selected, editor search idle, Context loading.
- Tests: `plugins/changes`, `plugins/notes`, `plugins/context`, `plugins/editor`, and the client-core
  diff tests.
