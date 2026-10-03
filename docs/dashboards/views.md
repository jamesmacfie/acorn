# Views and trends

A panel draws as a stat, list, table, board, or chart. This page covers which views a schema allows,
how boards and charts draw, and the trend a stat can carry. The arithmetic is pure in
`packages/dashboards-core/src/` (`model.ts`, `shaping.ts`, `chart.ts`, `trend.ts`), and the
components in `packages/client-core/src/features/dashboards/views/` draw its output.

## Views are derived, not chosen from a menu

A kanban isn't a component. It's group-by over a field with finite values. Each view's gate is one
predicate over the schema (`viewsForSchema`):

- `stat`, `list`, and `table` ask nothing of the schema.
- `board` needs an `enum` field.
- `chart` needs an axis: an `enum` for a bar's categories or a `datetime` for a line's time axis.

The editor offers only what passes, so a panel that can't draw is unrepresentable rather than
validated. A view kind this build doesn't know survives in the definition and renders inert.

A board's columns are the declared enum values in declared order, and a declared column draws even
when it's empty, because that's where you'd drop the card back. An undeclared value gets a muted column
after the declared ones, and a row with no value goes to one "Uncategorised" column that exists only
when something is in it. Every row lands somewhere.

**Charts are two shapes and no dependency.** A `bar` takes its categories from an enum, with the
board's bucketing, and its height from the same measure a stat draws. A `line` takes its x from a
`datetime` bucketed by day. Either can be split into series by an enum through `view.series`: one line
per value, or a cluster of bars per category. The split is offered only where it's representable.

A value may name an `icon`, which a cell draws in place of the dot, in the value's tone. An unknown
name falls back to the dot. Charts keep the tone and ignore the icon.

Every mark carries an attribute, not a color. A value with a declared tone carries `data-tone`. Any
other mark is identity and carries `data-series`, an ordinal slot colored by `--viz-series-1..3`,
which are deliberately not status colors. Status color on identity would make the second series
permanently "warn". There are three slots, and series four onward fold into a muted `other`. A legend
draws only for two or more series, with the fold disclosed as "Other (3)". The single unsplit line uses
`--accent`. Pie, gauge, scatter, and area aren't there, and wait for a panel that needs one.

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
