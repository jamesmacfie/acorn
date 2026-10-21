# Phase 7: apply agent frames once per frame

## Completion note

Landed October 22, 2026, on branch `phase-7-agent-frames`. The frame queue and the per-session
signals are done, with tests and docs. The attach and detach protocol change isn't built, and the
acceptance numbers aren't taken. Both are the owner's to decide and read.

What landed:

- `wsClient.ts` holds `agent:` frames and applies them in one Solid `batch` on the next animation
  frame. A 50 ms timer also drains, because a hidden window gets no animation frames and the replay
  harness runs hidden. A drain that runs past 8 ms stops and goes on from a `MessageChannel` message.
  A frame from a Node that stopped being active is dropped at the drain.
- `ws.inbound.agent` now times a whole drain, readers included, and its slow span carries `frames` as
  well as `bytes`. Every other `ws.inbound.<prefix>` is unchanged, with `frames` always 1.
- `managedStore.ts` keeps one signal per session. `snapshotFor(sessionId)` is the per-session read,
  and `snapshots()` stays as a derived view. The task sidebar's request list, `ManagedChildRows`, the
  pane model, `AgentConversation`, and the inline diff card moved to `snapshotFor`. Writes go
  through one `updateSnapshot`, which wakes nobody when the update returns what it was given.
- `proposalStates` in `AgentTranscript.tsx` reads the plan proposal cards of the projection, held in a
  memo that compares by ID, and no longer walks every event. `codexPlanHandoffState` takes the
  fields it reads (`PlanProposalRecord`), so a projected card can stand in for a record.
- Tests in `wsClient.test.ts` (order, other channels on arrival, node switch, the yield, `frames`),
  `managedStore.test.tsx` (an event for A doesn't re-run B's reader, ten frames in a batch make one
  update), and `AgentTranscript.test.tsx` (a proposal's state).
- The transcript store page documents the signals and the queue, and the renderer and diagnosis pages
  describe the changed seam.

Decisions and deviations:

1. Only the `agent` prefix is queued, not every JSON frame. A terminal's JSON frames (a snapshot, an
   exit) have to stay in order with its bytes, and the bytes don't wait. Queuing all JSON would
   have reordered them. The doc's other owners needed no timing check, because they never see a queued
   frame. The cost is that an agent frame can now apply after a later `agent-session:changed` frame.
   The store treats them as separate signals and doesn't depend on their order.
2. The 8 ms budget counts the store writes, not the readers they wake. A batch runs its readers once,
   after the loop, so a slow reader isn't cut off by the budget. The batch is what limits that work.
3. The timer fallback means a visible window can drain up to a frame early or late. Both paths cancel
   each other, so a drain never runs twice for one wait.
4. `proposalStates` still filters the projection's items once per event. That's a pass over cards, not
   events. The state memo behind it holds its value when the proposals haven't changed.
5. `snapshots()` has no production reader left. It stays because the doc asks for it and the tests
   read it. Delete it if nothing needs it.
6. The attach and detach change is left out. It needs `ws.inbound.agent` measured after the first
   two changes, which can't be done here. If the owner's week still shows it above target, the
   Node's `sessionFrames.ts` and the reattach hook in `wsChannels.ts` are where it goes. The agents
   channel has no reattach hook today.
7. The acceptance needs the owner. The 1,742 and 120 counts need a working week of Sentry. The
   `agents` fixture's frame gap, with and without `--load`, needs the replay harness on a visible
   window.

What later phases need to know:

- Phase 8's other main-thread work doesn't need to know about the queue. A reader of one session
  should use `snapshotFor`, not `snapshots()`.
- Phase 10 compares `ws.inbound.agent` sums, not counts. A count is drains now, and a frame count is
  `agents.frame.apply`.
- The agents store test that needs reactivity lives in `managedStore.test.tsx`, because the logic
  project loads Solid's server build.

Date: October 21, 2026. Status: proposed. Needs phase 1's frame attributes.

Each agent socket frame wakes every reader of every session's transcript. With several agents
streaming, that runs dozens of times a second on the main thread, mostly with no interaction open.
This phase batches frames to the display's pace and lets a session wake only its own readers. Read
[the programme](./README.md) first.

## Starting point

- From October 14 to 21, `ws.inbound.agent` ran 100 ms or more 1,742 times, with a p50 of 150 ms and a
  p95 of 808 ms. Of 128 `ui.stall` logs, 120 came with no interaction open.
- `wsClient.ts` dispatches each JSON frame as it arrives. The agents store's `onFrame` in
  `plugins/agents/src/client/sessions/managedStore.ts` runs one `batch` per frame. The Node flushes
  text every 40 ms per session.
- The store keeps all transcripts in one `snapshots` signal. `appendEvent` returns a new map for
  every event, so every reader of `snapshots()` wakes, whichever session changed. Readers include the
  task sidebar's request list, `ManagedChildRows`, each inline diff card, the pane model of each of
  the five kept tasks, and `proposalStates` in `AgentTranscript.tsx`, which walks every event.
- Roster rows already work the right way. `taskSlices` gives each task its own signal.
- `sessionFrames.ts` on the Node publishes every session's events to every viewer. The helper parses
  and re-encodes each, and the renderer drops those for sessions it doesn't hold.

## Changes

### Queue frames to the next animation frame

In `wsClient.ts`, put JSON frames in a queue and drain it in one `batch` on the next
`requestAnimationFrame`. If a drain runs past 8 ms, stop and continue on a `MessageChannel` message,
so input handlers get a turn. Leave terminal bytes on their own path. Keep the frame order within a
channel.

Owners must accept frames that arrive together. The agents store already deduplicates by event id
and sequence. Check the others' `onFrame` handlers for timing assumptions before you switch them.

### One signal per session

Split `snapshots` into one signal per session, the way `taskSlices` works. Keep `snapshots()` as a
derived view for readers that list every session. Move each per-session reader to
`snapshotFor(sessionId)`. Build `proposalStates` from the projection's plan items, not from every
event.

### Send events only to viewers that hold the session

Add an `agent:attach` and `agent:detach` request for the sessions a renderer holds, and send event
frames only to those viewers. Keep sending session rows to every viewer. Use the reattach hook in
`wsChannels.ts` so a reconnect sends the attach list again. This is a protocol change, so do it last
and only if the first two changes leave `ws.inbound.agent` above target.

## Tests

- Ten agent frames in one tick cause one store update and one transcript projection.
- An event for session A doesn't re-run a memo that reads session B.
- A drain over 8 ms yields before it finishes, and the frames keep their order.

## Acceptance

- `ws.inbound.agent` spans of 100 ms or more down by at least four-fifths, against 1,742 a week.
- `ui.stall` with no interaction open down by half, against 120 a week.
- Phase 1's `agents` fixture: frame gap p95 down with and without `--load`.
- [The transcript store](../../managed-agents/transcript-store.md) documents the per-session signals
  and the frame queue.
