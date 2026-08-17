import { createMemo, For, Show } from 'solid-js'
import { EmptyState } from '../../ui/primitives'
import { buildChart, CHART_FRAME } from '../chart'
import type { PanelViewProps } from './props'

// The chart view. Deliberately almost nothing: every number on screen — the bar rects, the tick
// positions, the path data, the labels — comes out of `chart.ts`, which is pure and tested. This
// file turns that into SVG and picks a class name, and it must stay that way, because vitest here
// runs in node with no Solid plugin and nothing written here is checked by anything.
//
// COLOUR IS AN ATTRIBUTE, NEVER A LITERAL. Each mark carries `data-tone` (the plugin declared what
// this value means) or `data-series` (identity with no declared meaning — an ordinal slot), never
// both, and `dashboards.css` turns either into a colour the appearance pack owns. No `fill="#…"` may
// appear in this file.
//
// ACCESSIBILITY FLOOR, and it is a floor: the SVG names the shape and both axes, every mark carries
// a `<title>` tooltip, and the full data is one view flip away in `table`. A bespoke screen-reader
// data table inside the chart is out of scope for v1.

/** Half the tick text's line, so a label reads as centred on its gridline. */
const TICK_GAP = 4
const LABEL_DROP = 10

export default function ChartView(props: PanelViewProps) {
  const plot = createMemo(() =>
    buildChart(props.rows, props.schema, props.view, props.groupBy ? { groupBy: props.groupBy } : {}))

  const yTicks = () => plot()?.yTicks ?? []
  const bars = () => {
    const chart = plot()
    return chart?.shape === 'bar' ? chart.bars : []
  }
  const lines = () => {
    const chart = plot()
    return chart?.shape === 'line' ? chart.lines : []
  }
  const xTicks = () => {
    const chart = plot()
    return chart?.shape === 'line' ? chart.xTicks : []
  }

  const description = () => {
    const chart = plot()
    return chart ? `${chart.shape === 'bar' ? 'Bar' : 'Line'} chart of ${chart.yLabel} by ${chart.xLabel}` : ''
  }

  return (
    <Show
      when={plot()}
      fallback={(
        <EmptyState align="start" size="sm" title="Nothing to chart">
          This collection has no field with a fixed set of values and no date to plot against.
        </EmptyState>
      )}
    >
      <Show when={props.rows.length} fallback={<EmptyState align="start" size="sm">No rows.</EmptyState>}>
        <svg
          class="dash-chart"
          viewBox={`0 0 ${CHART_FRAME.width} ${CHART_FRAME.height}`}
          role="img"
          aria-label={description()}
        >
          <title>{description()}</title>

          {/* Gridlines and their labels first, so every mark sits on top of them. */}
          <For each={yTicks()}>
            {(tick) => (
              <>
                <line
                  class="dash-chart-grid"
                  x1={CHART_FRAME.plotLeft}
                  x2={CHART_FRAME.plotLeft + CHART_FRAME.plotWidth}
                  y1={tick.at}
                  y2={tick.at}
                />
                <text
                  class="dash-chart-tick"
                  x={CHART_FRAME.plotLeft - TICK_GAP}
                  y={tick.at}
                  text-anchor="end"
                  dominant-baseline="middle"
                >
                  {tick.label}
                </text>
              </>
            )}
          </For>

          <For each={bars()}>
            {(bar) => (
              <>
                <rect
                  class="dash-chart-bar"
                  data-tone={bar.tone}
                  data-series={bar.series}
                  x={bar.x}
                  y={bar.y}
                  width={bar.w}
                  height={bar.h}
                >
                  <title>{`${bar.label}: ${bar.value}`}</title>
                </rect>
                <Show when={bar.labelled}>
                  <text
                    class="dash-chart-tick"
                    x={bar.x + bar.w / 2}
                    y={CHART_FRAME.baseline + LABEL_DROP}
                    text-anchor="middle"
                  >
                    {bar.label}
                  </text>
                </Show>
              </>
            )}
          </For>

          <For each={lines()}>
            {(series) => (
              <>
                <Show when={series.path}>
                  <path class="dash-chart-line" data-tone={series.tone} data-series={series.series} d={series.path} />
                </Show>
                {/* Dots as well as the path: a single-day series has no line to draw, and on a
                    multi-day one this is where the tooltip lives. */}
                <For each={series.points}>
                  {(point) => (
                    <circle
                      class="dash-chart-point"
                      data-tone={series.tone}
                      data-series={series.series}
                      cx={point.x}
                      cy={point.y}
                      r="2"
                    >
                      <title>{point.label}</title>
                    </circle>
                  )}
                </For>
              </>
            )}
          </For>

          <For each={xTicks()}>
            {(tick) => (
              <text class="dash-chart-tick" x={tick.at} y={CHART_FRAME.baseline + LABEL_DROP} text-anchor="middle">
                {tick.label}
              </text>
            )}
          </For>

          {/* The baseline last, so no mark can sit on the wrong side of it. */}
          <line
            class="dash-chart-axis"
            x1={CHART_FRAME.plotLeft}
            x2={CHART_FRAME.plotLeft + CHART_FRAME.plotWidth}
            y1={CHART_FRAME.baseline}
            y2={CHART_FRAME.baseline}
          />
        </svg>
      </Show>
    </Show>
  )
}
