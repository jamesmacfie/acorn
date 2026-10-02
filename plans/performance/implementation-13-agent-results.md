# Agent waits and complete workflow results

Implemented October 2, 2026, against the cumulative performance checkout. This record replaces
`docs/future/performance/13-agent-results.md`.

## Ownership and compatibility

The Agents Node plugin owns the session row, canonical SQLite ledger, provider event buffer, and
waiter lifetime. HTTP callers retain the ManagedAgentsBridge snapshot shape; the broker and client
cache carry it without acquiring execution authority. Delegation consumes the wait fact at the
same capability boundary. Workflow execution receives a complete capture through
`agents.sessionExecute`. No database migration, shell change, or presentation change is required.

The compatibility proposal stated before implementation retains `session`, `turns`, `requests`, and
the 500-row event prefix, with an optional additive `wait` field. That field exposes `until`,
`afterSeq`, `matched`, the qualifying terminal sequence and turn ID, `eventsThroughSeq`, and
`eventsComplete`. Snapshot content and facts share one SQLite transaction. Delegation checks the
condition and cursor before trusting the fact, and falls back to snapshot events for older
implementations. Its tool fields `matched`, `timedOut`, `state`, `attention`, and `lastSeq` retain
their meanings. The terminal fact is explicit on the public response, rather than a private flag.

`turn_completed` requires a committed terminal or error event strictly after the cursor. Current
ready state and prior completion cannot substitute. Ready, attention, and stopped use their
current-row semantics. Timeout hydrates a final snapshot and reports the condition at that read,
which can include completion arriving at the deadline. Deletion, caller abort, storage failure,
and runtime shutdown reject and release the waiter. HTTP abort removes only that caller's wait.

## Implementation

- `waitFacts.ts` selects scalar state and one qualifying terminal fact. It reads no historical
  turn or request bodies and maps no event payloads during progress checks.
- `sessionWait.ts` owns the subscription, deadline, and abort handlers. It subscribes before the
  initial read, retains the setup recheck, serializes checks, and coalesces frames during a held
  read. Unrelated sessions and results from settled waiters cannot satisfy another waiter.
- `AgentStore.waitSnapshot` retains the asynchronous session-read boundary, then hydrates facts
  and the bounded snapshot together. The runtime's shutdown signal settles waits before listeners
  are cleared. The managed route forwards request cancellation.
- `executionCapture.ts` reads only the selected target turns and their events in 500-row pages.
  One SQLite transaction fixes both content and committed sequence reach. Concurrent append to an
  ongoing turn cannot extend or change that capture.
- `ManagedAgentRuntime.captureExecution` flushes accepted buffered deltas before collecting pages.
  Success, cancellation, timeout, and continuation paths use this owner. Cancellation joins the
  target cancellation before capture, including an abort during a continuation enqueue.
- `ExecutionEvents` subscribes before enqueue, holds early events until the turn ID is known,
  and forwards canonical sequences once. Final capture does not replay callbacks. An absent
  callback requires no early-event buffer.
- Workflow assistant parsing receives the complete response, including text beyond 256 KiB.
  Replacement, append, and outer-whitespace trimming semantics are preserved. Error, interrupted,
  cancelled, timeout, refusal, malformed, and structured-success status handling stays intact.

The completion contract uses usage committed on the last target turn at capture time. It does not
wait for a provider that never sends usage. Later usage remains durable. An explicitly turn-bound
usage record can update that turn; a provider event without a turn association remains a session
event. Returned captures do not mutate afterward.

Shipped contracts are documented in `docs/managed-agents.md` and `docs/workflows/execution.md`.
The performance index links this implementation record and the pending handoff is deleted.

## Paired evidence

`unit13-cumulative-before.json` preserves the fresh baseline and SHA-256 source/probe hashes.
`unit13-production-final.json` records the final production wait owner. The intermediate
`unit13-production-after.json` is retained and superseded by that final replay. Both accepted runs use the bundled Node
24.21.0, migrated disposable Agents databases, and 101 synthetic event frames. No provider runs.
Historical turns are seeded before measurement. The workload includes durable event writes,
wait checks, hydration, and the probe's JSON serialization. Terminal projection frames also wake
the wait. Returned bytes count values returned by the measured store methods, rather than wire
traffic. Row counts include hydrated rows and scalar authority rows.

| Historical turns | Full snapshot reads, before / after | Scalar checks, before / after | Read rows, before / after | Returned bytes, before / after | CPU ms, before / after | Elapsed ms, before / after |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 104 / 2 | 0 / 105 | 5,256 / 311 | 1,254,835 / 55,919 | 207.704 / 103.614 | 148.692 / 80.763 |
| 1,000 | 105 / 2 | 0 / 105 | 109,257 / 2,311 | 32,432,384 / 655,477 | 414.291 / 96.691 | 391.846 / 70.836 |

The two hydration reads reflect a projection frame arriving during final hydration and requesting
a dirty recheck. Historical turn bodies are read at settlement rather than once per progress frame.
Scalar check counts stay fixed across the two history sizes. These are single synthetic samples,
not percentiles, retained-heap measurements, native latency, or sustained-use evidence. Other
specialists modify the shared branch; operation counts establish the removed work independently
of host scheduling noise.

