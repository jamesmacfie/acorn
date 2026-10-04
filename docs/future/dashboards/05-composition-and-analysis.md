> **Completed 2026-10-04** by the "Phase 05 composition and analysis" task.
>
> **What landed:** Plans now define scoped relations, explicit equivalence, and bounded filter, compute, summarize, expand, and overlap stages. Node reads related sources in one run, preserves record provenance and exact summary measure rows for drill-down, and exposes partial results and stage row counts. The editor has forms for these operations, and fixture evaluations cover the worked examples and stat and chart summaries.
>
> **Deviations:** Phase 03 provider enrichment was separate at Phase 05 completion and is now integrated; live-provider acceptance remains unverified. Fixture sources exercise the generic relation contracts, and GitHub provider fixtures cover enriched fields. The flaky-test expectations have no human annotation. The earlier desktop source-picker attempt and full Node suite were inconclusive; the integration audit records later verification.
>
> **For later phases:** Pure summary and bucket logic lives in `packages/dashboards-core/src/analysis.ts` and `planBuckets.ts`; `runPlanStages` in `plan.ts` remains the execution seam for a future database path. `PlanRow.measureRows` and `representedRows` hold the original evaluation snapshot used by measure and group drill-down. Source declarations use `DataSourceDescription.relations`; the editor offers those declarations and explicit scoped equivalence. Phase 06 can reuse the summary functions without adding dataset behavior to this phase.

# Workstream 5: composition and analysis

