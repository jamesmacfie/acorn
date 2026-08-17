import { createMemo, For, Show } from 'solid-js'
import {
  activityPoints,
  COMPARE_LABELS,
  historyPoints,
  SPARK_BOX,
  sparkline,
  trendDelta,
} from '@acorn/dashboards-core/trend.ts'
import { cellText, formatCell } from '../format'
import { createMeasureHistory } from '../history'
import { aggregateRows } from '../shaping'
import type { PanelViewProps } from './props'

// The stat view: one number over the SHAPED rows. A count by default, because "how many of these are
// there" is the question a filter has already been written to answer.
//
// The unit comes from the aggregated field, not from the view — so a panel that sums a field
// declared in MB says MB, and says it again if the panel later becomes a table.
//
// THE TREND IS OPTIONAL AND IN TWO TIERS (docs/dashboards.md § Trends). Everything it draws — the
// path data, the end dot, the delta and its tone — comes out of `trend.ts`, which is pure and tested;
// this file turns that into SVG and picks a class name, exactly as `ChartView` does, because vitest
// here runs in node with no Solid plugin and nothing written in a component is checked by anything.

const AGGREGATE_LABELS: Record<string, string> = { sum: 'Total', avg: 'Average', min: 'Lowest', max: 'Highest' }

export default function StatView(props: PanelViewProps) {
  const aggregate = () => props.view.aggregate ?? 'count'
  const field = () => props.schema.fields.find((candidate) => candidate.id === props.view.field)
  const value = () => aggregateRows(props.rows, props.schema, props.view)

  /** The measure as a person reads it: rounded, and in the units the FIELD declared. Shared by the
   *  number and by the delta beside it, so "▲ 2 MB" cannot ever disagree with the total above it. */
  const measureText = (answer: number): string => {
    const rounded = Number.isInteger(answer) ? answer : Math.round(answer * 10) / 10
    const unitField = field()
    return aggregate() === 'count' || !unitField ? String(rounded) : cellText(formatCell(unitField, rounded))
  }

  const text = () => {
    const answer = value()
    // An em dash, not 0: "nothing to aggregate" and "the total is zero" are different, and only one
    // of them is a fact about the data (node/FleetHome.tsx makes the same distinction).
    if (answer === null) return '—'
    return measureText(answer)
  }

  const label = () => {
    if (aggregate() === 'count') return props.rows.length === 1 ? 'row' : 'rows'
    return `${AGGREGATE_LABELS[aggregate()] ?? aggregate()} · ${field()?.name ?? props.view.field ?? ''}`
  }

  // Only the HISTORY tier costs a read. Activity is bucketed from the rows already on screen, which
  // is the whole difference between the two tiers and the reason they are never blurred in the UI.
  const samples = createMeasureHistory(() => props.panelId, () => props.view.trend === 'history')

  const points = createMemo(() => {
    const now = Date.now()
    if (props.view.trend === 'history') return historyPoints(samples(), now)
    if (props.view.trend === 'activity') return activityPoints(props.rows, props.schema, props.view, now)
    return []
  })
  const mark = createMemo(() => sparkline(points()))
  const delta = createMemo(() => trendDelta(value(), samples(), props.view, Date.now()))

  const deltaText = () => {
    const change = delta()!.change
    if (change === 0) return `Unchanged vs ${COMPARE_LABELS[props.view.compare!]}`
    return `${change > 0 ? '▲' : '▼'} ${measureText(Math.abs(change))} vs ${COMPARE_LABELS[props.view.compare!]}`
  }

  return (
    <div class="dash-stat">
      <span class="dash-stat-value">{text()}</span>
      <span class="dash-stat-label">{label()}</span>

      {/* No axes, no grid, no ticks — the number above IS the axis.
          `xMinYMid meet` scales uniformly and pins left: stretching would thin the line and turn the
          end dot into an ellipse, and a mark whose ink weight varies with the panel's width reads as
          data something that is only geometry. */}
      <Show when={mark()}>
        {(spark) => (
          <svg
            class="dash-stat-spark"
            viewBox={`0 0 ${SPARK_BOX.width} ${SPARK_BOX.height}`}
            preserveAspectRatio="xMinYMid meet"
            role="img"
            aria-label={`${props.view.trend === 'history' ? 'Recorded' : 'Activity'} over the last fortnight`}
          >
            <For each={spark().segments}>
              {(segment) => (
                <>
                  <path class="dash-stat-spark-area" d={segment.area} />
                  <path class="dash-stat-spark-line" d={segment.line} />
                </>
              )}
            </For>
            {/* A day whose neighbours are both gaps has no line to belong to. Without these an
                every-other-day series would draw as nothing at all. */}
            <For each={spark().dots}>
              {(dot) => <circle class="dash-stat-spark-end" cx={dot.x} cy={dot.y} r="2" />}
            </For>
            <circle class="dash-stat-spark-end" cx={spark().end.x} cy={spark().end.y} r="3" />
          </svg>
        )}
      </Show>

      {/* Absence is a fact and it is not zero: no sample old enough to be a baseline draws NOTHING
          rather than "▲ 0", which would claim a comparison nobody could make. */}
      <Show when={delta()}>
        <span class="dash-stat-delta" data-tone={delta()!.tone}>{deltaText()}</span>
      </Show>

      {/* The honest cold state. A history trend accrues from when the panel first asked for it, so a
          panel switched on this morning has an empty series and says so rather than drawing a flat
          line through a fortnight it was not watching. */}
      <Show when={props.view.trend === 'history' && !mark()}>
        <span class="dash-stat-label">Collecting — hourly, from now on.</span>
      </Show>
    </div>
  )
}
