# Telemetry retirement and total histogram bounds

Date: October 1, 2026. Status: pending implementation; unit 28.
Assignment: one specialist, run sequentially after coordinator review of the preceding unit.
Prerequisite: Units 01–27, implemented and reviewed in sequence. Paths and findings describe the audit snapshot, not guaranteed merged source.

## Read first

Read [the programme](./README.md), [the implementation contract](./contract.md), and
[the deferred work](./refused.md). Follow the repository engineering guide and the owning runtime
documentation. Trace source, Node API, protocol, broker, cache, and renderer where this assignment
crosses them. Review Git changes since the audit before capturing a fresh cumulative baseline.

The preserved investigations contain the reproducible probes, measured workloads, source paths,
proposed improvements, rejected alternatives, and limits:

- [Investigation 16](../../../plans/performance/16-ownership.md).

The original [unit brief](../../../plans/performance/implementation-28-review-brief.md) and
[implementation sequence](../../../plans/performance/implementation-plan.md) retain provenance.
The sections below reproduce the detailed assignment so this handoff carries its review concerns.
No application fix for this unit is included in the units 01–08 commit.

## Detailed assignment

Source review on October 1, 2026. Read area16, docs/telemetry.md, custody telemetry and Node/client
collector contracts, plus unit02's returned span leases. Preserve consent authority, redaction,
bounded exporter retries, and normal production aggregation. Do not remove useful instrumentation
to improve a fixture. Queue representation and development User Timing retention remain conditional.

## Helper retirement and adoption

startHelperTelemetry.poll awaits readPref then applies without an owner or adoption generation.
drain retries failed records after disposal or consent revocation. Capture target Node and generation
at admission; every operation, including all encoded post batches, stays bound to that target.
Changing adoption or retiring cannot rearm sinks, pressure sampling, timers, or failed queues.
Overlapping preference polls need an explicit ordering/join policy, without duplicate subscriptions.
Revoke discards prior-consent work; re-enable must not replay it. A held A answer cannot enable B.

Trace the collector's own readPref/tick path as well as the helper's poll: a helper fence that leaves
the global collector applying a late read is incomplete. Fence any demonstrated late collector
adoption/stop result at its owning lifecycle without disabling other live sinks. Preserve intended
final flush with an explicit bounded shutdown delivery policy. Failed final delivery cannot restore
an ownerless queue. Broker abort uses owned request IDs; no global abort of another caller. Repeated
dispose, post success/failure across shutdown, and partial multi-batch outcomes must settle exactly.
Keep crash file validation/deletion/redaction and its documented best-effort forwarding behavior.

## Total histogram admission

Node recordDuration and client recordSample only attempt fallback when labels are present. The
fallback can create more series, and unlabeled names bypass the documented 200 bound entirely.
Enforce a total 200 live histogram series per flush window across every owner/seam/label/unit
combination. Existing admitted series continue aggregating exactly at capacity. Refuse a distinct
series explicitly and count refused samples with a bounded, documented overflow counter. Do not
merge operation names, owners, units, or label sets to manufacture exact totals. Node durations
remain milliseconds; client workload units remain independent. Reset window capacity at flush and
discard pending data on consent-off as documented. Update the owning contract and summary wording
if required, preserving wire compatibility for optional additions.

Inspect fingerprint ambiguity while tracing: delimiter concatenation and String(value) may collide
for legal attribute values/types. Repair only a reproduced collision and preserve exact attribution
without an unbounded global identity cache. Treat admitted histogram totals separately from refused
sample counts, ring/exporter drops, and attribute truncations. Overflow reporting itself must not
create variable names or consume unbounded histogram slots. No private telemetry content in probes.

## Evidence

Replay actual late-pref fixture, then A/B ordering, overlapping polls, pending failed posts, revoke
and re-enable, retirement, and final flush. Assert no resurrected sink/timer/queue and all request
owners settle. Node/client 1,000 distinct unlabeled names, variable labeled fallback names, mixed
owners/units, and admitted hot series prove 200 maximum, exact admitted aggregates, and 800 refused
samples for the simple 1,000-name case. Flush/retry and consent transitions preserve correct counts.
Use 100,000 stable measured calls to detect CPU regressions and forced-GC retained state where
useful. Keep prior on/off measurements as instrumentation cost, not a recommendation to turn it
off. Run focused custody/collector/emitter/protocol/privacy tests, types, lint, and owning docs.
Coordinator owns cumulative native/sustained-use gates after this final sequential unit.

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
