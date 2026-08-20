import type { PluginCollectionField, PluginCollectionRow, PluginCollectionSchema } from '@acorn/protocol/collections.ts'
import { dayBucket } from './chart'
import type { PanelView } from './model'
import { aggregateRows } from './shaping'

// The stat's trend: the sparkline beside the number and the delta under it. The two tiers, the
// zero-versus-gap rule and the baseline argument are all in docs/dashboards.md § Trends.
//
// Pure and tested for the same reason `chart.ts` is: vitest here runs in node with no Solid plugin, so
// `StatView.tsx` cannot be checked by anything and therefore decides nothing. Every number on screen,
// the path data, the end dot, the delta and its tone, comes out of this file.

const DAY_MS = 86_400_000

/** The window both tiers draw: a fortnight, which is also the store's hourly retention tier, so a
 *  sparkline never asks for a day that compaction has already collapsed to one point. */
export const TREND_DAYS = 14

export type MeasureSample = { bucket: number; value: number }

/** One day of the window. `null` is a gap, drawn as a break in the line and never interpolated. */
export type TrendPoint = { day: number; value: number | null }

/** The fortnight's UTC days, oldest first. Fixed rather than "however many days the series has": a
 *  three-day-old series has to read as three days of a fortnight, not as a full one. */
const windowDays = (now: number): number[] => {
  const last = dayBucket(now)
  return Array.from({ length: TREND_DAYS }, (_, index) => last - (TREND_DAYS - 1 - index) * DAY_MS)
}

/** The history tier: the day's last value, per day, over the window. Last rather than an average
 *  because a stat shows point-in-time state, the same rule the store's own compaction applies. */
export function historyPoints(samples: readonly MeasureSample[], now: number): TrendPoint[] {
  const byDay = new Map<number, number>()
  // Sorted rather than trusting the caller. The route answers ascending, but "last value wins" is a
  // property of this arithmetic and should not depend on somebody else's ORDER BY.
  for (const sample of [...samples].sort((left, right) => left.bucket - right.bucket)) {
    byDay.set(dayBucket(sample.bucket), sample.value)
  }
  return windowDays(now).map((day) => ({ day, value: byDay.get(day) ?? null }))
}

/** The datetime the activity tier buckets by: the declared `updated` role, then whatever datetime
 *  there is. Exported because it is also the editor's gate, so a schema with no datetime is never
 *  offered the activity trend and a trend that cannot draw is unrepresentable rather than validated. */
export const activityField = (schema: PluginCollectionSchema): PluginCollectionField | undefined =>
  schema.fields.find((field) => field.role === 'updated' && field.type === 'datetime')
    ?? schema.fields.find((field) => field.type === 'datetime')

/** The activity tier: the panel's own measure over the rows that changed each day, from the rows
 *  already on screen. Zero store involvement, and the same `dayBucket` the line chart uses. */
export function activityPoints(
  rows: readonly PluginCollectionRow[],
  schema: PluginCollectionSchema,
  view: PanelView,
  now: number,
): TrendPoint[] {
  const time = activityField(schema)
  if (!time) return []

  const byDay = new Map<number, PluginCollectionRow[]>()
  for (const row of rows) {
    const cell = row.values[time.id]
    // `Number(null)` is 0, a perfectly finite January 1970, so blankness has to be checked before the
    // coercion rather than after it. `chart.ts` buildLine says the same.
    if (cell === null || cell === undefined || cell === '') continue
    const at = Number(cell)
    if (!Number.isFinite(at)) continue
    const day = dayBucket(at)
    const existing = byDay.get(day)
    if (existing) existing.push(row)
    else byDay.set(day, [row])
  }

  return windowDays(now).map((day) => {
    const dayRows = byDay.get(day)
    return { day, value: dayRows ? aggregateRows(dayRows, schema, view) ?? 0 : 0 }
  })
}

// ── The mark ──────────────────────────────────────────────────────────────────────────────────
//
// ── The mark ──────────────────────────────────────────────────────────────────────────────────
//
// Abstract units, scaled uniformly by the SVG to whatever the stat body has, the same trade `CHART_BOX`
// takes. At this size letterboxing is invisible. No axes, no grid, no ticks: the stat's number is the
// axis.

export const SPARK_BOX = { width: 120, height: 28 } as const
/** Room for the end dot and its ring at every edge, so neither is clipped by the viewBox. */
const INSET = 3

/** One unbroken run of days. A series with holes is several of these, which is what makes a gap read
 *  as a gap rather than as a straight line across the days nobody sampled. */
export type SparkSegment = { line: string; area: string }

export type Sparkline = {
  segments: SparkSegment[]
  /** Runs of a single day: no line to draw, so they are drawn as dots instead. Without these an
   *  every-other-day series would render as nothing at all. */
  dots: { x: number; y: number }[]
  /** The most recent point, where the number on screen is. */
  end: { x: number; y: number }
}

