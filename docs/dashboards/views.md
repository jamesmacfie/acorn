# Views and trends

A panel draws as a stat, list, table, board, chart, or heatmap. This page covers which views a schema
allows, how boards, charts, and heatmaps draw, and the trend a stat can carry. The arithmetic is pure in
`packages/dashboards-core/src/` (`model.ts`, `shaping.ts`, `chart.ts`, `heatmap.ts`, `trend.ts`), and the
components in `packages/client-core/src/features/dashboards/views/` draw its output.

## Views are derived, not chosen from a menu

A kanban isn't a component. It's group-by over a field with finite values. Each view's gate is one
predicate over the schema (`viewsForSchema`):

- `stat`, `list`, and `table` ask nothing of the schema.
- `board` needs an `enum` field.
- `chart` needs an axis: an `enum` or `person` for a bar's categories, or a `datetime` for a line's
  time axis. A `text` column is a bar's axis only when the plan summarizes by it, which bounds its
  values to the summary's groups. A `datetime` is a bar's axis when the plan summarizes it by day,
  week, or month. A line counts rows by day itself, so it can't chart a summary bucketed by time.
- `heatmap` needs two axes, each an `enum`, a `person`, or a `datetime` the plan buckets. The plan's
  view lists it only then (`availableViews`).

The editor offers only what passes, so a panel that can't draw is unrepresentable rather than
validated. A view kind this build doesn't know survives in the definition and renders inert.

A board's columns are the declared enum values in declared order, and a declared column draws even
when it's empty, because that's where you'd drop the card back. An undeclared value gets a muted column
after the declared ones, and a row with no value goes to one "Uncategorised" column that exists only
when something is in it. Every row lands somewhere.

A plan column marked `hidden` stays in the run, so sort, group, filter, a board, and a chart can still
use it, but a table and a list leave it out. A list still leads with a hidden title, because a row
needs a label. In the studio, a column's menu offers **Hide** or **Show**, and the Columns form
lists hidden columns under their own **Hidden** heading, which appears only when one is hidden. The
authoring AI gets the same rule and an example from `hiddenColumns` in
`packages/dashboards-core/src/capabilities.ts`.

**Charts are two shapes and no dependency.** A `bar` takes its categories from an enum, with the
board's bucketing, and its height from the same measure a stat draws. A `line` takes its x from a
`datetime` bucketed by day. Either can be split into series by an enum through `view.series`: one line
per value, or a cluster of bars per category. A text column the plan summarizes by can split too. The
split is offered only where it's representable. A bar over a summary's days, weeks, or months draws
them oldest first.

`stacked: true` on a `bar` with `series` stacks each category's series instead of clustering them, so
a bar's height is the category's total and the axis grows to the largest total. The legend and the
fold into **Other** work as they do for clusters. **View as** offers **Bars side by side** and
**Stacked bars** wherever a bar has a series. The plan validator refuses `stacked` anywhere else.

A value may name an `icon`, which a cell draws in place of the dot, in the value's tone. An unknown
name falls back to the dot. Charts keep the tone and ignore the icon.

Every mark carries an attribute, not a color. A value with a declared tone carries `data-tone`. Any
other mark is identity and carries `data-series`, an ordinal slot colored by `--viz-series-1..3`,
which are deliberately not status colors. Status color on identity would make the second series
permanently "warn". There are three slots, and series four onward fold into a muted `other`. A legend
draws only for two or more series, with the fold disclosed as "Other (3)". The single unsplit line uses
`--accent`. Pie, gauge, scatter, and area aren't there, and wait for a panel that needs one.

**A heatmap is a grid of shaded cells.** `x` names the axis across and `y` the axis down. Each cell's
value is the view's measure over the rows in it, as a bar's height is, and count is the default. An
axis draws every value it declares in order, including empty ones, so a summary by `weekday` and
`hour` draws seven rows of 24 cells, and a quiet Sunday shows as empty. A summary's dates read oldest
first. "When agents work" is `y` a weekday and `x` an hour, both bound to the same start time.

A cell's shade is one of five steps of `--viz-scale-1..5`, from the lowest nonzero value to the
highest, carried as `data-step`. Zero, or an average of nothing, draws the empty step. Each step mixes
the first series hue into the card's ground at a higher strength, so it works on light and dark themes,
and is kept apart from status colors. A legend under the grid names the measure and shows the low and high values in its
units.

The grid is one tab stop. Arrow keys move between cells, and Home and End jump along a row. Each cell
names its axes and value, such as "Tuesday, 14:00: 3". **View as** **Table** shows the same numbers as
rows, for anyone who can't read shades. At narrow widths the grid scrolls sideways inside its panel,
and the row labels stay in place. The terminal client doesn't draw panels yet.

## Hour and weekday

A summary or group can bucket a `datetime` by `hour`, `00` to `23`, or by `weekday`, `mon` to `sun`,
both read in the plan's time zone. Unlike a day, week, or month, these values repeat, so a bucket isn't
one range of time. After the summary, each becomes a choice column that declares every value in order,
the week from the plan's `weekStart`, labelled such as `14:00` and `Tuesday`. That's how a chart or
heatmap draws a quiet hour as empty instead of leaving it out. A summary by one shows its values and
offers no drill-down to the rows behind them, and can't fill gaps or show previous-bucket changes.

## Trends

A `stat` can carry a trend, a 14-day sparkline under the number (`TREND_DAYS`). The two tiers are
different features sharing one mark:

| Tier | Answers | Source |
| --- | --- | --- |
| `activity` | When did these rows change | The rows on screen, bucketed by their `updated`-role datetime |
| `history` | What was this number | The Node's measure store, sampled hourly ([sampling](./sampling.md)) |

An activity day with no rows is a zero, because nothing changed. A history day with no sample is a
gap, drawn as a break in the line, because nobody looked. An empty history series is a cold state,
"Recording once an hour from today.", not an error, so the read route `GET /v1/core/dashboards/history`
answers 200 with an empty list. The editor offers `activity` only when the schema has a datetime.

`compare` draws a delta beside the number against `day` or `week`. The baseline is a sample looked
up, the latest one at least that old, searched no further back than twice the window. It's never a
window average, which would bring bucket alignment and timezone edges into it. No qualifying sample
means no delta at all.

`good`, `up` or `down`, colors that delta, because which direction is good isn't guessable: more open
pull requests is bad on one board and good on another. With no `good`, the delta draws in neutral ink.
It's display config on the panel, unlike units and tones, which are the plugin's facts.
