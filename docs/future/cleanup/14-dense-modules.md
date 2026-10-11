# 14: Dense modules

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
