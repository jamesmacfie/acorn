import type {
  PluginCollectionField,
  PluginCollectionRow,
  PluginCollectionSchema,
} from '@acorn/protocol/collections.ts'
import { cellText, formatCell } from './format'
import type { PanelShaping, PanelTone, PanelView } from './model'
import { aggregateRows, boardColumns, groupField } from './shaping'

// THE CHART VIEW's arithmetic (docs/dashboards.md § Views): buckets, aggregates, scales, ticks and
// path data. Pure and tested, because `ChartView.tsx` cannot be — vitest here runs in node with no
// Solid plugin — so the component is a thin `<svg>` over what this answers and decides nothing.
//
// A VIEW KIND, NOT A CONTRACT CHANGE. Nothing crosses the wire that does not already: `number` and
// `datetime` were in the field vocabulary from the start and group-by was already shaping. If
// drawing a chart ever appears to need a new field type or a new response shape, that is the
// field-type fight (docs/future/dashboards/refused.md § No new field type without a fight), not a
// chart requirement.
//
// TWO SHAPES ONLY, and that is a budget rather than a starting point:
//
//   BAR    category axis from an enum field (or the shaping group-by), value from a number
//          aggregate over the filtered rows.
//   LINE   x from a datetime bucketed by day, y from a number aggregate or a count, optional series
//          split from an enum.
//
// Pie, gauge, scatter, area: no, until someone arrives with the panel that needs one.
//
// HAND-ROLLED SVG, NO CHARTING DEPENDENCY. Two shapes, no zoom, no brush. Colour never comes from
// here as a literal: a mark carries a `tone` from the host's own five-value status vocabulary — the
// same one a plugin's declared enum value can name and an appearance pack already owns
// (ui/primitives.tsx § StatusDot). A plugin never names a colour, same rule as everywhere.

// ── Identity colour, and why it is not a tone ─────────────────────────────────────────────────
//
// This used to cycle the five STATUS tones for anything the schema had not pre-toned
// (`accent/ok/warn/bad/muted`). That is right for status — a `Ready` bar should be the ok colour —
// and wrong for identity: a line split by source, or a bar over categories nobody declared, is asking
// "which series is this", and answering with status colours makes github permanently ok-green and
// linear permanently warn-amber, which reads as a judgement nobody made
// (docs/future/dashboards/charts.md § 1).
//
// So a mark's colour comes from exactly one of two places:
//
//   `tone`    the plugin DECLARED what this value means. Keep it — the status vocabulary is doing its
//             job, and the appearance pack already owns those five colours.
//   `series`  identity with no declared meaning. An ordinal slot, coloured by `--viz-series-1..3` —
//             theme-axis tokens distinct from the status tones (ui/tokenAxes.ts).
//
// THREE SLOTS, HARD CAP. Slot 4 onwards folds into `other`, drawn muted and disclosed in the legend
// when that lands. Three is what survives colour-vision checking as a set alongside the five status
// tones; past three the honest answer is fewer series or a table, not a fourth colour.
//
// Still no literal colour here or in `ChartView.tsx`: a mark carries `data-series` beside `data-tone`
// and `dashboards.css` maps both.

/** `1 | 2 | 3` are the identity slots; `other` is the fold. */
export type ChartSeriesSlot = 1 | 2 | 3 | 'other'

const SERIES_SLOTS = 3

const seriesSlot = (index: number): ChartSeriesSlot =>
  index < SERIES_SLOTS ? ((index + 1) as ChartSeriesSlot) : 'other'

/** Abstract units. The SVG scales uniformly to whatever rect the panel has, so nothing here needs a
 *  measurement and the chart survives a panel resize without recomputing.
 *
 *  The accepted ceiling: a very wide or very tall panel letterboxes its chart rather than stretching
 *  it, because stretching would distort the type with it. The upgrade path — if it ever matters — is
 *  the grid's own `ResizeObserver`, which already knows the panel's cell size. */
export const CHART_BOX = { width: 320, height: 180 } as const
const PAD = { top: 8, right: 8, bottom: 22, left: 36 } as const
const PLOT_W = CHART_BOX.width - PAD.left - PAD.right
const PLOT_H = CHART_BOX.height - PAD.top - PAD.bottom

