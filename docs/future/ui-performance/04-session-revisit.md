# Phase 04: session revisit

Status: planned, October 13, 2026.

Read the [programme page](./README.md) first. This phase needs phase 01's `switchSession` step for
its before and after.

## Deliverable

Returning to one of the last three sessions you viewed reuses its projection and its parsed Markdown
instead of rebuilding them. The newest page of cards still mounts again.

## The problem

`AgentConversation` in `plugins/agents/src/client/sessions/AgentConversation.tsx` keys its whole
subtree by session ID, so switching away disposes it. Coming back does three things again:

1. `AgentTranscript` creates a fresh `createConversationProjection` and folds every event the session
   holds. The canonical session has 7,012 events.
2. It mounts the newest 200 cards. In jsdom on September 26, 2026, that built about 1,800 elements in
   about 60 ms ([the transcript](../../managed-agents/transcript.md#the-window)).
3. Each message card runs `renderBlocks` over its text, and each fence asks for color. The color
   cache holds 200 fences of up to 16 KB each, so a larger or older fence is colored again.

The real-window cost of a switch hasn't been measured.

Zeron keeps each recent session's prepared rows. Its notes record 806 ms to prepare a 21 MB
transcript in the background, then 9 ms to go away and come back, on Linux.

## Change

Do these two in order, and measure after each:

1. **Keep the projection with the snapshot.** The transcript store keeps the snapshots on screen and
   the three viewed last ([what the store keeps](../../managed-agents/transcript-store.md#what-the-store-keeps)).
   Keep each kept snapshot's projection there too, so a return continues the fold instead of starting
   it again. Drop the projection whenever the store drops the snapshot's events. The projection's
   rebuild rule doesn't change: it rebuilds when a read replaces a record or a row lands behind the
   tail.
2. **Cache parsed Markdown by text.** Add a bounded cache from a message's text and image option to
   its `MarkdownBlock[]`, for finished messages only. A streaming message keeps its own renderer. Bound
   the cache by total characters, not by entries, because one message can be very large.

A third option was considered and isn't part of this phase: keeping the last one or two
conversations mounted and hidden. A return would cost almost nothing, but a hidden transcript keeps
its effects running while its session streams, and it holds every element in memory. Reopen it only
if the two changes above leave a return well above the target, with numbers.

## Target

A return to the canonical session draws its newest page within 100 ms in the real window. Treat this
as a starting target. Replace it with the baseline from phase 01 if that shows a better one.

## Implementation steps

1. Add a `switchSession` flow that returns to the canonical session and to a small one, and record the
   baseline.
2. Move the projection into the store's kept snapshot.
3. Measure. Stop here if the target is met.
4. Add the parsed-Markdown cache.
5. Measure again, then update [the transcript store](../../managed-agents/transcript-store.md) and
   [the transcript](../../managed-agents/transcript.md).

## Acceptance

- The `switchSession` flow shows the return time before and after each step.
- A return still starts on the newest page, still restores a remembered reading place, and still
  shows the correct **Show earlier** count.
- Memory after viewing eight sessions in turn stays within 10% of the baseline. The store's retention
  rule exists because eight sessions once held 46 MB of JSON.
- The existing `AgentConversation.test.tsx` and transcript store tests pass.
