# Phase 7: streaming surfaces render incrementally

Status: not started. Waits on phase 0 for a profile of a real long session.

## Goal

A streaming agent message costs the client work proportional to what changed, not to how long the
message is. Closed blocks and closed code fences render once. Bookkeeping events are folded once on
the node instead of per client. The transcript's per-event bookkeeping is constant time. This is
[decisions.md](./decisions.md) decision 5; [analysis.md](./analysis.md) §§ 6 to 10 are the first
read of the same surface.

## Why this phase, and why now

The node already does the hard half. `plugins/agents/src/server/sessions/durableEventBuffer.ts`
buffers text deltas per session and flushes at 40 ms or 16 KB, so a client sees about 25 events a
second per streaming session, not one per token. That number bounds everything below and is the
number to profile against.

Each of those 25 events pays three times. `plugins/agents/src/client/sessions/managedStore.ts`'s
`appendEvent` scans the event list twice, copies it, and sorts the copy, on an array that is already
sorted. `plugins/agents/src/client/sessions/AgentTranscript.tsx` rebuilds the whole conversation
projection in one memo whose only dependency is that new array, and finds each row's turn with
`turns.find` per row per render. Then `packages/client-core/src/kit/components/content/Markdown.tsx`
re-parses the entire message through the regex pipeline in `packages/client-core/src/kit/lib/markdown.ts`,
replaces the whole subtree with `innerHTML`, disposes and re-renders every copy button, and re-runs
the asynchronous highlighter over every code fence in the message. A message with three fences
re-highlights three blocks 25 times a second while its fourth paragraph streams.

The event mix makes it worse than it needs to be. On this machine's agents database, `usage` rows
are 25% of 66,264 events, about 58 per turn, and `conversationItems.ts` folds them to one card per
turn on every client, on every event (`docs/managed-agents.md`: "Usage folds the same way, one line
per turn"). The node could fold once.

The transcript has no virtualizer on purpose (refused.md § Rebuilding the transcript virtualizer),
so the DOM holds every card. That makes the per-event cost the only lever.

## Scope

In:

- `appendEvent`: a `Set` of seen ids per session, an in-order append when `event.seq` exceeds the
  last element's, and a splice into position only when it does not. No copy, no sort.
- Usage folded on the node. The snapshot route and the WebSocket projection into the transcript
  store emit one `usage` event per turn, the latest snapshot for that turn, which is the rule the
  client already applies. The durable ledger keeps every row; pricing and the usage settings page
  read the ledger, not the projection.
- `turns` as one memoized `Map<string, AgentTurn>` above the `<Index>`.
- The projected-event refetch (`PROJECTED_EVENT_TYPES` in `managedStore.ts`) sends the changed turn
  or request rather than re-reading up to 2,000 rows: the node's projection already knows which turn
  a `turn_completed` closes.
- `Markdown` streaming mode: the source is split into blocks at the parser's block boundaries; a
  block whose text has not changed since the last render keeps its element; only the trailing open
  block is re-parsed and replaced; a fence that has closed is highlighted once and the result cached
  by a hash of its text and language, so a re-render reuses it. Copy buttons live on the block, so
  they survive.

Out: an incremental conversation projection beyond the events store (refused.md keeps it parked
behind a number). The virtualizer. Diff hydration and switching costs (phase 8).

## Design

**The store is keyed by seq.** `appendEvent` reads `snapshot.events.at(-1)?.seq`; if the new `seq`
is greater, it pushes into a Solid store array, which is a keyed write rather than a copy. The `Set`
of ids replaces both `.some` scans. Out-of-order arrival, which the reconnect replay can cause, takes
the splice path; it is rare and stays correct.

**Folding on the node is a projection rule, not a schema change.** The snapshot route in
`plugins/agents/src/server/sessions/` collapses `usage` rows per `turnId` to the last one before it
serialises, and the WebSocket emitter does the same by replacing rather than appending the turn's
`usage` in what it sends. `exportSnapshot` and the pricing routes keep reading every row. The client's
fold in `conversationItems.ts` stays as a no-op safety.

**Blocks are the unit of render.** `renderMarkdown` gains a `renderBlocks(text)` that returns
`{ key, html }[]` where `key` is a hash of the block's source. `Markdown` keeps a `Map<key, Element>`;
on update it walks the new block list, reuses elements whose key it has, replaces the rest, and
removes the leftovers. A streaming message changes its last key each tick and nothing else. The
highlighter cache is a module-level `Map<hash, html>` bounded at a few hundred entries, filled when a
fence's block key stops changing.

## Code touched

- `plugins/agents/src/client/sessions/managedStore.ts`, `AgentTranscript.tsx`,
  `conversationItems.ts`.
- `plugins/agents/src/server/sessions/store.ts` and the snapshot route beside it; the WebSocket
  channel emitter for `agent:event`.
- `packages/client-core/src/kit/components/content/Markdown.tsx`, `packages/client-core/src/kit/lib/markdown.ts`,
  `packages/client-core/src/infra/highlight/worker.ts` (the cache sits in front of `codeToHtml`).
- `plugins/agents/src/client/sessions/ManagedAgentMarkdown.tsx` if it passes options the streaming
  mode needs.

## Tests

- `managedStore.test.ts`: 2,000 in-order events append in linear time (assert no sort call through
  a spy, or a time bound generous enough to be stable); an out-of-order event lands in position; a
  duplicate id is dropped.
- `store.test.ts` (node): a session with 58 `usage` rows in one turn projects one; the ledger still
  holds 58.
- `markdown.test.ts`: `renderBlocks` on text plus one appended character changes exactly one key;
  `Markdown.test.tsx` (jsdom): a streaming update keeps the first block's element identity and
  highlights a closed fence once across ten updates (spy on the highlighter).
- `AgentTranscript.test.tsx`: `turns.find` is gone; a row's turn resolves through the map.

## Docs owed

`docs/managed-agents.md`: the usage fold happens on the node and the client's fold is defensive; the
transcript store's shape; the `Markdown` streaming contract. `docs/ui-design.md` § Markdown, if the
component's contract is described there.

## Done when

- A profiled 2,700-event session (the size on this machine's database) streams at 25 events a second
  with main-thread time per event under 2 ms, measured with the phase 0 marks.
- No fence re-highlights while its text is unchanged (the spy in the test, and the highlighter
  worker's message count in a live session).
- The snapshot for a long session is smaller by its folded `usage` rows.

## Verify before building

- Confirm `appendEvent` still copies and sorts, and `PROJECTED_EVENT_TYPES` has not grown a per-token
  type. Read at `17a9acdf`.
- Confirm `durableEventBuffer.ts` still flushes at 40 ms or 16 KB. The 25 events a second figure
  depends on it.
- Confirm `conversationItems.ts` still folds `usage` per turn and `AgentEventCard.tsx` still draws
  the card; the node-side fold must produce what the client draws today.
- Profile before sizing the `Markdown` work; the per-delta re-highlight is read from source and the
  2 ms budget is a proposal.
