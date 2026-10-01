# Unit 24 coordinator review brief

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
