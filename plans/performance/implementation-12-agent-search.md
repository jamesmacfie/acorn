# Streamed agent search implementation

Implemented October 2, 2026, against the cumulative performance checkout at `4b8a611a`.
This record replaces `docs/future/performance/12-agent-search.md`.

## Ownership and design

The Agents plugin owns the canonical SQLite event ledger, derived message text, and FTS5 index.
CoreServices supplies workspace task membership. Search results cross the Node API and broker to
client consumers; derived search text stays on the Node. No protocol, shell, capability, or client
cache contract changes.

Continuations commit their complete JSON and sequence without SQL concatenation of the message head.
Migration 0012 adds a durable marker keyed by session ID, with the earliest changed sequence.
Insert, canonical update, and deletion triggers maintain that marker in the canonical transaction.
Existing FTS triggers retain direct standalone insert, explicit search-text update, and delete
projection. No applied migration changes.

`AgentSearchProjection` locates the preceding materialized head and reads the canonical suffix in
pages of 128 rows. It groups consecutive sequences by append flag, event type, turn ID, and message
identity. The first event's stable ID owns each whole message. Only changed heads are written;
continuations retain null search text. Tool and file-change openers retain their folded-card exclusion.
The transient owner holds one canonical page plus a head's prior text, fragments, and joined message, then releases them. There is
no retained message cache, scheduled task, timer, or client-dependent projection owner.

Both search entrypoints catch up the whole dirty corpus before applying task filters. This preserves
FTS corpus statistics. Ranked rows, snippets, and session reads share a synchronous SQLite transaction,
including when another connection commits a newer generation between ranking and snippet selection.
The tokenizer remains `porter unicode61`; ranking remains `bm25(0, 0, 1.0, 0.3)`. Title, artifact,
archive, task, workspace, and limit behavior remains intact. Agent Center breaks rank ties by session
update time; task search preserves FTS rank order for ties.

Stream boundaries flush dirty text after the canonical event commits. Provider retirement and
runtime shutdown flush after joining provider callbacks and the durable event buffer. The buffer's
per-session serialization still orders callbacks whose providers do not await persistence.

## Raw readers and client boundaries

| Consumer | Completeness owner |
| --- | --- |
| Runtime wait and execution results, including workflows | `store.snapshot` catches up and reads in one transaction. Its asynchronous session read remains intact for runtime frame ordering. |
| Delegation transcript pages | `store.eventPage` catches up the session and preserves sequence bounds and cursors. |
| Delegation results and reporting | `store.eventsForTurn` catches up the owning session before reading. |
| Fork context and transcript export | `store.exportSnapshot` catches up and returns the complete ledger. |
| Repository tests | The same raw read entrypoints retain full head text. |
| Lifecycle review input and completed-turn references | These consume canonical JSON and sequence information and expose bounded summaries, not raw search text. |
| Ledger compaction and folding | These own canonical card state and opener exclusion; canonical mutations mark dirty progress. |
| Managed HTTP snapshots and event pages | Dedicated client reads select no search-text bytes, skip materialization, and omit the field. Existing usage/tool folding and client socket stripping remain intact. |

`recordEvent` still returns the committed delta, rather than reconstructing history for each socket
frame. Only the raw read owners promise the complete materialized head.

## Recovery and migration

The migration marks populated databases dirty without replacing their canonical events or sequences.
Projection, FTS changes, and dirty-marker removal share a transaction. A failed catch-up leaves the
marker and rolls back partial materialization. The first projection read or event write after restart reinstalls missing derived objects, validates
FTS integrity and event identity, and schedules canonical session reconciliation. Missing or
inconsistent index content causes an index rebuild. Rowid drift, including maintenance with VACUUM,
is checked against stable event IDs. Repair definitions are compared with actual migrated SQLite
objects by the schema guard.

Initialization conservatively marks canonical sessions for reconciliation, covering lost markers and stale
progress. This costs a canonical scan at the first raw read or search after restart. Search and recovery modules load on first use to preserve the boot dependency boundary; failed initialization can be retried. A global search
can therefore scan the entire ledger after restart; that is an explicit recovery cost. No sustained
large-corpus restart latency or retained-heap measurement is claimed.

Deletion removes indexed rows immediately through the existing trigger. The canonical deletion
also marks its surviving session dirty so a removed stream head or sequence gap is reconstructed
correctly. Session deletion removes its pending marker. Projection runs synchronously and holds no
task capable of resurrecting deleted records.