export type ChartShape = 'bar' | 'line'

export type ChartTick = { label: string; at: number }

export type ChartBar = {
  key: string
  /** The CATEGORY this bar stands in — the x axis names it, so several bars of one cluster share it. */
  label: string
  value: number
  /** Everything this bar is, in words: its category, its series where there is one, and its measure
   *  in the field's own units. The mark's `<title>`, composed here because the view decides nothing. */
  title: string
  /** Set when the plugin declared what this value means. Mutually exclusive with `series`. */
  tone?: PanelTone
  /** Set when the mark is identity with no declared tone. Mutually exclusive with `tone`. */
  series?: ChartSeriesSlot
  x: number
  y: number
  w: number
  h: number
}

export type ChartLine = {
  id: string
  label: string
  /** Set when the plugin declared what this series means, and for the single unsplit line — one mark
   *  with no sibling to be told apart from has no use for an identity colour, which is the same
   *  argument that put the sparkline on `--accent` (charts.md § 5). */
  tone?: PanelTone
  /** Set when the series is identity with no declared tone. Mutually exclusive with `tone`. */
  series?: ChartSeriesSlot
  /** An SVG `d`. Empty for a series with fewer than two points, which draws as dots instead. */
  path: string
  points: { x: number; y: number; label: string }[]
}

/** One key of the legend, in the mark's own colour attribute — the same `tone`/`series` pair a mark
 *  carries, so the swatch and the mark cannot drift apart. */
export type ChartLegendKey = {
  id: string
  label: string
  tone?: PanelTone
  series?: ChartSeriesSlot
}

/** Both shapes carry these. `legend` is present only when TWO OR MORE series draw: one series has no
 *  sibling to be told apart from and the panel title already names it, so a one-swatch legend is
 *  furniture.
 *
 *  Where it IS present it is not optional polish. The slot-2 ↔ slot-3 pair of the identity ramp sits
 *  in the colour-vision-deficiency warn band, which is legal only with a secondary encoding, and this
 *  is it (charts.md § 1). An ungrouped bar draws one series and its categories are told apart by the
 *  x axis labels rather than by colour, which is why it has none. */
type ChartCommon = { xTicks: ChartTick[]; yTicks: ChartTick[]; xLabel: string; yLabel: string; legend?: ChartLegendKey[] }

export type ChartPlot =
  | ({ shape: 'bar'; bars: ChartBar[] } & ChartCommon)
  | ({ shape: 'line'; lines: ChartLine[] } & ChartCommon)

// ── What a schema can draw ────────────────────────────────────────────────────────────────────
//
// The shipped gating pattern, one level down: the editor offers only shapes the schema supports, so
// a misconfigured chart is unrepresentable rather than validated.

const enumFields = (schema: PluginCollectionSchema) => schema.fields.filter((field) => field.type === 'enum')
const datetimeFields = (schema: PluginCollectionSchema) => schema.fields.filter((field) => field.type === 'datetime')
const numberFields = (schema: PluginCollectionSchema) => schema.fields.filter((field) => field.type === 'number')

/** A bar needs a category axis; a line needs a time axis. A schema with neither has nothing to draw
 *  against, however many numbers it carries. */
export function chartShapesFor(schema: PluginCollectionSchema): ChartShape[] {
  return [
    ...(enumFields(schema).length ? (['bar'] as const) : []),
    ...(datetimeFields(schema).length ? (['line'] as const) : []),
  ]
}

export const chartSupportedBy = (schema: PluginCollectionSchema): boolean => chartShapesFor(schema).length > 0

/** The axis fields a shape may be pointed at. */
export const chartAxisFields = (schema: PluginCollectionSchema, shape: ChartShape): PluginCollectionField[] =>
  shape === 'bar' ? enumFields(schema) : datetimeFields(schema)

/** The enums a shape may be SPLIT INTO SERIES by — one line per value, or one bar per value inside
 *  each category's cluster (charts.md § 3).
 *
 *  A line's axis is a datetime, so every enum is a candidate. A bar's axis is already an enum, so the
 *  candidates are every OTHER one: splitting a bar by the field it is keyed by draws one bar per
 *  cluster, which is the ungrouped chart with extra arithmetic. That makes the grouped bar
 *  unrepresentable over a single-enum schema — the editor offers nothing rather than validating a
 *  choice afterwards, which is the gating rule everywhere else in this file. */
