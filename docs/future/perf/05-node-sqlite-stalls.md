# Phase 5: stop SQLite reads stalling the Node

## Completion note

Landed October 22, 2026, on branch `phase-5-node-sqlite-stalls`. The code, tests, and docs are done.
The week of Sentry the acceptance asks for isn't taken, and neither are phase 1's per-statement
timings on the owner's `agents.sqlite`, so the speedups are argued from query plans, not measured.

What landed:

- The command settle and `commandTurn` write `->>`, so they read through `agent_events_session_tool_idx`.
  A turn's end settles that turn through `agent_events_turn_seq_idx`. Plan tests cover both reads.
- A `#session` reference reads the newest 201 events through `AgentStore.recentSnapshot`, not the whole
  session.
- Migration `0022_agent_events_usage_index.sql` adds `agent_events_usage_time_idx` and
  `agent_events_usage_baseline_idx`. The usage source reads its window through the first, and each
  session's baseline through the second with one `LIMIT 1`.
- A record trigger check loads its ledger rows in one query, dedupes with a `Set`, and writes in
  transactions of 500 with `await setImmediate()` between them. A last transaction marks records that
  stopped matching and writes the checkpoint. GitHub raises `changed('pull-requests')` only when a
  refresh changed a row.
- A dataset read selects its rows once per run, through `createDataSelectionPager`. Migration
  `0014_dataset_size_counters.sql` adds `row_count` and `byte_count` to `datasets`, kept by triggers.
- The trigger view reads only the latest occurrence.
- The operations page names the indexes and why a read must repeat their expressions.

Decisions and deviations:

1. The `#session` reference keeps the old output exactly. It reads the newest 201 events of every
   type, as the renderer slices the last 200 of all types, not `LIMIT 200` over the shown types. That
   would have put earlier messages into a tool-heavy session's reference.
2. The usage baseline is the latest earlier report that carries a token count or a cost, not the plain
   latest one. ACP reports often carry only context, and the old code carried the last cost forward, so a
   plain `LIMIT 1` would have counted a session's whole earlier cost on the window's first record. It
   stays exact for a session that reports tokens or a cost, as Codex and ACP do. A harness that reported
   tokens in one row and a cost in another would count from the later one only.
3. The turn-end settle covers commands with that turn's ID. A command with no turn ID waits for the next
   session state or subagent settle, and for the boot settle.
4. Record trigger writes are no longer one transaction. A crash between chunks leaves a partial ledger,
   which the next check reads as already seen, and the checkpoint moves only in the last transaction.
5. GitHub's `emit` takes `{ unchanged: true }` as a third argument. `mirrorPr` says `changed` when the
   pull row, ignoring its fetch time, or its checks differ. GitHub's `updatedAt` moves with comments,
   reviews, labels, and commits. A file refresh never raises the source.
6. A dataset read past 5,000 rows now ends `incomplete` with `host-budget`. It used to fail its cursor
   at the next page.
7. Dataset counters use triggers, so every writer, tests and the retention pass included, is covered.
8. The optional read worker is skipped. Without phase 1's numbers on the owner's file, nothing shows that
   a read still passes 250 ms.

Not done:

- The `sql.select` window counts and the event loop p99 over a working week.
- Both new `agents` indexes build over the owner's 830,000 events when the Node first boots. Migration
  0021 did the same. Watch that boot's `migrate` mark.

For later phases:

- The Node service bundle is 1,933,484 B.
- Two failures were on the base before this phase and still fail: `routeRegistry.test.ts` lacks phase 3's
  `GET /v1/core/task-scripts` in its golden list, and four loaded `http` plugin tests in `apps/node` fail
  with "Unclassified host context method ... core.proc.lowerPriority" from phase 4.

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