## Evidence

The probe invokes the production `AgentStore.recordEvent`, both the writer's search barrier and
`searchSessions`, and the production raw export. Each case commits 16 KiB chunks. Searches run only
at the end, every 16 commits, or after every commit. Exact final text is asserted against the complete
chunk sequence; before/after SHA-256 hashes match for all nine cases.

Supported runs use the bundled Node 24.21.0 through `/tmp/acorn-unit12-bin/node`:

- `unit12-search-node24-cumulative-before.json` and `unit12-node24-before-hashes.json` preserve the fresh cumulative baseline.
- `unit12-search-node24-production-isolated.json` and `unit12-after-hashes.json` record the final production owner without overlapping builds or test suites.
- `unit12-search-node24-after.json`, `unit12-search-node24-after-isolated.json`, and `unit12-search-node24-final-isolated.json` preserve intermediate implementations or overlapping runs. They are superseded by the final isolated run.
- `unit12-search-probe.test.ts` and `unit12-probe.config.ts` preserve the repeatable workload and instrumentation.
- The earlier `unit12-search-cumulative-before.json`, `unit12-search-after.json`, and `unit12-search-after-final.json` used unsupported Node 24.11.0. They are superseded by the supported paired runs.

Prepared statement counts include production SQL submitted through SQLite's prepare interface and
exclude implicit trigger statements. Write counts classify those prepared inserts, updates, and
deletes. A measurement trigger counts actual search-text updates and UTF-8 materialization bytes.
FTS replacement counts include the initial head insertion and replacements caused by those updates
through the production FTS trigger. Logical materialization bytes include the initial fragment.
Filesystem figures measure apparent bytes in fixture files, including SQLite/WAL files. They do not
measure physical disk writes or total I/O, and are separate from logical rewritten text.

For 256 commits, the mechanism reduces FTS replacements from 256 to two with final-only search,
and to 17 with search every 16 commits. Logical materialization falls from 538,968,064 bytes to
4,210,688 bytes and 35,667,968 bytes, respectively. Search after every commit retains 256 replacements
and 538,968,064 logical bytes. Catch-up adds parsing, reads, and transaction work to that cadence;
the cost is measured rather than hidden.

| Commits | Search cadence | Elapsed ms, before / after | CPU ms, before / after | Prepared statements, before / after | Prepared writes, before / after | FTS replacements, before / after |
| --- | --- | --- | --- | --- | --- | --- |
| 16 | Final only | 56.39 / 25.65 | 59.03 / 20.56 | 96 / 86 | 47 / 37 | 16 / 2 |
| 16 | Every 16 | 50.80 / 11.30 | 50.56 / 12.71 | 99 / 90 | 47 / 37 | 16 / 2 |
| 16 | Every commit | 55.96 / 64.01 | 60.54 / 59.62 | 144 / 240 | 47 / 66 | 16 / 16 |
| 64 | Final only | 665.49 / 55.43 | 612.16 / 58.56 | 384 / 278 | 191 / 133 | 64 / 2 |
| 64 | Every 16 | 606.26 / 75.88 | 574.02 / 83.39 | 396 / 312 | 191 / 139 | 64 / 5 |
| 64 | Every commit | 733.79 / 709.74 | 578.30 / 688.22 | 576 / 912 | 191 / 258 | 64 / 64 |
| 256 | Final only | 11516.57 / 157.65 | 10064.26 / 171.62 | 1536 / 1047 | 767 / 517 | 256 / 2 |
| 256 | Every 16 | 10663.12 / 845.06 | 9815.73 / 785.50 | 1584 / 1208 | 767 / 547 | 256 / 17 |
| 256 | Every commit | 10591.17 / 12025.94 | 9900.62 / 11020.48 | 2304 / 3728 | 767 / 1026 | 256 / 256 |

These are single synthetic runs, not latency percentiles. The first after case includes lazy module
initialization; subsequent cases reuse the imported module code. Each case owns a separate database
and projector. Artifacts separate recording CPU/time from search CPU/time. For 256 commits with
final-only search, total elapsed falls from 11,516.57 ms to 157.65 ms and CPU from 10,064.26 ms to
171.62 ms. Search after every commit increases elapsed from 10,591.17 ms to 12,025.94 ms and CPU from
9,900.62 ms to 11,020.48 ms. That cadence retains full-head indexing and adds reconstruction work.
This is a Node storage measurement, not visible desktop latency or sustained-use evidence.