export const chartSeriesFields = (
  schema: PluginCollectionSchema,
  shape: ChartShape,
  view: PanelView,
  shaping: PanelShaping,
): PluginCollectionField[] => {
  if (shape === 'line') return enumFields(schema)
  const category = barCategoryField(schema, view, shaping)
  return enumFields(schema).filter((field) => field.id !== category?.id)
}

/** The axis to pre-pick for a shape: the `updated`-role datetime for a line, the field the panel
 *  already groups by (then the `status`-role enum) for a bar. That is what the role vocabulary is
 *  for, cashed one more time. */
export function defaultChartAxis(
  schema: PluginCollectionSchema,
  shape: ChartShape,
  shaping: PanelShaping,
): string | undefined {
  if (shape === 'line') {
    return (datetimeFields(schema).find((field) => field.role === 'updated') ?? datetimeFields(schema)[0])?.id
  }
  const grouped = enumFields(schema).find((field) => field.id === shaping.groupBy)
  return (grouped ?? enumFields(schema).find((field) => field.role === 'status') ?? enumFields(schema)[0])?.id
}

/** Type-inferred defaults, the Observable Plot lesson: a person should get a sensible chart in two
 *  clicks and then adjust, rather than face four empty selects.
 *
 *  Nothing here is written silently over an answer the person already gave — the editor calls it when
 *  the view BECOMES a chart, and the selects then show exactly what it decided. */
export function defaultChartView(schema: PluginCollectionSchema, shaping: PanelShaping): Partial<PanelView> {
  // Time first where there is a time axis: a chart of a datetime collection is almost always "over
  // time", and a bar of categories is the fallback rather than the headline.
  const shape: ChartShape = chartShapesFor(schema).includes('line') ? 'line' : 'bar'
  const number = numberFields(schema)[0]
  const grouped = enumFields(schema).find((field) => field.id === shaping.groupBy)
  const x = defaultChartAxis(schema, shape, shaping)

  return {
    shape,
    ...(x ? { x } : {}),
    // A count is the aggregate that always works; a number field is the more interesting answer when
    // there is one.
    ...(number ? { aggregate: 'sum' as const, field: number.id } : { aggregate: 'count' as const }),
    // Only where the grouping is already a decision the person made — a series split nobody asked
    // for turns one readable line into five.
    ...(shape === 'line' && grouped ? { series: grouped.id } : {}),
  }
}

// ── Scales and ticks ──────────────────────────────────────────────────────────────────────────

/** A step from the 1/2/5 × 10ⁿ ladder — the tick spacing people read without doing arithmetic.
 *  Rounded DOWN the ladder rather than to the nearest rung: a slightly denser axis is easier to read
 *  a value off than a sparse one, and the alternative rounds a max of 10 up to two ticks. */
function niceStep(range: number, count: number): number {
  if (!(range > 0) || !Number.isFinite(range)) return 1
  const raw = range / Math.max(1, count)
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const normalized = raw / magnitude
  return (normalized < 2 ? 1 : normalized < 5 ? 2 : normalized < 10 ? 5 : 10) * magnitude
}

/** Tick VALUES from zero to AT LEAST `max` — the last one is the axis top, so no mark can ever be
 *  drawn above the highest gridline. Zero-based because both shapes measure a quantity, and a bar
 *  chart whose axis starts at 47 is the classic way to lie with one. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0) || !Number.isFinite(max)) return [0]
  const step = niceStep(max, count)
  const out: number[] = []
  // Bounded as well as conditioned: a pathological `max` must not spin here.
  for (let value = 0; out.length < 64; value += step) {
    // Floating-point accumulation turns 0.30000000000000004 into an axis label.
    out.push(Number(value.toPrecision(12)))
    if (value >= max) break
  }
  return out
}

/** UTC midnight of a timestamp. The line shape buckets by DAY: a count has no meaning at a point in
 *  time, and one rule for every aggregate beats a per-aggregate special case. */
export const dayBucket = (at: number): number => Math.floor(at / 86_400_000) * 86_400_000

// ── Building the plot ─────────────────────────────────────────────────────────────────────────

