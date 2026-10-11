# 14: Dense modules

> **Completion note, October 12, 2026.** Four of the five modules are rewritten. `workerHost.ts`
> waits on proposal 11, as this proposal says. No line in any of the five passes 120 characters.
> `pnpm lint`, the arch tests, and the `@acorn/plugin-git`, `@acorn/dashboards-core`,
> `@acorn/node-core`, and `@acorn/client-core` suites pass on Node 26.8.1, and so does `pnpm test`.
>
> What landed:
>
> - **`dependencyReview.ts`.** The formatter had already put `Resolution` and `Parsed` on several
>   lines. An `isRecord` check replaces the ten hand-written object tests, and
>   `assertDependencyTables` replaces the two loops that called `record(raw)[group]` four times.
>   `recordTruncation` adds a truncation message once, so each guard names its message once.
>   `DEPENDENCY_GROUPS`, `INSTALLED_GROUPS`, and `PYTHON_FILES` name the lists that were repeated
>   inline. Every limit, message, and thrown error is unchanged.
> - **`PlanRow`** keeps only what every row has: `id`, `values`, `records`, and `recordItems`. Each
>   stage's function takes and returns its own type. `bindPanelRows` and `relatePanelRows` work on
>   `SourceRow`, which adds the record's actions and the `source*` tracing fields. `summarizeRows`,
>   `finishSummaryRows`, and the SQLite summary return `SummaryRow`, and `overlapRows` returns
>   `PairRow`. `runPlanStages`, `expandRows`, `displayPlanRun`, and `DashboardRun.rows` use
>   `StageRow`, because stages run in any order and a row between them can carry any stage's fields.
>   Functions that read only `values` take `PlanRow`. `sortPlanRows` is generic, so it returns the
>   type it gets. `bindPanelRows` builds the record's actions once instead of twice. The long
>   description strings in `describePanelPlan` are split into named pieces.
> - **`inspectors.tsx`.** Every plan edit moved to `studio/planEdits.ts`, as a function that takes
>   the plan, or one part of it, and returns the edited copy. That covers the outline's Add menu edits
>   that were already named, and about 40 inline handlers that rebuilt sources, relations, columns,
>   choices, steps, sorts, groups, the view, buttons, and time settings. The inspector is 1,591 lines,
>   down from 1,890. `planEdits.test.tsx` checks the edits with the most branches.
> - **`service.ts`.** The formatter had already expanded the one-line methods. A private `attempt()`
>   replaces four copies of the same query. The exit outcome is one ternary instead of two in step.
>   `TaskScriptEvidenceService` drops a `Pick` that an `Omit` undid.
>
> Decisions and deviations:
>
> - **`workerHost.ts` is untouched.** This proposal says to rewrite it after proposal 11 settles the
>   legacy mode. It has no line over 120 characters.
> - **Base row plus named extensions, not one type per stage.** A filter, compute, or expand stage
>   can follow a summary, so no stage after binding sees one fixed shape. `StageRow` names that union
>   honestly. The extensions stay private to `plan.ts`. Only the row types are exported.
> - **Two test files changed.** `operationForms.test.tsx` imports `addStageTo` from `planEdits`,
>   because the function moved. The new test is a `.tsx` file, because the `logic` test project can't
>   load the `.tsx` modules that `planEdits.ts` imports.
> - **The agents store and the editor controller are left alone.** Phases 06 and 07 flagged them for
>   size. This proposal's test is density, and neither packs logic into expressions. The store has one
>   long comment line, which belongs to proposal 15. The controller has one long template string.
> - `docs/dashboards/mapping-and-editor.md` names `planEdits.ts` beside the inspector.
>
> For later phases: a new studio control calls a function in `planEdits.ts` inside `change`, rather
> than building the edited plan inline. A new plan stage returns its own row type and widens
> `StageRow` if it adds fields.

This proposal rewrites a short list of modules that are hard to read even after formatting. Each has
logic packed into expressions, or a type that stands for several shapes.

Date: October 11, 2026. Status: proposed. Depends on: [13: formatter](./13-formatter.md). Part of
the [cleanup programme](./README.md).

## Problem

A formatter wraps long lines but can't change what a line does. These modules need a person's
rewrite:

**`plugins/git/src/server/changes/dependencyReview.ts`.** It parses lockfiles and manifests for the
dependency review before a commit, which is security-relevant code. Its types `Resolution` and
`Parsed` sit on single lines. One condition calls `record(raw)[group]` four times. Two truncation
guards each repeat their message twice in one line, once to check for it and once to add it.

**`packages/dashboards-core/src/plan.ts`.** `PlanRow`, at line 26, has three required fields and 16
optional ones, among them `representedRows`, `measureRows`, `childRecords`, `summaryStage`,
`datasetGroups`, `correctableDatasetId`, `sourceRecords`, `sourceValues`, `sourceFieldValues`, and
`sourceWritableFields`. A row at one pipeline stage carries a different subset than a row at
another, so every reader checks fields that can't be present at their stage. Each of the 37 source
lines that name `PlanRow` has to guess which subset it holds.

**`packages/client-core/src/features/dashboards/studio/inspectors.tsx`.** It holds 67 lines over 160
characters. Several inline handlers rebuild nested plan state in one expression.

**`packages/node-core/src/server/taskScripts/service.ts`.** Several methods sit on one line each,
such as `reconcile`, and queries chain four conditions in one call.

**`packages/client-core/src/host/tree/workerHost.ts`.** Its handle methods run one ternary chain per
line. Rewrite it after [11: mixed-version policy](./11-mixed-version-policy.md) settles the legacy
mode, because most of the branches come from that mode.

## Goal

A reader can follow each module top to bottom without unpacking an expression in their head.

## Requirements

1. Give `dependencyReview.ts` multi-line types, a named value for each repeated lookup, and one
   helper that records a truncation once. Keep every limit and every message.
2. Split `PlanRow` into a type per pipeline stage, or into a base row plus named extensions for
   summary, dataset, and source tracing. Let each stage's function take and return its own type.
3. Move the inline plan edits in `inspectors.tsx` into named functions beside the plan model.
4. Expand the one-line methods in `service.ts`.
5. Change no behavior. Each module's tests must pass unchanged, except where a test named a type
   that moved.

## Acceptance

- None of the five modules has a line over the formatter's width.
- `PlanRow` no longer exists, or carries only the fields every stage has.
- `pnpm test --filter=@acorn/plugin-git`, `--filter=@acorn/dashboards-core`,
  `--filter=@acorn/client-core`, and `--filter=@acorn/node-core` pass.
