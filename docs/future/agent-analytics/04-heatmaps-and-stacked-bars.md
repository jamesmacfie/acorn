# Phase 4: add heatmaps, stacked bars, and hour and weekday buckets

Date: October 19, 2026. Status: proposed. Needs nothing. [Phase 1](./01-dynamic-ui-fit.md) confirms
the views reach panel cards and apps.

## Goal

Dashboards gain three things: a `heatmap` view, bars stacked by series, and `hour` and `weekday`
buckets for a datetime column. Every place that draws a panel gets them: Home, plugin regions, panel
cards, and an app's `Panel`. The studio's AI and `panel_guide` learn them from the same capability
list, so an agent can draft "when do my agents work" without a code change elsewhere.

[Views and trends](../../dashboards/views.md) says pie,
gauge, scatter, and area wait for a panel that needs one. The panels in this programme are that need
for these three, and nothing else is added.

## Starting point

- `dashboardViewSchema` in `packages/protocol/src/dashboards/dashboardViews.ts` holds every view's
  options: `kind`, `aggregate`, `field`, `shape` (`bar` or `line`), `x`, `series`, and the trend
  options. The manifest parser reads it too, so a plugin region can name a view kind.
- A plan's group and summarize `bucket` is `value`, `day`, `week`, or `month`, declared twice in
  `packages/protocol/src/dashboards/panels.ts`. `bucketValue` and `bucketBounds` in
  `packages/dashboards-core/src/planBuckets.ts` compute a bucket and the time range behind it, which
  drill-down uses.
- `packages/dashboards-core/src/chart.ts` shapes a chart's marks, and
  `packages/client-core/src/features/dashboards/views/ChartView.tsx` draws them. Series take three
  ordinal slots, `--viz-series-1..3`, and fold the rest into **Other**.
- `packages/dashboards-core/src/capabilities.ts` lists views, measures, and buckets for authoring,
  and the panel guide reads it.
- **View as** in a panel's menu switches between the views a plan allows, including **Table**.

## The design

### Hour and weekday buckets

Add `hour` and `weekday` to both bucket enums and to `capabilities.ts`. `bucketValue` computes them
in the plan's time zone:

- `hour` is `00` to `23`.
- `weekday` is `mon` to `sun`, ordered from the plan's `weekStart`.

Unlike day, week, and month, these values repeat, so a bucket is not one range of time. A chart or
heatmap draws every value of the bucket in order, including empty ones, so a quiet Sunday shows as
empty instead of missing. Drill-down from a cell of these buckets shows the cell's value and offers no
**Show rows**. `bucketBounds` returns nothing for them, as it does for `value`.

### Heatmap

Add `heatmap` to `dashboardViewKinds`, and `y` to `dashboardViewSchema` beside `x`. A heatmap is a
grid of cells:

- `x` and `y` name its two axes. Each is an enum, a person, or a datetime the plan buckets. "When
  agents work" is `y: weekday` and `x: hour` over `startedAt`. A calendar is `y: weekday` and `x: week`.
- `aggregate` and `field` give each cell's value, as a chart's height does. Count is the default.
- A cell's shade comes from five steps of a sequential scale, `--viz-scale-1..5`, from the lowest
  nonzero value to the highest. Zero draws the empty step. A legend shows the low and high values in
  the plan's units.

Declare the scale in the token axes beside `--viz-series-*`, for light and dark, and keep it apart
from status colors, as the series slots are.

`viewsForSchema` offers `heatmap` only when the plan has two axes of those kinds. The editor offers no
other way to make one.

Shape the cells in `heatmap.ts` beside `chart.ts`, as pure arithmetic with tests, and draw them in
`HeatmapView.tsx` beside `ChartView.tsx`.

Keyboard and screen readers:

- The grid is one tab stop. Arrow keys move between cells, and Home and End jump along a row.
- Each cell's name reads its axes and value, such as "Tuesday, 14:00: 3 hours 20 minutes".
- **View as** **Table** shows the same numbers as rows, which is the alternative for anyone who
  can't read shades.

At narrow widths, the grid scrolls sideways inside its panel, and the row labels stay in place.

For the terminal, when panels draw there: each cell is one character from ` ░▒▓█`, one row per `y`
value, labels on the left, and the legend below. A 24-hour row fits in 80 columns with its label.

### Stacked bars

Add `stacked` to `dashboardViewSchema`, valid only on a `bar` with `series`. Stacked bars draw each
category's series on top of each other instead of side by side, so the bar's height is the total. The
legend and the fold into **Other** behave as they do for clustered bars. **View as** offers the
switch between clustered and stacked where `series` is set.

A bar's categories can be a day bucket from a summarize stage, which "Spend by day, stacked by model"
needs. Check that the gate allows a bucketed datetime as a bar's axis when the plan summarizes by it.
If it doesn't, allow it there.

### Teach the authors

- Add `heatmap`, `stacked`, `hour`, and `weekday` to `capabilities.ts`, and a label for each to
  `VIEW_LABELS` in `packages/dashboards-core/src/labels.ts`.
- Make `outline.ts` describe them in words, such as "Hours by weekday and hour of day", because panel
  cards show the outline above the view.
- Add one line to the panel guide's advice on choosing a view: use a heatmap for "when" questions
  across two repeating time axes.

### Starters

Add two starters to **Agent turns** from [phase 3](./03-agent-sources.md#starter-plans):

| Starter | View |
| --- | --- |
| When agents work, last four weeks | Heatmap, `y` weekday and `x` hour of `startedAt`, sum of `activeMs` |
| Spend by day by model, last 30 days | Bar stacked by `model`, summarized by `completedAt` day, sum of `costUsd` |

## Steps

1. Add the buckets, with tests for each zone and week start, including the change to and from
   daylight saving time.
2. Add `heatmap.ts` and its tests: empty cells, a single value, the five steps, and the axis order.
3. Add `HeatmapView.tsx`, the scale tokens, the keyboard, and the narrow scroll.
4. Add `stacked` to the chart shaping and `ChartView.tsx`.
5. Teach the authors, and add the starters.
6. Update [views and trends](../../dashboards/views.md) for the three additions.

## Acceptance

- In `pnpm dev:agent`, "When agents work" draws on Home, in a panel card, and in an app's `Panel`, in
  light and dark.
- `panel_show` with "a heatmap of when my agents work" produces a valid heatmap plan with no edits.
- Every cell is reachable with the keyboard, and **View as** **Table** shows the same totals.
- A client from before this phase draws a heatmap panel as inert, as the views doc says it does for an
  unknown view kind, and doesn't lose the panel.
