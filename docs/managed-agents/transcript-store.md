# The transcript store

The transcript store holds the sessions a client reads. Nothing is virtualized, so the DOM holds every
drawn card, and the cost of a streamed event is the lever that matters. This page covers how the store
takes a frame, how it loads a session, what it keeps, and how the ledger stores a tool call.
`plugins/agents/src/client/sessions/managedStore.ts` holds one snapshot per kept session: the row, its
turns, its events, and its requests.

## The transcript store

A client sees about 25 events a second per streaming session, because the Node coalesces text deltas
at 40 ms or 16 KB (`durableEventBuffer.ts`). Five rules keep each frame cheap:

- **Events append in place, in sequence order.** A replayed event out of order walks back from the
  tail. A set of seen IDs answers "have I got this one". The store's signal, not the array's identity,
  re-renders the transcript.
- **A usage update folds onto the open line** instead of appending.
- **A projected event asks for a row, not a session.** `agent:turn` carries the turn a `user_message`
  opened or a `turn_completed` closed, and `agent:request` the request raised or answered. `error`
  still refetches, because it also expires pending requests and no frame names them.
- **Turns are a map above the list,** not a `turns.find` per row per render.
- **An event costs the projection one row and wakes only its card.** `createConversationProjection` in
  `conversationItems.ts` keeps its fold open and adds new rows. It checks by identity that earlier rows
  are still in place, and rebuilds from the start when a row lands behind the tail or a read replaced
  a record. An untouched item keeps its object, and each row reads its item from its own signal.

A frame costs about a millisecond, so frames aren't batched. In the plugin's jsdom tier, with the
canonical session drawing 200 of 3,387 cards, a message delta took 0.8 ms at the median and 1.3 ms at
the 95th percentile. An event behind the tail costs about 20 ms, and the Node commits in order, so a
live frame doesn't arrive that way. Over three days of Sentry data, 95% of five-second windows had no
agent frame over 36 ms. One session's frames arrive about 40 ms apart, so a batch would nearly always
hold one frame.

A snapshot read and the socket can disagree about a usage line, because both fold it.
`managedSnapshot.ts` unions the two, socket first.

## Load a session

`GET /sessions/:id` returns at most 2,000 events, oldest first, which a session reaches in about half
an hour of streaming. `loadSnapshot` compares the row's `lastEventSeq` with the highest event it holds
and pages `GET /sessions/:id/events?afterSeq=` until they agree. Without that walk, a long transcript
reopened hours behind its last message.

A held session is read on from its mark, `completeThrough`: every event at or below it is held or
folded into a held row. A load sets it where its walk ended. A streamed event moves it only when it's
the next sequence, so a lost frame leaves the mark at the gap. The next load asks for events after the
mark. Turns, requests, and the row still come back whole, because some of their changes reach the
socket as no frame. A shown conversation also reads on when the socket reconnects (`wsOnReconnect`).
The retention pass is the one exception to "nothing below the mark changes"
([archived agent history](./history-retention.md)).

## What the store keeps

The store keeps the snapshots on screen and the three drawn last, and drops the rest. A surface that
draws a session holds it through `managedAgentStore.hold(sessionId)`: the conversation holds its
session, and the sidebar holds each session waiting on you. Past the three most recent, an unheld
snapshot drops its events, seen IDs, usage line, and mark. The row stays in the roster, with its draft,
reading place, and live sequence. Opening it again reads from the start. Eight real sessions opened in
turn used to hold 46 MB of JSON.

## How the ledger stores a tool call

A tool call is stored as two rows: the one that opened it, and one with its latest state. A measured
database held 196,000 tool rows for 39,000 calls, 300 MB of JSON. When an update arrives, `recordEvent`
folds the stored rows and the update with `mergeToolCall`, writes the result at the next sequence, and
deletes the row it replaces, in the event's own transaction
(`plugins/agents/src/server/sessions/ledgerFold.ts`). A file change with a change ID is stored the
same way.

Each reader stays correct:

- **Resuming after the mark.** The new row is past every mark and carries every field the card holds.
- **Reading from the start, or `fold=1` pages.** The opener and the latest row fold to the same card.
  The opener stays because a card sits where its first row landed and files under that row's subagent.
- **The socket.** Each update still goes out as reported, at the sequence its row took.
- **The walk.** Sequences have gaps, and the deleted row is never the newest.
- **Export, waits, workflows, and delegation.** They read rows as stored. The markdown export folds
  tool rows to one line per call.

Rows stored before the fold were compacted once in the background (`ledgerCompaction.ts`), marked per
session in `ledger_compacted_at`. On a 1.3 GB database it removed 118,500 rows in 34 seconds, with a
median step of about 3 ms and the longest about 190 ms. It then merges the search index. The file
doesn't shrink.
