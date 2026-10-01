# 10-10. The sub-issue bar is full as soon as one sub-issue is done

**Status:** not started. Batch B10a. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

Linear passes the sub-issue meter a percent, but `Meter` wants a ratio from 0 to 1 and clamps. Any
progress above zero draws a full bar. "1 of 2 done" is only the bar's `aria-label`, so a sighted reader
gets no number.

## Where to see it

Linear issue ACO-42 with the area 10 seed, **Sub-issues**.

## The fix

- `plugins/linear/src/tree/LinearIssueView.tsx:274`: `value={doneCount() / children().length}`, a
  ratio. `Meter` clamps.
- Draw a muted "{done} of {total} done" beside the bar.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `LinearIssueView.tsx:275` | {done} of {n} done (aria only) | Keep | Also drawn as muted text beside the bar. |
| `LinearIssueView.tsx:270` | Sub-issues / Parent | Keep | |

## What earlier batches give you

- **Numbers in tree text** (K4a's 11-3): the host draws a finite number as its digits, so
  `{done} of {total} done` renders in a remote tree.

## Risk and checks

- Before you start, check no other `Meter` caller passes a percent.
- Screens: ACO-42's sub-issues with one of two done.
- Tests: `plugins/linear`.