The probe adds optional instrumentation for the replacement `waitFacts` and `waitSnapshot` methods.
The before artifact retains the original probe hash. The after artifact identifies its adapted
probe. Neither baseline is overwritten.

The complete-capture regression is also run against a disposable archive of the pre-change Agents
source. Both 501-event and 2,001-event cases return `malformed` where `ok` is required. The same
tests pass through the production runtime, migrated store, and fake Claude driver after the fix.
They assert exact 300,000-character structured content, a JSON token crossing pages, and matching
canonical callback sequences without duplication.

## Verification

Every shell command uses `rtk`. Supported commands set
`PATH="/tmp/acorn-unit13-bin:$PATH"`; that temporary alias points to the repository's bundled
`apps/desktop/src-tauri/binaries/node-aarch64-apple-darwin`.

- `ACORN_PERF_TAG=cumulative-before pnpm exec vitest run --config plans/performance/unit13-probe.config.ts`
  passes the baseline probe. `ACORN_PERF_TAG=production-final` passes the paired production probe.
- `pnpm --filter @acorn/plugin-agents exec vitest run src/server/sessions/executionCapture.test.ts src/server/sessions/sessionWait.test.ts src/server/sessions/sessionExecute.test.ts src/server/sessions/runtime.test.ts src/server/delegation/service.test.ts src/server/routes/managed.test.ts src/server/sessions/store.test.ts --maxWorkers=2`
  passes 163 tests in seven focused storage, runtime, delegation, execution, and route suites.
- `pnpm lint` passes all 37 tasks, including oxlint and package type checks.
- `pnpm --filter @acorn/plugin-agents lint` passes after the final buffered-capture changes.
- `pnpm --filter @acorn/arch-tests exec vitest run docPaths.test.ts --maxWorkers=1` passes all
  three checks with the completed implementation record.
- `ACORN_TEST_CONCURRENCY=4 pnpm test` finishes with 32 of 37 package tasks successful. The
  complete Agents suite passes 1,062 tests with one skipped; Node core and Node composition pass.
  The full run caught this record's link before the file was written; the focused documentation
  replay above resolves that failure. Other failures are the editor-related plugin facade snapshot,
  the core `projectWorktreesRoute` classification, the cumulative desktop service budget, and three
  TUI editor cases reporting `window.addEventListener is not a function`. These owners are outside
  this assignment. The desktop static graph is 3,091,989 bytes against the unchanged 3,062,000-byte
  ceiling. The budget gate prevents the desktop tests and Rust stage from running. The run uses
  disposable fixture process/socket access and the repository's bounded test command.

`unit13-final-hashes.json` records all changed Agents source, test, and probe hashes.
Accepted logs are retained under `plans/performance/evidence/unit13-*`. The full repository log
also retains the failures above. Repository lint precedes the final buffered-capture method and
test additions; the final focused tests, package types, and bounded full Agents run cover those
changes. No renderer or terminal implementation is changed by this unit.

The wait tests cover completion outside the 500- and 2,000-row prefixes, initial setup, dirty held
reads, unrelated sessions, multiple waiters, replacement cursors, permission attention, ready and
stopped state, timeout, abort, deletion, shutdown, and storage failure. They assert no remaining
listeners or deadlines. The execution tests cover early streaming, full reasoning/tool capture,
two target turns, unrelated history, structured results, partial cancellation and timeout text,
failed/interrupted output, refusal, malformed results, buffered append cancellation, and late usage.
The concurrent-connection test appends during page collection and proves that the result stays at
the captured committed reach.

The first focused run exposed the setup test's obsolete snapshot interception and an asynchronous
frame-ordering dependency. The test intercepts the authoritative scalar reader; final hydration
retains the session-read boundary. Two synthetic fixture mistakes initially left a session working
after manual history seeding and attributed unbound late provider usage to a turn. The fixtures
use actual completed execution history and assert the documented usage association. Initial
test-only TypeScript errors are corrected. The disposable before replay initially lacked inherited
TypeScript configs; its accepted replay fails on the expected malformed-result assertions.

## Costs and limits

Terminal checks use the session/sequence index and a SQLite JSON type predicate. They do not add an
index or cached terminal authority; scanning a large nonterminal suffix can still cost SQL work.
Returning a compatible wait snapshot still reads historical turn and request rows at settlement.
This unit removes repeated hydration, rather than changing the ordinary snapshot history contract.

Complete workflow capture retains all required event and response content in memory. Page size
bounds individual reads, not the final outcome's total size. The synchronous read transaction and
search materialization can hold the Node while a large result is collected. Early forwarding can
temporarily retain events produced before enqueue returns. These costs preserve complete output.
The provider ledger's established folding and artifact policies remain authoritative.

All fixtures own disposable databases and fake providers. The before archive and runtime alias
are retired after verification. No renderer or terminal presentation changes require a graphical
fixture. No paid calls, normal profiles, external messages, branches, or subsequent unit work are
part of this implementation. The broader performance programme remains open.