## Changed owners

- Migration 0012, its journal entry, schema declaration, and snapshot add durable dirty progress.
- `searchProjection.ts` and `searchSchema.ts` own materialization and repair.
- `sessionSearch.ts` owns synchronous ranked reads and snippets, extracted from the session repository.
- The session repository records deltas and owns search barriers and stream closure.
- The store owns complete raw reads and client reads that omit derived bytes.
- The managed bridge uses the client read paths; runtime retirement and shutdown flush the projector.
- Schema and projection tests cover migrated objects, failure rollback, concurrent generations,
  restart, repair, rowid drift, mutation, deletion, raw completeness, and shutdown.
- The shipped transcript-search reference describes these contracts. The future-work index advances
  to unit 13, and the completed unit 12 handoff is deleted.

## Verification commands

All commands use the `rtk` prefix. Supported-runtime commands additionally set
`PATH="/tmp/acorn-unit12-bin:$PATH"`.

- `pnpm exec vitest run --config plans/performance/unit12-probe.config.ts`, with distinct `ACORN_PERF_TAG` values, runs the matched workload.
- `pnpm --filter @acorn/plugin-agents exec vitest run src/server/sessions/searchProjection.test.ts src/server/sessions/sessionRepository.test.ts src/server/ftsSchema.test.ts src/server/sessions/ledgerFold.test.ts src/server/sessions/ledgerCompaction.test.ts src/server/sessions/historyRetention.test.ts src/server/sessions/runtime.test.ts src/server/sessions/durableEventBuffer.test.ts src/server/sessions/store.test.ts src/server/routes/managed.test.ts --maxWorkers=2` passes 142 tests in 10 files. The final bridge stripping adjustment passes 103 tests in three affected suites.
- `pnpm --filter @acorn/plugin-agents lint` passes.
- `pnpm db:check` passes all 11 migration chains, including populated pre-0012 upgrade coverage in the projection suite.
- `pnpm lint` was run and replayed after removing two unused imports introduced by extracting search. Oxlint passes in the final replay. Type checking completes 35 of 37 tasks before the TUI fails on the independent editor `DocumentCustody` export integration; the desktop lint task is cancelled.
- `pnpm lint:types` was run. Its first attempt encountered concurrent editor exports while unit 16 was being edited. The Agents package type check passes independently.
- `ACORN_TEST_CONCURRENCY=4 pnpm test` finishes with 34 of 37 package tasks successful when run with local socket/process access. Agents passes 1,041 tests with one skipped; Node passes 280; TUI passes 661 with two skipped. Remaining package failures are the plugin facade snapshot for editor exports, the client route classification and diff coloring checks, and the desktop service budget gate. No unit 12 test fails.
- `pnpm --filter @acorn/arch-tests exec vitest run docPaths.test.ts --maxWorkers=1` passes all three checks after the implementation records are present.
- `pnpm --filter @acorn/node build` compiles, then fails the unchanged 3,062,000-byte service ceiling. A replay replacing only unit 12's Agents source with its pre-unit source also fails at 3,071,580 bytes in the cumulative shared tree. The final lazy implementation measures 3,070,664 bytes. This independent budget failure remains open; the ceiling is not raised.

An initial test command passed file filters after an extra `--` and ran the entire Agents package.
That run exposed an assertion checking the outer Drizzle error instead of its SQLite cause, a
snapshot ordering regression, and a sandboxed process-table check. The error assertion and snapshot
ordering are corrected; the focused supported-runtime replay passes. These initial runs are not
accepted verification evidence. The first bounded repository run also hit sandbox restrictions on
local sockets and was stopped after repeated timeouts. Its initial documentation link failure was
resolved by writing the implementation record. The unrestricted replay replaces that incomplete run.

The implementation changes storage and Node read ownership. No renderer or terminal presentation
changes require a graphical UI fixture. All synthetic database fixtures clean up their temporary
data. The temporary runtime alias and comparison build are removed after verification. No provider, account, normal profile, or external message is used.

Final logs for the remaining gates are `/tmp/acorn-unit12-lint-verified.log`,
`/tmp/acorn-unit12-tests-unrestricted.log`, `/tmp/acorn-unit12-build-before.log`, and
`/tmp/acorn-unit12-build-final.log`. The focused result is `/tmp/acorn-unit12-final-tests.log`;
the final boundary replay is `/tmp/acorn-unit12-boundary-tests.log`.
