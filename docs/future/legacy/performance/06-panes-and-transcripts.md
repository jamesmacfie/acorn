# Panes and the agent transcript

Date: 2026-09-24. Status: proposal. Read from source, not timed. [Back to the plan](./README.md).

Pane switching inside a task is mostly cheap already. Showing a pane mounts it, hiding it unmounts
it, and the pane model keeps its shared state for the task (September phase 8 took the editor's
reopen to zero requests). The agent transcript is the exception. It is the heaviest thing the app
draws, it has no virtualizer on purpose, and it is drawn again on every task switch.

## What mounting a transcript does

`plugins/agents/src/client/sessions/AgentTranscript.tsx` projects the snapshot's events into items
with `buildConversationItems`, then renders every item as an `AgentEventCard` inside a kit
`Timeline`. The largest real session on record projects to 522 items
([phase 10](../../../performance/2026-09-03--phase-10-the-re-measurement.md)). Each assistant message
renders through `Markdown.tsx`, which parses its source with the regex pipeline in
`client-core/src/kit/lib/markdown.ts` and highlights its fences through the highlighter worker.

The projection itself is cheap, about 0.6 ms for the largest session. What nobody has timed is the
rest: creating 522 cards, parsing every message, and laying out the whole list, all before the
transcript scrolls to the reader's place. The telemetry for it exists: `agents.transcript.cards`
measures the first batch of cards with `measureRenderBatch`. Read it during
[M4](./01-measurement.md#m4-time-a-task-switch-in-the-real-window).

## P1: Skip layout and paint for cards off screen

**Change.** Give each `Timeline.Turn` `content-visibility: auto` and a `contain-intrinsic-size` that
remembers the card's last measured height (`contain-intrinsic-size: auto 120px`). The browser then
skips style, layout, and paint for cards outside the viewport, and keeps their size stable for the
scrollbar. This is a CSS property, not a virtualizer: every card stays in the DOM, text search and
selection keep working, and nothing calls `measure()`, which is what made the deleted virtualizer
flash ([managed-agents.md](../../../managed-agents.md)).

**Where.** The Timeline's stylesheet in `packages/client-core`, so every timeline gets it.

**Risks.** The reading place. `readingPlaceStore.ts` and the Timeline restore the reader to an
anchored turn. With skipped cards, heights above the anchor are estimates until they render, so a
jump to an old turn can land a little off and then settle. Test the three cases the scroll-fix work
cared about: follow at the bottom, return to a saved place, and reveal a specific request
([scoll_fix.md](../../scoll_fix.md)). `content-visibility` needs Safari 18 or later. On an older
WebKit the property is ignored and nothing changes.

**Done when.** The first frame of a long transcript is measurably faster in M4 and the three scroll
cases behave as before.

## P2: Share parsed markdown blocks across mounts

**What was found.** `Markdown.tsx` caches rendered blocks by their source, but the cache is a local
`blocks` array in each component. A remount starts empty, so every message is parsed again on every
task switch. Fenced code is cheaper, because the highlighter's HTML cache in
`client-core/src/infra/highlight/shiki.ts` is module-level.

**Change.** Keep a module-level cache from a block's source to its sanitised HTML string, bounded by
count or total characters, and have `renderBlocks` read from it. Cache the HTML string, not the
element: an element can be in only one place in the DOM, and two panes can show one session. A closed
block is immutable, so a hit is always correct.

**Done when.** A remount of a transcript already drawn once shows `markdown.parse` hits rather than
misses in the work telemetry.

## P3: Stop every card updating when one event arrives

**What was found, not timed.** `buildConversationItems` builds new item objects for every item on
every snapshot change. `itemsByKey` is then a new map, and each card reads its item through
`() => itemsByKey().get(key)`. So while an agent streams, about 25 times a second, every card's
accessor returns a new object, and every reactive expression inside every card that reads it runs
again. The keyed `For` keeps the DOM nodes, which is what the comment there is about, but the work
inside each card scales with the number of cards.

The September record refused an incremental projection because the projection is 0.6 ms. This is a
different cost: the fan-out after the projection, which scales with cards and was not measured.

**Change.** After `buildConversationItems` runs, reuse the previous item object for any key whose
content did not change. Compare what an item is built from: the event record identity, which the
store keeps stable for unchanged events, and the few derived fields a card reads. A card whose item is
the same object does no work.

**Measure first.** Count `AgentEventCard` re-evaluations per streamed event on a 500-item transcript,
with a throwaway counter or the work telemetry. If it is under a millisecond per event, skip this.

## P4: Leave the editor's cross-task re-read alone

The editor reads a file again when you return to a task, on purpose, because the agent shares the
worktree and a cached copy could be stale ([editor.md](../../../editor.md)). T1 in
[05](./05-task-switching.md) keeps the editor's per-file documents across a switch back, which keeps
undo history and cursor. The file text still reloads. That is correct.

## P5: Coalesce the changes pane's line counts on the node

**What was found.** `localStatus` in `plugins/changes/src/server/localDiff.ts` shares its `git status`
with the rail through `worktreeStatusText`, which coalesces per worktree over two seconds. The two
`git diff --numstat` calls after it are not coalesced. September phase 10 measured them: two clients
on one task produced 60 `git diff` spawns in 15 rounds, more than the rail's whole `git status` bill
for four worktrees.

**Change.** Put the numstat pair behind the same per-worktree window and in-flight sharing as the
status read. Invalidate on the node's own writes, the way `invalidateWorktreeStatus` already does.

Do not skip the numstat when the status text is unchanged. A second edit to a file that is already
modified changes its line counts and leaves its porcelain line the same.

**Done when.** Two clients with the changes pane open on one task cost one numstat pair per window,
counted with `ACORN_PERF=1`.

## Verify before building

- For P1, confirm the Timeline's scroller is the element that should carry `content-visibility` on
  its children, and that no card relies on its own `getBoundingClientRect` while off screen.
- For P2, confirm that `renderBlocks` output is fully determined by the block source and the
  `images` option. If other options change the HTML, they belong in the cache key.
- For P3, confirm the store keeps event record objects stable across appends. `appendEvent` mutates
  the array in place, and `foldUsage` replaces the usage line's record, so a usage card changes by
  design.
- For P5, confirm the numstat pair is still two separate `gitText` calls in `localStatus`, and that
  no other caller reads line counts on its own path.
