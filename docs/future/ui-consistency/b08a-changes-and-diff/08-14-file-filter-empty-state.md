# 08-14. "No files match." sits in the diff's corner

**Status:** not started. Batch B08a. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

Typing a name in the diff's **Filter files…** box with no match draws "No files match." in the diff's
top-left corner, beside the canvas, while the file list beside it still shows every row. The person
types a name, sees nothing change, and thinks the filter is broken.

## Where to see it

**Review changed files** › Changes. Type a name that matches nothing into **Filter files…**.

## The fix

The partial fix. Making the filter narrow the Changes file list too is a new feature and is deferred
(see [deferred.md](../deferred.md)).

- `packages/client-core/src/features/diff/DiffPane.tsx:613-615`: "No files match." becomes a centred
  `EmptyState` titled `No files match "{query}"`, with **Clear filter** as its action. It renders
  instead of the canvas, not beside it.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `DiffPane.tsx:614` | No files match. | Rewrite | Title `No files match "{query}"`, action **Clear filter**. |
| `DiffToolbar.tsx:33, 47` | Filter files… / Find in diff… | Keep | |

## What earlier batches give you

- **The empty-state rule** (K2's 00-9), in `docs/ui-design.md` § States: an empty detail column uses
  the centred `EmptyState` with a title.

## Risk and checks

- Before you start, confirm the canvas can unmount and remount cleanly when the filter clears. GitHub
  uses the same `DiffPane`.
- Screens: the filter with no match, and after **Clear filter**. Also the GitHub diff with a filter.
- Tests: the client-core diff tests.