const fieldById = (schema: PluginCollectionSchema, id: string | undefined) =>
  id ? schema.fields.find((field) => field.id === id) : undefined

/** The measure's own name, so the axis says what it is counting rather than just carrying numbers. */
function measureLabel(schema: PluginCollectionSchema, view: PanelView): string {
  const aggregate = view.aggregate ?? 'count'
  if (aggregate === 'count') return 'Rows'
  const field = fieldById(schema, view.field)
  return field ? `${aggregate} of ${field.name}` : String(aggregate)
}

/** A number on an axis, in the units the FIELD declared — the same `format.ts` a cell goes through,
 *  so a "MB" column's axis says MB without the chart knowing what MB is. */
function axisNumber(schema: PluginCollectionSchema, view: PanelView, value: number): string {
  const field = (view.aggregate ?? 'count') === 'count' ? undefined : fieldById(schema, view.field)
  return field ? cellText(formatCell(field, value)) : String(value)
}

const dayLabel = (at: number): string =>
  new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

const yTicksFor = (schema: PluginCollectionSchema, view: PanelView, max: number): ChartTick[] => {
  const values = niceTicks(max)
  const top = values[values.length - 1] || 1
  return values.map((value) => ({
    label: axisNumber(schema, view, value),
    at: PAD.top + PLOT_H - (value / top) * PLOT_H,
  }))
}

/** The category axis a bar is keyed by: the panel's own choice, then the shaping group-by — the same
 *  fallback chain a board walks, so flipping board ↔ chart keeps the categories. */
function barCategoryField(
  schema: PluginCollectionSchema,
  view: PanelView,
  shaping: PanelShaping,
): PluginCollectionField | undefined {
  const chosen = fieldById(schema, view.x)
  return chosen?.type === 'enum' ? chosen : groupField(schema, shaping)
}

/** The tone the plugin DECLARED for one of a field's values, or `undefined` — which is exactly the
 *  question the identity ramp answers (charts.md § 1: the ramp is for identity with no declared tone).
 *
 *  `boardColumns` cannot answer it and must not be asked: it defaults every column to `muted`, so a
 *  value declared WITHOUT a tone comes back looking like one declared muted. Colouring by that would
 *  draw every series of an untoned enum — which is most of them — in the same faint ink and call it
 *  the plugin's decision. */
const declaredTone = (field: PluginCollectionField | undefined, valueId: string): PanelTone | undefined =>
  field?.values?.find((value) => value.id === valueId)?.tone

/** The one place a mark's colour attribute is chosen: the declared tone where there is one, an ordinal
 *  identity slot where there is not, and never both. */
const toneOrSlot = (
  tone: PanelTone | undefined,
  index: number,
): { tone: PanelTone } | { series: ChartSeriesSlot } => (tone ? { tone } : { series: seriesSlot(index) })

/** The legend for a set of drawn series, or `undefined` for fewer than two.
 *
 *  The fold is disclosed rather than hidden: slots 4 and up all wear the muted `other` colour, so they
 *  collapse into ONE key that says how many went in. Nothing is visible in the render that is
 *  unnameable in text (charts.md § Accessibility). */
function legendFor(entries: readonly ChartLegendKey[]): ChartLegendKey[] | undefined {
  if (entries.length < 2) return undefined
  const keys = entries.filter((entry) => entry.series !== 'other')
  const folded = entries.length - keys.length
  if (folded) keys.push({ id: 'other', label: folded > 1 ? `Other (${folded})` : 'Other', series: 'other' })
  return keys
}

