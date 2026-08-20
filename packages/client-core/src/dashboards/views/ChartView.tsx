import { createMemo, For, Show } from 'solid-js'
import { EmptyState } from '../../ui/primitives'
import { buildChart, CHART_FRAME, TICK_GAP } from '../chart'
import type { PanelViewProps } from './props'

// The chart view, and deliberately almost nothing. Every number on screen comes out of `chart.ts`,
// which is pure and tested. This file turns that into SVG and picks a class name, and it must stay that
// way, because vitest here runs in node with no Solid plugin and nothing written here is checked.
//
// Colour is an attribute, never a literal. Each mark carries `data-tone` (the plugin declared what this
// value means) or `data-series` (an ordinal slot with no declared meaning), never both, and
// `dashboards.css` turns either into a colour the appearance pack owns. No `fill="#…"` in this file.
// The legend's swatches wear the same two attributes on the same two classes, which is what stops a
// swatch and its mark drifting apart.
//
// Accessibility floor: the SVG names the shape and both axes, every mark carries a `<title>` tooltip,
// and the full data is one view flip away in `table`. The legend is part of that floor rather than
// polish, since it's the secondary encoding the identity ramp needs to be legal for
// colour-vision-deficient readers (docs/dashboards.md § Views are derived, not chosen from a menu).

const LABEL_DROP = 10

export default function ChartView(props: PanelViewProps) {
  const plot = createMemo(() =>
    buildChart(props.rows, props.schema, props.view, props.groupBy ? { groupBy: props.groupBy } : {}))

  // Every coordinate comes off the plot's own frame, never a module constant: the left gutter is as wide
  // as this chart's y axis labels need, so a chart counting to 200,000 sits further right than one
  // counting to 9. `CHART_FRAME` is only the stand-in for the un-drawable case below.
  const frame = () => plot()?.frame ?? CHART_FRAME
  const yTicks = () => plot()?.yTicks ?? []
  const bars = () => {
    const chart = plot()
    return chart?.shape === 'bar' ? chart.bars : []
  }
  const lines = () => {
    const chart = plot()
    return chart?.shape === 'line' ? chart.lines : []
  }
  const xTicks = () => plot()?.xTicks ?? []
  const legend = () => plot()?.legend

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
        <div class="dash-chart-wrap">
          {/* One row above the plot, wrapping rather than truncating. Identity lives in the SWATCH and
              never in coloured text: the label is ordinary ink, so the legend reads the same whether or
              not the reader can tell the swatches apart. */}
          <Show when={legend()}>
            {(keys) => (
              <ul class="dash-chart-legend">
                <For each={keys()}>
                  {(key) => (
                    <li class="dash-chart-legend-key">
                      {/* The mark's own shape, in the mark's own colour attributes. */}
                      <svg class="dash-chart-swatch" viewBox="0 0 12 12" aria-hidden="true">
                        <Show
                          when={plot()?.shape === 'line'}
                          fallback={(
                            <rect
                              class="dash-chart-bar"
                              data-tone={key.tone}
                              data-series={key.series}
                              x="2"
                              y="2"
                              width="8"
                              height="8"
                            />
                          )}
                        >
                          <line
                            class="dash-chart-line"
                            data-tone={key.tone}
                            data-series={key.series}
                            x1="1"
                            x2="11"
                            y1="6"
                            y2="6"
                          />
                        </Show>
                      </svg>
                      {key.label}
                    </li>
                  )}
                </For>
              </ul>
            )}
          </Show>
          {/* `font-size` in USER UNITS, from the frame — inside a scaled viewBox a CSS px is a user
              unit, so type set in the stylesheet scales with the drawing and `--fs-2xs` came out
              enormous on a large panel. It is geometry here, like the point radius (chart.ts
              § TICK_FONT), and the stylesheet keeps the colour. */}
          <svg
            class="dash-chart"
            viewBox={`0 0 ${frame().width} ${frame().height}`}
            font-size={String(frame().tickFont)}
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
                    x1={frame().plotLeft}
                    x2={frame().plotLeft + frame().plotWidth}
                    y1={tick.at}
                    y2={tick.at}
                  />
                  <text
                    class="dash-chart-tick"
                    x={frame().plotLeft - TICK_GAP}
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
                <rect
                  class="dash-chart-bar"
                  data-tone={bar.tone}
                  data-series={bar.series}
                  x={bar.x}
                  y={bar.y}
                  width={bar.w}
                  height={bar.h}
                >
                  <title>{bar.title}</title>
                </rect>
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

            {/* Centred on its gridline, EXCEPT at the edges: `chart.ts` anchors a label that would
                otherwise hang half of itself outside the box, which is what cut "Aug 18" to "Aug 1". */}
            <For each={xTicks()}>
              {(tick) => (
                <text
                  class="dash-chart-tick"
                  x={tick.at}
                  y={frame().baseline + LABEL_DROP}
                  text-anchor={tick.anchor ?? 'middle'}
                >
                  {tick.label}
                </text>
              )}
            </For>

            {/* The baseline last, so no mark can sit on the wrong side of it. */}
            <line
              class="dash-chart-axis"
              x1={frame().plotLeft}
              x2={frame().plotLeft + frame().plotWidth}
              y1={frame().baseline}
              y2={frame().baseline}
            />
          </svg>
        </div>
      </Show>
    </Show>
  )
}