Status: proposed, 2026-10-02, revised the same day. Depends on
[workstream 2](./02-source-first-editor.md), and on [workstream 3](./03-identity-time-and-sources.md)
for the source facts most examples summarize. Read [what a row is](./design.md#what-a-row-is) and
[composition and analysis](./design.md#composition-and-analysis) first.

## Goal

Every panel states what one row represents. Panels attach lookup columns and child lists from other
sources through declared relations, merge rows only where an equivalence says two records are the same
item, and transform rows through a bounded list of repeatable stages: filter, compute, summarize,
expand, and overlap. Every operation keeps the four parts the design requires, so the editor and the AI
can use all of it.

## Milestones

| Milestone | Parts of this workstream |
| --- | --- |
| 2 | The row model with primary and lookup sources, scoped composite keys, unmatched-row handling, lookup relations, one compute stage, one summarize stage with count, count where, sum, average, minimum, maximum, and distinct count, and summary drill-down data. |
| 3 | Repeated stages up to the bounds, compute over measures, share of total, datetime buckets, median, percentiles, previous-bucket change, pivots, and stat and chart as views over a summary. |
| By demand | Children sources and expand, equivalence and row merging, and overlap. |

## What the owner gets at the end

- Panels that say what they count: "one row per pull request", "one row per repository", "one row per
  pair of overlapping meetings".
- Summary tables such as "open pull requests by repository, with drafts, failing CI, and ready to
  merge", where the counts can overlap.
- Calculations after a summary, such as completed points divided by total points, or each service's
  share of total spending.
- Weekly trends with median, 95th percentile, and the change from the week before.
- Multi-stage analysis such as tests that both passed and failed on one commit, with their failure
  rates, in a panel rather than a workflow.
- Lookups such as each local branch's pull request, and child lists such as each invoice's payment
  attempts.
- One row per item when two systems hold mirrored copies of it, and never when one item merely relates
  to another.
- Conflicts between meetings across calendars from different providers.

## Starting point

- Workstream 2's plan binds primary sources into rows and runs filter stages through a registry of
  operations, then sorts, groups, and limits.
- `aggregateRows` in `packages/dashboards-core/src/shaping.ts` computes count, sum, average, minimum,
  and maximum for the stat view. `packages/dashboards-core/src/chart.ts` buckets lines by UTC day only
  and bars by enum value.
- `unionRows` in `packages/dashboards-core/src/mapping.ts` appends rows from each query.
- [refused.md](./refused.md) replaces the August refusal of joins with a refusal of undeclared joins,
  fuzzy matching, and silent multiplication.

## Requirements

Each operation below ships with its form, its describer, its validator, and its evaluation cases, and
appears in the capability list.

### The row model

1. Sources in a plan have a role: `primary`, `lookup`, or `children`. Primary sources supply rows.
   Lookup and children sources attach to primary rows through relations and never supply rows of
   their own.
2. Relation keys may be composite, and every key includes its scope: provider, account, and the
   container where one is needed, such as the repository for a GitHub pull request number. The
   validator refuses a key that leaves out a scope the source declares.
3. A primary row with no lookup match stays by default, with the lookup's columns unknown. A relation
   can drop unmatched rows instead, and the describer says which.
4. Row identity follows the operations as [what a row is](./design.md#what-a-row-is) describes, and
   every run row carries its identity and provenance, which drill-down and actions use.
5. The describer states what a row is at the end of the plan, and the preview shows it above the rows.

### Relations

6. Source descriptions may declare relations: from one of the source's fields to another source's
   field, with a kind, a label, and a cardinality. Kinds include implements, blocks, belongs to, and
   references. The target is read through the data-source runtime with the person's authority, in the
   same run.
7. A plan may declare a relation between two sources, stating the kind and cardinality.
8. Cardinality is one-to-one, many-to-one, or one-to-many. One-to-one and many-to-one attach lookup
   columns. One-to-many attaches the matches as a list column.
9. Every run checks cardinality. A violation fails that relation with a warning naming the relation and
   the key, and never multiplies rows.
10. Related reads count against the run's budgets, and relations have an output-row cap.

### Equivalence

11. Equivalence is a relation kind meaning "the same item in another system", such as a GitHub issue
    and the Linear issue that Linear's sync mirrors from it. A pull request that implements an issue is
    not equivalent to it.
12. Only an equivalence merges rows. The merged row keeps every record reference, and per-column
    precedence decides which source's value wins. Matching never uses titles, labels, or names.
13. Equivalence is declared by a source that knows the mirror exists, or by the plan on an explicit
    identifier both sources carry, such as an external invoice ID scoped to its provider.

### Stages

14. A plan holds at most eight stages, of which at most three summarize and at most one overlaps.
    Stages form one linear list with no branching. The validator checks that each stage's inputs exist
    with the right types in the columns produced by the stages before it.
15. **Filter** keeps rows that match, before or after a summary.
16. **Compute** adds columns from the closed expression set: column references, literals, context
    values, the four arithmetic operations, the difference between two instants in a unit, coalesce, a
    choice from an enum or boolean to a value, and the smaller or larger of two values. After a
    summary, it works on measures. Division by zero and unknown inputs give unknown. Unit rules from
    workstream 2 apply to every expression.
17. **Summarize** groups by up to three columns, with datetime buckets of day, week, or month under the
    plan's time policy, and computes named measures: count, count where, sum, average, minimum,
    maximum, median, percentile from 1 to 99, distinct count, distinct list, earliest, and latest. Each
    measure can carry its own filter, which is how overlapping counts work.
18. A numeric measure can be expressed as a share of its total across all groups.
19. A time-bucketed summary can add the change from the previous bucket, as an amount and as a ratio,
    and can fill empty buckets with zero for counts and unknown for everything else.
20. A pivot spreads one measure across an enum column's declared choices.
21. A measure over rows with unknown values is marked partial. A measure over an incomplete read or an
    uncovered window is marked partial with the reason. Mixed currencies refuse, as workstream 2
    requires.
22. Each summary row keeps the identities of the rows it stands for and each measure's filter, so
    drill-down in workstream 4 can open them.
23. **Expand** turns one list column into one row per element, copying the other columns, bounded per
    row and per run.
24. **Overlap** takes a start column, an end column, and an optional partition column, and returns one
    row per pair of rows whose intervals intersect within a partition, with both sides' columns and the
    overlap duration. It is bounded by input rows and output pairs, and uses a sorted sweep rather than
    comparing every pair.
25. Bucket arithmetic moves out of `chart.ts` into the shared plan module. Stat becomes a view over a
    one-row summary and chart a view over a summary drawn as bars or lines, keeping the existing view
    options and their meaning.

### Worked examples for the evaluation suite

26. The suite carries the flaky-test plan from the design as a fixture: summarize by test and commit,
    compute `flaky`, summarize by test, compute the failure rate, filter. Its expected rows are
    annotated by a person.
27. The suite carries a calendar-conflicts plan over two fixture calendar sources from different
    providers: equivalence on event identity plus recurrence identity to merge duplicate invitations,
    then overlap partitioned by attendee.
28. The suite adds examples 5, 7, 9, 10, 14, 15, 18, 25, 28, and 30 with fixture sources, including a
    relation whose cardinality fails, a summary over an incomplete read, and a total across mixed
    currencies.

### Editor and AI

29. **Add stage** offers relations only where one is declared for the chosen sources or the columns
    allow one, offers expand only for list columns, and offers overlap only for a pair of datetime
    columns.
30. The editor shows the common shape (filter, summarize, then present) by default, and lets the
    person insert a stage at any point the types allow.
31. The preview shows each stage's row count and the row meaning after it, so a relation that drops
    rows or a summary that changes what a row is stays visible.

## Done when

Milestone 2: "Summarize open pull requests by repository, with drafts, failing CI, and ready to merge"
builds from words or from the forms, says "one row per repository", and its measure cells drill down.
Each local branch shows its pull request through a lookup, and a branch with none stays in the panel.

Milestone 3: a weekly CI duration panel shows median, 95th percentile, and the change from the previous
week. A panel shows each service's share of total spending through a compute stage after the summary.
The flaky-test fixture produces its annotated rows. A stat and a chart over the same summary show the
same numbers.

By demand: a combined GitHub and Linear panel shows one row for a mirrored issue and two rows for an
issue and the pull request that implements it. A relation declared many-to-one that finds two matches
fails with a warning instead of doubling a total. Overlapping meetings across a Google and an Outlook
calendar appear once per pair.

## Docs to update

- [Dashboards](../../dashboards.md): the row model, every operation, stage bounds, and partial
  measures.
- [Typed data sources](../../data-sources.md): declared relations, relation kinds, equivalence, and
  scoped keys.
- [refused.md](./refused.md): remove the workstream reference once relations ship, and keep the refusal
  of undeclared joins.

## Verify before building

- How chart and trend code in `chart.ts` and `trend.ts` bucket and fill, so moving buckets keeps
  existing panels identical.
- Run budgets from workstream 2, and whether relation reads fit inside them for the examples.
- Which first-party sources can declare equivalence, such as Linear's GitHub issue sync, and which
  links are only relations, such as Linear's attached pull requests.
- Interval overlap cost at the run's input cap, so the output-pair bound is set from a measurement.