function buildBar(
  rows: readonly PluginCollectionRow[],
  schema: PluginCollectionSchema,
  view: PanelView,
  shaping: PanelShaping,
): ChartPlot | undefined {
  const field = barCategoryField(schema, view, shaping)
  if (!field) return undefined

  // THE GROUPED BAR (charts.md § 3): a third shape by arithmetic but not by config — it is `series` on
  // `shape: 'bar'`, the key the codec already round-trips for lines. An old client ignores the key and
  // draws the ungrouped bar, which is the acceptance test the design set.
  //
  // A split naming the category axis itself is dropped rather than drawn: it would put one bar in each
  // cluster, which is this chart with extra steps.
  const split = fieldById(schema, view.series)
  const series = split?.type === 'enum' && split.id !== field.id ? split : undefined

  // The board's own bucketing, reused whole for BOTH axes: declared values in declaration order
  // (present even when empty), then undeclared ones in first-appearance order, then one catch-all.
  // The ungrouped bar is the one-group case of the same layout rather than a second code path.
  const columns = boardColumns(rows, field)
  const groups = series
    ? boardColumns(rows, series)
    : [{ id: '', label: '', tone: 'muted' as PanelTone, declared: false, rows: [...rows] }]

  const values = groups.map((group) => {
    // Object identity, not a re-bucket: `boardColumns` already decided which rows are in this series,
    // and re-deriving the intersection from the cells would have to restate its three destinations.
    const inGroup = new Set(group.rows)
    return columns.map((column) =>
      aggregateRows(series ? column.rows.filter((row) => inGroup.has(row)) : column.rows, schema, view) ?? 0)
  })
  const max = Math.max(0, ...values.flat())
  const top = niceTicks(max).slice(-1)[0] || 1

  const slot = PLOT_W / Math.max(1, columns.length)
  // The cluster keeps the width one bar used to have, and the series divide it — so a chart with no
  // split is laid out exactly as it was before grouping existed.
  const cluster = slot * 0.7
  const width = cluster / groups.length

  const bars = groups.flatMap((group, groupIndex) =>
    columns.map((column, index): ChartBar => {
      const value = values[groupIndex][index]
      const height = Math.max(0, (value / top) * PLOT_H)
      return {
        key: `${group.id} ${column.id}`,
        label: column.label,
        value,
        title: series
          ? `${column.label} · ${group.label}: ${axisNumber(schema, view, value)}`
          : `${column.label}: ${axisNumber(schema, view, value)}`,
        // WHAT THE COLOUR ANSWERS moves with the split. Unsplit, each bar IS a category, so a toned
        // category keeps the tone the plugin gave it and anything else takes an ordinal slot. Split,
        // colour answers "which series", and the category is answered by the x axis instead.
        ...(series
          ? toneOrSlot(declaredTone(series, group.id), groupIndex)
          : toneOrSlot(declaredTone(field, column.id), index)),
        x: PAD.left + index * slot + (slot - cluster) / 2 + groupIndex * width,
        y: PAD.top + PLOT_H - height,
        w: width,
        h: height,
      }
    }))

  // Every category label, until they would collide; then every nth, evenly. The value stays reachable
  // through the tooltip and, one view flip away, through the table.
  const stride = Math.ceil(columns.length / 8)
  const xTicks = columns.flatMap((column, index): ChartTick[] =>
    index % stride === 0 ? [{ label: column.label, at: PAD.left + index * slot + slot / 2 }] : [])

  const legend = series
    ? legendFor(groups.map((group, index): ChartLegendKey => ({
      id: group.id,
      label: group.label,
      ...toneOrSlot(declaredTone(series, group.id), index),
    })))
    : undefined

  return {
    shape: 'bar',
    bars,
    xTicks,
    yTicks: yTicksFor(schema, view, max),
    xLabel: field.name,
    yLabel: measureLabel(schema, view),
    ...(legend ? { legend } : {}),
  }
}

