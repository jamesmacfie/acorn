# Phase 5: stop SQLite reads stalling the Node

Date: October 21, 2026. Status: proposed. Can run beside phases 7 and 8.

The Node reads its stores through `node:sqlite`'s synchronous `DatabaseSync`. A long statement stops
every request and socket frame until it ends, so the window freezes on whatever it asked for next.
This phase fixes the reads that stall, starting with the ones that run on every agent turn. Read
[the programme](./README.md) first.

## Starting point

From October 14 to 21, 187 five-second windows held an `agents` `sql.select` of 250 ms or more, up to
4.26 s, and 77 held a `core` one, up to 4.66 s. The owner's `agents.sqlite` held about 830,000 events
on October 19. The timings in this list are estimates from the query shapes. Phase 1's per-statement
numbers on the owner's file confirm them.

1. **Command settling on every turn end.** `runtimeEngine.ts` calls `settleCommands({ sessionId })`
   on `turn_completed`, errors, some state changes, and every subagent idle. It runs
   `unfinishedCommands` in `plugins/agents/src/server/sessions/commandLifecycle.ts`, which filters on
   `json_extract(event_json, '$.type')`. Migration `0021_agent_events_tool_index.sql` builds its
   partial index on `event_json ->> '$.type'`. SQLite uses an index on an expression only when the
   query repeats it exactly, so the index goes unused and the read scans the whole session.
   `commandTurn` has the same mismatch. `toolCallRead.ts` writes the same expression on purpose, and
   its test checks the plan. `processUpkeep.ts` runs the same scan for every idle process.
2. **A `#session` reference.** `plugins/agents/src/server/routes/managedBridge.ts` calls
   `store.exportSnapshot`, which reads and parses every event in the session.
   `sessionReference.ts` then keeps the last 200.
3. **The usage source.** `plugins/agents/src/server/data/usageSourceHandler.ts` filters on
   `json_extract` of the type, with no index, then re-reads each session's earlier events to compute
   deltas. Every page repeats it.
4. **Record trigger checks.** `plugins/workflows/src/server/triggers/records.ts` checks up to 5,000
   records in one transaction, with a ledger read and an upsert each, and deduplicates with
   `seen.includes` on an array. A check runs every 5 minutes per trigger, and every 15 s while the
   source changes. `plugins/github/src/server/events.ts` raises `changed('pull-requests')` on every
   pull request sync, even when nothing moved.
5. **Dataset pages.** `packages/node-core/src/server/datasets/source.ts` rewrites, filters, and sorts
   the whole dataset with `json_extract` for each 100-row page, through `LIMIT` and `OFFSET`. A panel
   can ask for 50 pages.
6. **The trigger list.** `plugins/workflows/src/server/triggers/readModel.ts` loads every past firing,
   each with the whole workflow graph, to show the last one.

## Changes

Make each read use an index or read less. Don't change what any of them returns.

1. Rewrite `unfinishedCommands` and `commandTurn` with `->>` so they match the 0021 index, and scope
   the turn-end settle to that turn. Add a plan test like `toolCallRead.test.ts`.
2. Read a `#session` reference with `ORDER BY seq DESC LIMIT 200` over the event types it shows.
3. Add a partial index for usage rows, and take each session's baseline from one indexed `LIMIT 1`
   read.
4. Make `seen` a `Set`, load the ledger for the check in one query into a `Map`, and write in chunks
   of 500 with `await setImmediate()` between them. Raise `changed` only when a synced row's content
   changed.
5. Page datasets by key, not by offset, through `createDataSelectionPager`, and keep row and byte
   counts on the `datasets` row instead of summing on each write.
6. Read only the latest firing per trigger.

Yield with `await setImmediate()` from `node:timers/promises` between chunks of any loop that can
pass 50 ms. An `await` on a finished query doesn't let socket callbacks run.

### A worker for heavy reads, if needed

If phase 1's numbers still show reads over 250 ms after these fixes, open a second, read-only
`DatabaseSync` on `agents.sqlite` in a worker thread, for data sources, search, export, and usage.
WAL mode allows it without touching writes. Moving the whole store to a worker makes every store call
async, which is a much larger change. Don't start it unless the read worker isn't enough.

## Tests

- For each changed query, a store test with enough rows shows the new read returns the same rows as
  the old one.
- Plan tests show `agent_events_session_tool_idx` in the settle and `commandTurn` plans.
- A record trigger test over 5,000 records shows the event loop answering a timer between chunks.
- New indexes pass `pnpm db:check`. Don't edit an applied migration file. Its hash is checked at boot.

## Acceptance

- `sql.select` windows of 250 ms or more for owner `agents` fall from 187 a week to under 20, and for
  `core` from 77 to under 10.
- Node `runtime.event_loop.max.max` p99 under 250 ms over a working week, against 510 ms.
- [Storage and memory](../../managed-agents/operations.md#storage-and-memory) names the indexes and
  why the expressions must match.
