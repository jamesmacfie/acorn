# Agent wait facts and complete result capture

Date: October 1, 2026. Status: pending implementation; unit 13.
Assignment: one specialist, run sequentially after coordinator review of the preceding unit.
Prerequisite: Units 01–12, implemented and reviewed in sequence. Paths and findings describe the audit snapshot, not guaranteed merged source.

## Read first

Read [the programme](./README.md), [the implementation contract](./contract.md), and
[the deferred work](./refused.md). Follow the repository engineering guide and the owning runtime
documentation. Trace source, Node API, protocol, broker, cache, and renderer where this assignment
crosses them. Review Git changes since the audit before capturing a fresh cumulative baseline.

The preserved investigations contain the reproducible probes, measured workloads, source paths,
proposed improvements, rejected alternatives, and limits:

- [Investigation 09](../../../plans/performance/09-agent-node.md).

The original [unit brief](../../../plans/performance/implementation-13-review-brief.md) and
[implementation sequence](../../../plans/performance/implementation-plan.md) retain provenance.
The sections below reproduce the detailed assignment so this handoff carries its review concerns.
No application fix for this unit is included in the units 01–08 commit.

## Detailed assignment

Source review on October 1, 2026. Start after preceding units pass coordinator review. Read report 09,
unit 10 process ownership, unit 11 queue/cursor contracts, and unit 12 raw/search completeness first.

`runtime.wait` reads full session snapshots initially, on every qualifying frame, after registration,
and on timeout. Each snapshot includes all prior turns/requests and a bounded event prefix after the
original cursor. Concurrent callbacks can start overlapping reads. `conditionMet` finds terminal
events only within that first prefix, so completion beyond 500 rows is unreachable even though the
ledger and current turn are complete.

Introduce narrow authoritative wait facts, one active check with a dirty follow-up, and an exact
condition/completeness result. Preserve the initial-read/listener gap closure. A cursor-based
turn_completed wait requires a qualifying terminal fact after the requested cursor; a prior completed
turn or current ready state alone cannot satisfy it. Ready, attention, and stopped conditions have
their own current-row semantics. Target deletion, engine teardown, caller cancellation, held read
completion, timeout, and multiple waiters need explicit settlement and listener/timer cleanup. Do not
let an unrelated session frame or a stale check satisfy a replacement waiter generation.

The public ManagedAgentsBridge and delegation capability consume this result. Delegation currently
recomputes matched from the returned snapshot through `waitConditionMet`; a server-only condition flag
cannot silently disagree with that consumer. Return a concrete compatibility proposal before changing
the wait return contract. Preserve existing tools' matched/timedOut/state/attention/lastSeq semantics,
and document any additive facts or completeness marker at the owning contract.

`sessionExecute` waits from a captured beforeSeq, then parses assistantResult from snapshot.events.
Its success, cancellation, and timeout paths all use the bounded prefix. Collect the complete target
turn's accepted event stream through bounded pages before assistant/structured-result parsing and
capture. Freeze the relevant committed reach for that read so another ongoing turn cannot make the
collection chase an unbounded moving tail. Preserve all target-turn assistant and reasoning/tool
events required by its capture contract; do not substitute delegation's intentionally bounded
readable projection for complete workflow output. Keep the ordinary client snapshot page cap.

Trace live onEvent forwarding alongside final capture: registration after enqueue can miss an early
event, and final page collection must not introduce duplicate live notifications. Preserve canonical
sequence identity and existing callers' division between streamed callbacks and final capture. Late
usage handling must follow the documented completion contract rather than wait indefinitely for a
provider that never reports usage. Failed, interrupted, cancelled, malformed, timeout, and successful
structured outputs must keep their status and retained exact response text.

Proof uses actual runtime/store/delegation/sessionExecute owners with migrated disposable SQLite and
fake providers. Capture fresh cumulative baseline and compare 101 frames with zero/1,000 historical
turns. Count narrow reads, mapped rows, CPU, and returned bytes. Resolve completion after 500 and
2,000 events, including a result and JSON token spanning page boundaries. Exercise initial gap,
dirty check during an active read, multiple waiters, pending request/attention, timeout, cancellation,
deletion, stop, earlier completed turns, and two target turns. Assert exact capture and no remaining
waiter listeners/timers. No real provider or paid call is needed.

## Completion and handoff

Implement only the reproduced issues within this assignment. Return any explicitly requested
compatibility, migration, or custody proposal to the coordinator before changing that contract.
Use current production owners for paired evidence; preserve historical fixtures and label superseded
baselines. Write an implementation record with changed files, exact commands and outcomes, before
and after comparisons, costs, and concrete remaining limitations. Update the owning shipped docs
when behavior changes. Retire all disposable resources before review. Do not start the next unit.

## Verify before building

- Re-read the merged source and applicable engineering instructions; the audit predates the main merge.
- Confirm prior units' contracts and actual callers still match this proposal.
- Resolve the listed owner, capability, data model, migration, and compatibility decisions before editing.
- Verify a single Solid runtime and normal QueryClient provider for browser measurements.
- Capture fresh source/probe hashes and the same supported workload on both sides of the change.
- Preserve canonical content, offline rows, unsent drafts, and independent Node authority.
- Run relevant tests and types, then coordinate cumulative lint, bounded tests, and real UI checks.
