# Workflow history and processing read projections

Date: October 1, 2026. Status: pending implementation; unit 24.
Assignment: one specialist, run sequentially after coordinator review of the preceding unit.
Prerequisite: Units 01–23, implemented and reviewed in sequence. Paths and findings describe the audit snapshot, not guaranteed merged source.

## Read first

Read [the programme](./README.md), [the implementation contract](./contract.md), and
[the deferred work](./refused.md). Follow the repository engineering guide and the owning runtime
documentation. Trace source, Node API, protocol, broker, cache, and renderer where this assignment
crosses them. Review Git changes since the audit before capturing a fresh cumulative baseline.

The preserved investigations contain the reproducible probes, measured workloads, source paths,
proposed improvements, rejected alternatives, and limits:

- [Investigation 14](../../../plans/performance/14-background.md).

The original [unit brief](../../../plans/performance/implementation-24-review-brief.md) and
[implementation sequence](../../../plans/performance/implementation-plan.md) retain provenance.
The sections below reproduce the detailed assignment so this handoff carries its review concerns.
No application fix for this unit is included in the units 01–08 commit.

## Detailed assignment

Source review on October 1, 2026. Read area 14 and owning workflow execution/authoring/processing
docs. Capture fresh paired SQLite-owner evidence. This unit narrows read projections while complete
frozen definitions, graphs, authority and outputs remain durable for their actual consumers.

## History and navigation

workflowRunProjection selects full run/dispatch/source/root rows for scalar rail/list fields.
Introduce explicit typed field selections at each consumer's owner; task run history still needs
defJson for drawing its frozen graph. workflowRunReadModel currently discards graph/tool/budget/
trust/deadline fields only after materializing them. Omit those already-absent response fields in
SQL without narrowing fields the existing response consumes. Group lineage/usage by IDs once.

Keep latest-per-task history meaning, all historical descendants, reprocess dispatch source-root
ownership, missing lineage fallbacks, root versus own usage, unknown cost versus zero, statuses,
terminal timestamps, error preview and ordering. No arbitrary history cap or execution-data deletion.
Measure compact columns before adopting latest-per-task SQL or indexes. Timestamp ties need a
deterministic compatible policy and regression coverage. Any schema change appends a migration;
do not rewrite applied SQL. Authorization remains before route reads, not in a UI filter.

## Processing pages

workflowSelectionPage loads every snapshot, attempt, dispatch, run and full step output before
filtering/page admission. Counts/categories use only selected decision, dispatch state and run
status. Compute exact full-selection counts and eligible page IDs from compact fields first, then
read detail only for that page. Title, reason, retry step and result preview still require exact
fallback behavior for admitted and skipped rows, including an active prior attempt. Group steps by
run once rather than filtering the whole array per record. Use bounded SQL prefix projections only
where they preserve the existing preview semantics, ordering and structured-versus-plain choice.

Keep selection/step choice, after-position cursor, filter meaning, next cursor, global counts,
all-skipped/no-matches, provenance, deleted/missing run fallback and exact retry targets. The named
outputs/detail and record-attempt history APIs retain full inputs needed to compute outputs. Do not
substitute shortened JSON before parsing it or accidentally change malformed-data fallback. Paging
details must not alter retained attempts, retry authorization, processing decisions or execution.

## Evidence

Actual disposable plugin SQLite: ten roots/1,000 historical children, 100-run list, task history,
300-child/four-step selection first50/all and failed filters. Measure selected rows/string bytes,
CPU and plans separately; compare complete returned objects and full counts, not just row totals.
Reprocess/missing lineage, repeated task history, ties, null/zero usage, gated/terminal/missing runs,
skipped decisions, later cursor pages and full snapshot/attempt/named-output detail. Run focused
read-model/route/execution regression suites/types/lint and owning docs. Coordinate native workflow
history/filter/revisit functional screenshots with the coordinator. SQL byte reduction does not
by itself prove retained heap or visible navigation gain, and no provider execution is required.

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
