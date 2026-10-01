# Agent queue admission, discovery, cursors, and usage

Date: October 1, 2026. Status: pending implementation; unit 11.
Assignment: one specialist, run sequentially after coordinator review of the preceding unit.
Prerequisite: Units 01–10, implemented and reviewed in sequence. Paths and findings describe the audit snapshot, not guaranteed merged source.

## Read first

Read [the programme](./README.md), [the implementation contract](./contract.md), and
[the deferred work](./refused.md). Follow the repository engineering guide and the owning runtime
documentation. Trace source, Node API, protocol, broker, cache, and renderer where this assignment
crosses them. Review Git changes since the audit before capturing a fresh cumulative baseline.

The preserved investigations contain the reproducible probes, measured workloads, source paths,
proposed improvements, rejected alternatives, and limits:

- [Investigation 09](../../../plans/performance/09-agent-node.md).

The original [unit brief](../../../plans/performance/implementation-11-review-brief.md) and
[implementation sequence](../../../plans/performance/implementation-plan.md) retain provenance.
The sections below reproduce the detailed assignment so this handoff carries its review concerns.
No application fix for this unit is included in the units 01–08 commit.

## Detailed assignment

Source review on October 1, 2026. Read report 09 and the reviewed unit 10 ownership contract first.
This brief does not authorize concurrent implementation or starting before preceding units pass
coordinator review.

## Queue admission and durable heads

Queue-driven startup currently occurs in both `runtime.enqueueTurn` and `runtimeEngine.pump`.
Changing only the pump leaves eager startup in the public command path. Reserve workspace and
provider admission before the first provider start, count pending reservations alongside active
turns, and release the exact reservation on every failure, cancellation, and shutdown path. Recheck
the durable head after asynchronous workspace/startup work before recording or sending a user turn.
An enqueue is accepted once durable; do not turn a later startup failure into a false failed HTTP
acknowledgement. Explicit ready-on-return session creation and provider configuration negotiation
have a different contract and can legitimately start an interactive handle. Preserve their behavior.

The single pump already owns a dirty/rescan flag and reads fresh ceilings per pass. Preserve those
edges and the five-interactive fairness rule. Non-destructive limit lowering must leave accepted
turns running. Do not bypass an earliest deferred head to dispatch a later turn in its session.
Cancellation while a startup reservation is pending must join unit 10's actual process owner; map
removal alone is insufficient. Avoid introducing redundant startup or reservation maps that disagree
about the same live generation. Describe the integration before editing these two runtime owners.

`store.queuedHeads` reads every nonarchived Acorn-controlled session and calls `nextQueuedTurn` per
row. Select queue heads and their plugin-owned session rows together with constant statement count.
Keep workspace membership in CoreServices rather than joining core and plugin SQLite databases.
Inspect EXPLAIN QUERY PLAN before adding an index and append migrations rather than editing applied
SQL. Preserve controller/archive filters and earliest queued ordinal. Maintain the rescan when an
enqueue happens during an empty scan; ordinary text frames do not perform this scan.

## Discovery generation

`providers` caches completed descriptors for 15 seconds but has no in-flight owner.
`AgentDriverRegistry` has identity-guarded disposer closures but no revision signal; a replacement
factory can have the same provider ID. An ID-list comparison cannot prove registry identity stayed
unchanged. Capture a registry generation or equivalent typed owner before probes, join an ordinary
miss, define forced refresh semantics, and prevent superseded or stopped waves from repopulating the
cache. Clear only the matching in-flight wave in `finally`. Preserve per-provider diagnostic
descriptors and authentication authority, and allow retry after failure. Discovery freshness never
proves provider startup readiness or acceptance.

## Cursor compatibility

Session roster cursors are public: `AgentSessionList.nextCursor` is a string, but the route schema,
ManagedAgentsBridge, and store filter accept numeric timestamps. Event pagination uses distinct
sequence numbers and must remain separate. Add deterministic `(updatedAt, id)` ordering and the
matching seek predicate. Return a proposal for old-client/new-Node and new-client/old-Node behavior
before changing the wire contract. An explicit additive format opt-in, like the existing tool-fold
opt-in, is one option; silently returning an opaque cursor that an old reader parses as a timestamp
is not compatible. Bound and validate composite cursors without reading unrelated private state.

Trace through the route capability, captured-Node client API and store ownership supplied by unit 09,
and internal source readers. Preserve task/workspace/archive/attention/title filtering. A cursor
after deletion of its anchor must still seek correctly from its encoded values. Page ties at limits
one, five, and 100, mixed timestamps, deletions, and relevant filter combinations exactly once under
the documented roster consistency model. Do not claim snapshot pagination across concurrent edits
unless the implementation actually provides it.

## Daily usage append

`claudeDailyUsage` spreads all accepted parsed records into one `records.push` invocation. Append
without an argument-count limit; preserve the accepted 32 MiB file bound, partial-record tolerance,
cross-file last-winner deduplication, local-day aggregation, model/pricing behavior, and skipped-file
accounting. The accepted 19 MB/200,000-record fixture must contribute its records with zero skipped
files. History caching and streaming aggregation remain unselected because their cross-file duplicate
and freshness contracts need separate proof.

## Evidence

Use fresh cumulative before artifacts after unit 10. Compare actual store statements and query plans,
fake provider start and active/reserved counts, actual probe invocations, tied cursor reach through
the route, and the actual daily analyzer. Measure empty queues at 100/1,000/5,000 idle sessions and
20 cold queued sessions at a limit of two. Preserve exact queued heads, fairness, notBefore, raises,
lowering, rejection, restart, and shutdown tests. No real provider process or paid invocation is
needed. Distinguish fake handle counts from native process memory savings.

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
