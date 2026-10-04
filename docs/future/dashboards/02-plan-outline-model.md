# Phase 2: the plan outline model

Status: shipped, October 5, 2026, in commit `69ebfb26a`. [What shipped](#what-shipped) records the
choices made while building it and what it left for later phases. Depends on nothing, and can run
beside [phase 1](./01-quick-wins.md). Read the [programme README](./README.md) first. The
[Panel Editor Review](https://claude.ai/artifact/EA1H3DdvVEUd9WTNg5MWyf) shows the outline this
phase feeds, in the "The studio" mockup.

## Goal

Build the pure functions the studio draws from: a plan split into named parts in plain words, a
key for each part, a way to map a problem or a row count onto its part, the operations a plan can
take next, and a diff between two plans at the part level. All of it lives in
`packages/dashboards-core`, so the client, the Node, and tests share one source of truth. This
phase draws no UI.

## Why it's a separate phase

The studio's outline, its inspector selection, its problem markers, and the AI review in
[phase 6](./06-docked-ai.md) all need the same answer to "which part of the plan is this?" Today
nothing answers it:

- `describePanelPlan()` in `packages/dashboards-core/src/plan.ts` returns one flat `string[]`. You
  can't tell which line belongs to which part, and some parts produce no line at all, such as the
  view or the refresh interval.
- Run problems carry JSON pointers such as `/sources/0` or `/columns/3/bind/abc` (`PlanProblem` in
  `plan.ts`). Stage counts carry `/stages/<index>` (`PlanStageCount`). Each consumer would parse
  these on its own.
- The editor decides which stages can be added with inline conditions in
  `DashboardEditor.tsx` (the `disabled` expression on the **Add stage** buttons). The rules aren't
  testable and give no reason.
- The AI proposal diff from `semanticAuthoringDiff()` in `packages/protocol/src/data/authoring.ts`
  aligns arrays by `id` or `name`. Stages have neither, so any stage change shows as one change to
  the whole `/stages` array. It can't say "step 2 was added."

## Requirements

### Parts

1. Add `outline.ts` in `packages/dashboards-core/src` with a `PlanPart` type and
   `planOutline(plan, sources?)`:

   ```ts
   type PlanPartKey =
     | `source:${string}`      // by PlanSource id
     | 'relations'
     | 'columns'
     | `column:${string}`      // by column id
     | `stage:${number}`       // by index
     | 'arrange'               // sort, group, limit
     | 'look'                  // view kind and options
     | 'behaviour'             // press action and buttons
     | 'settings'              // refresh and time policy

   type PlanPart = {
     key: PlanPartKey
     section: 'data' | 'columns' | 'steps' | 'arrange' | 'look' | 'settings'
     title: string             // "Keep where Author is you"
     detail?: string           // "Everything this account can see"
     icon: string              // a Lucide name, resolved client-side like other glyphs
     paths: string[]           // JSON pointers this part owns, such as ['/stages/0']
   }
   ```

   Add `"./outline.ts": "./src/outline.ts"` to the `exports` map in
   `packages/dashboards-core/package.json`. A deep import that isn't in the map fails `tsc`.
2. `planOutline` returns parts in this order: each source, relations (only when the plan has more
   than one source or any relation), columns, each stage, arrange, look, behaviour, settings.
   Column parts (`column:<id>`) aren't in the top-level list. The columns inspector asks for them
   with `columnParts(plan)`.
3. Write titles in the editor's words, not the schema's. Use the label map from phase 1
   (`labels.ts` in `packages/dashboards-core/src`), so the Node's describer and the outline say the
   same thing. If phase 1 hasn't landed, create that file here. Examples:

   | Part | Title | Detail |
   | --- | --- | --- |
   | Source | Pull requests · GitHub (Work) | Everything this account can see |
   | Columns | Title, Repository, CI, Approval, Updated | 5 columns |
   | Filter stage | Keep where Author is you | |
   | Compute stage | Calculate Age in days | |
   | Summarize stage | One row per Repository | Count, Oldest |
   | Arrange | Newest update first | Grouped by Repository · at most 50 rows |
   | Look | Table | |
   | Behaviour | Click opens the pull request | In the side panel · 2 buttons |
   | Settings | Refresh every 5 minutes | Pacific/Auckland · week starts Monday |

4. Move the predicate, reach, and press-target wording out of `describePanelPlan` into shared
   helpers in `outline.ts`. Rebuild `describePanelPlan` on those helpers so the run's
   `description` and the outline can't drift. Keep `describePanelPlan`'s output lines in the same
   order. Change the wording only where a line used a schema value, such as `eq` or `P7D`.
5. The source title uses the account label when `sources` carries one (`PlanSource.accountLabel`).
   On the client, before the first run, pass no `sources`, and the title falls back to the source
   label.

### Mapping onto parts

6. `partForPath(plan, path)` returns the key of the part that owns a JSON pointer, or `undefined`.
   It matches the longest prefix in each part's `paths`. Examples: `/sources/0` → `source:<id of
   sources[0]>`; `/columns/3/bind/x` → `column:<id of columns[3]>`; `/stages/1/where` → `stage:1`;
   `/view/x` → `look`; `/sort/0` → `arrange`.
7. `problemsByPart(plan, problems)` groups `PlanProblem`s by part key. Problems with no part go
   under a `plan` key, and the status bar shows them.
8. `countsByPart(plan, stages)` maps `PlanStageCount`s to `stage:<index>` keys. It also returns the
   input count of the first stage as the source total when there is one source, for the source
   part's count.

### What can be added

9. `availableOperations(plan)` returns one entry per `PANEL_CAPABILITIES.operations` item:
   `{ id, label, description, available: boolean, reason?: string }`. Move the rules from the
   editor's **Add stage** buttons into this function and give each a reason:
   - No columns: "Add a column first."
   - Eight stages already: "A panel has at most eight steps."
   - Three summaries already: "A panel has at most three summaries."
   - Overlap with fewer than two date columns: "Needs two date columns."
   - Overlap already present: "A panel has one overlap step."
   - Expand with no list column: "Needs a column that holds a list."
10. `availableViews(plan)` returns one entry per `PANEL_CAPABILITIES.views` key with `available`
    and `reason`, read from each view's `needs` list. For example, a board needs an enum group:
    "Group by a Choice column first."

### Diff between two plans

11. `diffOutline(before, after)` compares `planOutline(before)` with `planOutline(after)` and
    returns, for each key in either, `'added' | 'removed' | 'changed' | 'same'`. Two parts with the
    same key are `changed` when their title, detail, or the JSON at their paths differ.
12. Stages have no ids, so match them in two passes. First match stages whose JSON is identical
    regardless of position. Then match the remaining stages pairwise in order when their `op` is
    the same, and mark them `changed`. Anything left over is `added` or `removed`. Return the stage
    keys of the *after* plan, plus the removed stages with their *before* index under a
    `removed` list, so the UI can show a struck-through row.
13. `diffOutline` also returns `columnChanges`: column ids added, removed, and changed, for the
    columns row's detail ("+ Approval, − Draft").

## Out of scope

- Any UI. Phases 3, 4, and 6 consume these functions.
- Adding ids to stages. That would change the persisted plan and the published digests. The
  two-pass match in requirement 12 is good enough for review.

## Tests

Add `outline.test.ts` beside `outline.ts`:

- `planOutline` over the fixture plans in the existing `plan.test.ts`, checking order, titles, and
  sections.
- `partForPath` for each pointer shape in requirement 6, plus an unknown path.
- `availableOperations` for every reason in requirement 9.
- `diffOutline`: an added filter at the end, an added filter in the middle (later stages keep
  `same`), a changed operator, a removed stage, and a column swap.
- A snapshot of `describePanelPlan` before and after the refactor for the same fixtures, so
  requirement 4 changes only the lines it means to.

Run `pnpm test:focus @acorn/dashboards-core src/outline.test.ts` while you work, then
`pnpm test --filter=@acorn/dashboards-core` and `pnpm test --filter=@acorn/node-core` before
handoff, because the Node's run uses the describer.

## Docs to update

- `docs/dashboards/mapping-and-editor.md`: one paragraph naming `outline.ts` as the owner of the
  plan's plain-language parts. Keep the heading "The generated editor": the source comment in
  `packages/client-core/src/features/dashboards/layout.ts` cites it.

## Verify before building

- `describePanelPlan` has three callers: `DashboardEditor.tsx` and two in
  `packages/node-core/src/server/dashboards/run.ts`.
- No test or evaluation fixture asserts the exact describer wording. If one does, update it
  deliberately in the same change.
- `PlanProblem.path` values the validator emits. Read `validatePanelPlan` in `plan.ts` for every
  `path:` it writes, so `partForPath` covers them.

## What shipped

All 13 requirements shipped, with the tests listed above. This phase draws no new screens, so it
wasn't checked in a `dev:agent` session. `docs/dashboards/mapping-and-editor.md` § The generated
editor describes the shipped behaviour and wins over this page.

Where the code lives:

- `packages/dashboards-core/src/outline.ts` holds `planOutline`, `columnParts`, `partForPath`,
  `problemsByPart`, `countsByPart`, `availableOperations`, `availableViews`, and `diffOutline`. It
  also exports the wording helpers the describer reads: `columnLabel`, `describePredicate`,
  `sourceReach`, and `pressTarget`.
- `labels.ts` gains `offsetLabel`, `calendarLabel`, `PRESENTATION_LABELS`, and
  `sortDirectionLabel`. `offsetLabel` reads any stored offset, not only the presets.
- `pointerColumn` moved from `plan.ts` to `planColumns.ts`, so `plan.ts` and `outline.ts` share it.
  `outline.ts` imports only types from `plan.ts`, so the two files don't form a runtime cycle.
- `outline.test.ts` keeps an inline snapshot of `describePanelPlan` for two fixture plans. It was
  recorded before the refactor, so the commit's diff shows each line that changed.
- Adding `outline.ts` to the `exports` map raised the entrypoint count for `@acorn/dashboards-core`
  in `tools/arch/boundaries.test.ts` from 15 to 16. The "core never names a plugin" exception moved
  from `plan.ts` to `outline.ts`, because the filter code that names the `context` address moved
  there, and the source part's icon is `database`.
- The outline's Lucide names are in `packages/client-core/src/kit/tokens/iconNodes.eager.json`.
  Rerun `pnpm --filter @acorn/client-core icons` after changing one.

Choices made while building it:

- Outline titles don't reuse `planPartLabel` from phase 1. That function names a part for a problem
  line, such as "Step 2". The outline titles a part by what it does, such as "Keep where Author is
  you". `planPartLabel` stays for the editor until phase 3 deletes it.
- **Behaviour** sits in the `look` section, because the section list has no slot of its own for it.
- **Settings** owns `/title`, `/time`, and `/refresh`. Problems at the bare `/sources` and `/stages`
  paths, and at `/requirements` or `/request`, belong to no part and go under `plan`.
- `countsByPart` returns `{ stages, sourceTotal }`. `sourceTotal` is the input count at `/stages/0`
  and is set only when the plan has one source.
- `availableOperations` checks in a fixed order, so a plan with no columns always reads "Add a
  column first." An existing overlap step is reported before a missing date column.
- `availableViews` reads each view's `needs` through a table keyed by the need string. A new need in
  `capabilities.ts` fails `tsc` until the table has a row for it.
- `diffOutline` compares JSON with sorted object keys, so a plan the AI built in a different key
  order still compares equal. A non-step part is `changed` when its title, detail, or JSON at its
  paths differs. Changing a column's label marks the steps that name it as `same`, because step
  matching reads only step JSON.
- The describer changed only lines that printed schema values. Operators read as words ("is",
  "is one of", "is after"), offsets read as "7 days ago", choice ids read as choice labels, and
  column and source ids read as labels. The sort line and the relation line keep their old shape.
- The editor's **Add step** buttons use `availableOperations`, and a disabled button's tooltip gives
  the reason.

Fixed along the way:

- Phase 1's "1 day from now" and "7 days from now" offset presets were stored as `P1D` and `P7D`.
  The schema requires a sign, so picking either broke the plan. They're `+P1D` and `+P7D`, and
  `labels.test.ts` checks every preset reads back through `offsetLabel`.

Left for later phases:

- `operatorLabel` words only `lt` and `gt` differently on a date column, so a date filter reads
  "Closed is at least the start of the week". Phase 4's inspectors may want "on or after".
- Nothing draws the outline yet. [Phase 3](./03-studio-shell.md) draws it, and
  [phase 6](./06-docked-ai.md) draws `diffOutline`.