const round = (value: number): number => Math.round(value * 100) / 100

/** `undefined` when there is nothing to draw: a series with no values yet, which is the cold state
 *  the stat renders a note for rather than an empty box. */
export function sparkline(points: readonly TrendPoint[]): Sparkline | undefined {
  const values = points.flatMap((point) => (point.value === null ? [] : [point.value]))
  if (!values.length) return undefined

  const min = Math.min(...values)
  const max = Math.max(...values)
  const top = INSET
  const bottom = SPARK_BOX.height - INSET
  const left = INSET
  const right = SPARK_BOX.width - INSET

  const xAt = (index: number) =>
    round(points.length < 2 ? (left + right) / 2 : left + (index / (points.length - 1)) * (right - left))
  // Min-to-max rather than zero-based, unlike the chart's axis: a sparkline carries no scale, so its
  // job is to show the shape of the change rather than its size against zero. A flat series sits in
  // the middle rather than dividing by zero, and a flat line is the honest answer.
  const yAt = (value: number) =>
    round(max === min ? (top + bottom) / 2 : bottom - ((value - min) / (max - min)) * (bottom - top))

  const segments: SparkSegment[] = []
  const dots: { x: number; y: number }[] = []
  let run: { x: number; y: number }[] = []

  const flush = () => {
    if (run.length === 1) dots.push(run[0])
    if (run.length > 1) {
      segments.push({
        line: run.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${point.y}`).join(' '),
        // The wash is closed to the baseline under this run only. An area spanning a gap would colour
        // days that were never sampled.
        area: `M${run[0].x} ${bottom} ${run.map((point) => `L${point.x} ${point.y}`).join(' ')} L${run[run.length - 1].x} ${bottom} Z`,
      })
    }
    run = []
  }

  points.forEach((point, index) => {
    if (point.value === null) return flush()
    run.push({ x: xAt(index), y: yAt(point.value) })
  })
  flush()

  // The last day that has a value, which is not the last day of the window when the series ends in a
  // gap. The dot belongs on the most recent thing actually known, wherever that sits.
  const last = points.reduce((best, point, index) => (point.value === null ? best : index), 0)
  return { segments, dots, end: { x: xAt(last), y: yAt(points[last].value ?? 0) } }
}

// ── The delta ─────────────────────────────────────────────────────────────────────────────────

const COMPARE_MS: Record<NonNullable<PanelView['compare']>, number> = { day: DAY_MS, week: 7 * DAY_MS }

/** How the delta says which window it is comparing against, in the register a person would use. */
export const COMPARE_LABELS: Record<NonNullable<PanelView['compare']>, string> = {
  day: 'yesterday',
  week: 'last week',
}

/** The baseline is a point looked up, never a window aggregated. "Vs last week" is the sample nearest
 *  to one week ago, not an average of last week: window aggregates drag in bucket alignment, partial
 *  windows, timezone edges and per-panel aggregation config, which are a metrics product's problems.
 *  Datadog's Query Value change mode and Grafana's stat-plus-timeShift both do the same thing.
 *
 *  Searched no further back than twice the window, so a series with a three-week hole says nothing
 *  rather than comparing today against a number from a different month. */
export function baselineValue(
  samples: readonly MeasureSample[],
  compare: NonNullable<PanelView['compare']>,
  now: number,
): number | undefined {
  const span = COMPARE_MS[compare]
  const target = now - span
  const floor = now - 2 * span
  let best: MeasureSample | undefined
  for (const sample of samples) {
    if (sample.bucket > target || sample.bucket < floor) continue
    if (!best || sample.bucket > best.bucket) best = sample
  }
  return best?.value
}

export type TrendDelta = {
  /** Current live measure minus the baseline. Signed; zero is a real answer and says "unchanged". */
  change: number
  /** `muted` unless the panel declared which direction is good. Direction-goodness is not guessable,
   *  since open PRs going up is bad for one person's board and good for another's, so an absent `good`
   *  renders in neutral ink rather than a guessed green. */
  tone: 'ok' | 'bad' | 'muted'
}

/** `undefined` when there is no delta to draw, which is a fact and not a zero: no comparison asked
 *  for, no live measure, or no sample old enough to be a baseline. The stat draws nothing at all in
 *  that case. */
export function trendDelta(
  current: number | null,
  samples: readonly MeasureSample[],
  view: PanelView,
  now: number,
): TrendDelta | undefined {
  if (current === null || !view.compare) return undefined
  const baseline = baselineValue(samples, view.compare, now)
  if (baseline === undefined) return undefined
  const change = current - baseline
  const tone = !view.good || change === 0 ? 'muted' : (change > 0) === (view.good === 'up') ? 'ok' : 'bad'
  return { change, tone }
}
