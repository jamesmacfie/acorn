# 09-1. Picking another pull request leaves the previous one's diff on screen

**Status:** not started. Batch B09. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

When you pick another pull request, the navigator follows the selection and the diff column does not.
#44 shows #42's diff; #45 shows #44's. In the task's PR pane, a related read-only pull shows the
primary pull's threads with live **Reply** boxes, so a reply lands on the wrong pull request. This is
not a looks problem: a reviewer reading #45 sees #44's code.

## Where to see it

GitHub in the left rail, with the area 09 seed (see
[the README](../README.md#seeds-for-populated-views)). Click #42, then #44, then #45, and read the diff's
file header each time. In a task with related pulls, select a related pull in the strip.

## The fix

`DiffForPull` reads `owner`, `repo`, and `number` into constants when it is created, and nothing
rebuilds it: `Sections` calls `main.render()` once inside a non-keyed `Show`.

- `plugins/github/src/client/PullDetail.tsx:103-108`: a memoised route (`owner`, `repo`,
  `number`) and `<Show when={diffRoute()} keyed>{(route) => <DiffForPull route={route} router />}</Show>`.
- `plugins/github/src/client/pullDetail/PrPane.tsx:185-197`: the same, keyed on the selected pull.
- The child must take one argument. The patched `Show` only remounts for a child with `length > 0`
  (`patches/solid-js@1.9.13.patch:19`).
- The dead `DiffView.tsx` (around `:24-26`) already has the pattern. Delete that file.
- Add a jsdom test: select one pull, then another, and read the diff's file header.

## Copy

No copy rows.

## Risk and checks

- Before you start, confirm `DiffView.tsx` is still unimported.
- This remounts `DiffPane` for each pull, which was the behaviour before `Sections`. No row geometry
  changes.
- Screens: the browse detail across five pulls, and the task PR pane with a related pull.
- Tests: `plugins/github` (new jsdom tests for `PullDetail` and `PrPane`), and the client-core diff
  tests.
