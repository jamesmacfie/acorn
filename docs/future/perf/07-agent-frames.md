# Phase 7: apply agent frames once per frame

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
