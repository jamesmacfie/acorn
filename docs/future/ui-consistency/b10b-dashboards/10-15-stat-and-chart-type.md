# 10-15. Stat and chart typography

**Status:** not started. Batch B10b. Written 2026-10-01. Line numbers are from 2026-10-01 and may
have moved.

A stat tile is a regular-weight 18-pixel number over the word "rows": the panel's one fact is its
quietest part. Chart tick labels are 7 user units in a viewBox, so they scale with the panel: about 14.5
pixels in a half-width chart, larger than the panel title, and about 29 at full width. A status with no
declared tone draws in a saturated blue that is not the theme's accent. A list lands 4 by 4 cells for
four rows; a board with one column spans 12 cells.

## Where to see it

Home with a stat, a chart, a board, a list, and a table panel (add them, and delete them after).

## The fix

- `packages/client-core/src/features/dashboards/dashboards.css:645-658`: the stat value at `--fs-xl` and
  `--heading-weight`.
- `views/StatView.tsx:45-48`: the label is the source's plural, threaded to `PanelViewProps`.
- `packages/dashboards-core/src/chart.ts:38-58` and `views/ChartView.tsx:95-106`: tick labels
  counter-scaled from the measured render scale, so they draw at `--fs-2xs`.
- An undeclared single series uses `--accent`.
- `dashboards.css:377-414, 552-574`: board columns `minmax(200px, 320px)`, with the count beside the
  label.
- `packages/dashboards-core/src/layout.ts:31-39`: default sizes that fit their content.

## Copy

| Where | Current text | Decision | New text |
| --- | --- | --- | --- |
| `views/StatView.tsx:46` | row / rows | Rewrite | The source's plural in lower case ("tasks", "issues"); "items" if it has none |
| `StatView.tsx:22` | Total · / Average · / Lowest · / Highest · {field} | Keep | |
| `StatView.tsx:114` | Collecting — hourly, from now on. | Rewrite | Recording once an hour from today. |
| `views/ListView.tsx:27`, `TableView.tsx:21` | Nothing to show. | Keep | The views do not know about filters (the plan's overrule on rows 693 and 695). |
| `views/ChartView.tsx:45-46` | Nothing to chart / This source has no field with a fixed set of values and no date to plot against. | Rewrite | Title "Can't chart this source". Body "It has no status, category, or date field to chart by." |
| `ChartView.tsx:50` | No rows. | Rewrite | Nothing to show. |
| `views/BoardView.tsx:39` | Nothing to group by / This source declares no field with a fixed set of values. | Rewrite | Title "Can't make a board from this source". Body "It has no status or category field to make columns from." |

## Risk and checks

- Before you start, confirm the descriptor carries a `plural` for each source.
- The tick counter-scale needs a measured render scale. Keep the measure out of the virtual-list paths.
- CSS hygiene: `200px` and `320px` are new literal lengths; check the off-scale spacing budget, or use
  tokens.
- Screens: five panels at the default window size and at a narrow one.
- Tests: the client-core dashboards tests and `packages/dashboards-core`.
