# 08-9. What a diff line draws under itself starts at the wrong inset

**Status:** not started. Batch B08a. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

In the unified diff, code text starts 122 from the diff's left edge, but a review note under a line
starts at 102. The note's indent leaves out the 20-pixel add-button column, so the "unsent" badge sits
20 pixels left of the code it annotates. In split view the code starts at 78 and the note keeps the
unified indent of 102, so it sits 24 pixels right of the code. A note should read as belonging to its
line.

## Where to see it

**Review changed files** › Changes. Add a line note in the diff, then switch between **Unified** and
**Split**.

## The fix

CSS only. No row geometry changes.

In `packages/client-core/src/infra/styles/diff.css`:

- Around `:57-61`, unified:
  `.diff-line-extra { padding-left: calc(2 * var(--diff-gutter-w) + var(--diff-marker-w) + var(--diff-btn-w)) }`.
- Split: `.diff-split-band > .diff-line-extra { padding-left: calc(var(--diff-gutter-w) + var(--diff-marker-w) + var(--diff-btn-w)) }`.
- Around `:69`: `.diff-inline-chat`'s margin also subtracts `var(--diff-btn-w)`, in both views.
  Otherwise inline agent chats move 20 pixels right.

The note block is a measured dynamic block, so it re-wraps and is re-measured. Code rows do not move.

## Copy

No copy rows.

## Risk and checks

- Before you start, read the comment at `diff.css` near the card inset (around `:17-19`): thread cards
  at 44 are deliberate and stay.
- The note calcs and the inline chat margin must change together.
- Diff CSS sits beside measured code. Scroll a long diff before and after, and compare row positions.
- Do not change `DIFF_LINE_HEIGHT`, `kit/diff/measureScheduler.ts`, or the height estimates in
  `kit/diff/diffModel.ts`.
- Screens: a note in unified and split, and an inline agent chat if one exists.
- Tests: the client-core diff tests.