function buildLine(
  rows: readonly PluginCollectionRow[],
  schema: PluginCollectionSchema,
  view: PanelView,
  shaping: PanelShaping,
): ChartPlot | undefined {
  const time = fieldById(schema, view.x)?.type === 'datetime'
    ? fieldById(schema, view.x)!
    : datetimeFields(schema).find((field) => field.role === 'updated') ?? datetimeFields(schema)[0]
  if (!time) return undefined
  const split = fieldById(schema, view.series ?? shaping.groupBy)
  const series = split?.type === 'enum' ? split : undefined

  // Group by series, then bucket each series by day and aggregate within the bucket. `count` and a
  // number aggregate go down the same path, which is why the bucket exists at all: a count at an
  // instant is always one.
  const groups = series
    ? boardColumns(rows, series)
    : [{ id: '', label: measureLabel(schema, view), tone: 'accent' as PanelTone, declared: true, rows: [...rows] }]

  const buckets = groups.map((group) => {
    const byDay = new Map<number, PluginCollectionRow[]>()
    for (const row of group.rows) {
      const cell = row.values[time.id]
      // `Number(null)` is 0, which is a perfectly finite January 1970 — blankness has to be checked
      // before the coercion, not after it.
      if (cell === null || cell === undefined || cell === '') continue
      const at = Number(cell)
      if (!Number.isFinite(at)) continue
      const day = dayBucket(at)
      const existing = byDay.get(day)
      if (existing) existing.push(row)
      else byDay.set(day, [row])
    }
    const points = [...byDay.entries()]
      .sort(([left], [right]) => left - right)
      .map(([day, dayRows]) => ({ day, value: aggregateRows(dayRows, schema, view) ?? 0 }))
    return { group, points }
  })

  const days = buckets.flatMap((bucket) => bucket.points.map((point) => point.day))
  if (!days.length) {
    return { shape: 'line', lines: [], xTicks: [], yTicks: yTicksFor(schema, view, 0), xLabel: time.name, yLabel: measureLabel(schema, view) }
  }
  const first = Math.min(...days)
  const last = Math.max(...days)
  const max = Math.max(0, ...buckets.flatMap((bucket) => bucket.points.map((point) => point.value)))
  const top = niceTicks(max).slice(-1)[0] || 1

  // A single day has no span to scale against, so it sits in the middle rather than dividing by zero.
  const xAt = (day: number) => (last === first ? PAD.left + PLOT_W / 2 : PAD.left + ((day - first) / (last - first)) * PLOT_W)
  const yAt = (value: number) => PAD.top + PLOT_H - (value / top) * PLOT_H

  const lines = buckets.flatMap(({ group, points }, index): ChartLine[] => {
    if (!points.length) return []
    const placed = points.map((point) => ({
      x: xAt(point.day),
      y: yAt(point.value),
      label: `${group.label || measureLabel(schema, view)} · ${dayLabel(point.day)} · ${axisNumber(schema, view, point.value)}`,
    }))
    return [{
      id: group.id || 'all',
      label: group.label,
      // Unsplit: one line, `--accent`, no identity question to answer. Split: the declared tone where
      // the enum has one, else an identity slot.
      ...(series ? toneOrSlot(declaredTone(series, group.id), index) : { tone: 'accent' as PanelTone }),
      path: placed.length > 1 ? placed.map((point, at) => `${at ? 'L' : 'M'}${point.x} ${point.y}`).join(' ') : '',
      points: placed,
    }]
  })

  const xTicks = (last === first ? [first] : [first, last]).map((day) => ({ label: dayLabel(day), at: xAt(day) }))
  // Over the lines that DREW, not the groups that exist: a series with no points has no mark for a
  // swatch to stand for, and an empty declared column is a real case (`boardColumns` keeps them).
  const legend = legendFor(lines.map((line): ChartLegendKey => ({
    id: line.id,
    label: line.label,
    ...(line.tone ? { tone: line.tone } : {}),
    ...(line.series ? { series: line.series } : {}),
  })))
  return {
    shape: 'line',
    lines,
    xTicks,
    yTicks: yTicksFor(schema, view, max),
    xLabel: time.name,
    yLabel: measureLabel(schema, view),
    ...(legend ? { legend } : {}),
  }
}

/** The whole chart, or `undefined` when this schema cannot draw the shape the panel asks for — a
 *  definition written against a collection whose fields have since changed. The view renders the
 *  same inert notice it does for a view kind it cannot draw. */
export function buildChart(
  rows: readonly PluginCollectionRow[],
  schema: PluginCollectionSchema,
  view: PanelView,
  shaping: PanelShaping,
): ChartPlot | undefined {
  const shape: ChartShape = view.shape === 'line' ? 'line' : view.shape === 'bar' ? 'bar' : (chartShapesFor(schema)[0] ?? 'bar')
  return shape === 'line' ? buildLine(rows, schema, view, shaping) : buildBar(rows, schema, view, shaping)
}

/** Axis and plot geometry the view needs and should not recompute. */
export const CHART_FRAME = {
  ...CHART_BOX,
  plotLeft: PAD.left,
  plotTop: PAD.top,
  plotWidth: PLOT_W,
  plotHeight: PLOT_H,
  baseline: PAD.top + PLOT_H,
} as const
