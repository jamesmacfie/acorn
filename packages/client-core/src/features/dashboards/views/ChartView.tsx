import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js'
import { EmptyState } from '../../../kit/components/primitives'
import { buildChart, CHART_BOX, CHART_FRAME, TICK_FONT, TICK_GAP } from '../chart'
import type { PanelViewProps } from './props'

// The chart view. Every number on screen comes out of `chart.ts`, which is pure and tested; this
// file turns that into SVG and picks a class name, because vitest runs in node with no Solid plugin
// and nothing written here is checked.
//
// Colour is an attribute, never a literal: `data-tone` or `data-series`, never both, with
// `dashboards.css` owning the colour. No `fill="#…"` here, so a swatch and its mark cannot drift
// apart. See docs/dashboards/views.md § Views are derived, not chosen from a menu.

export default function ChartView(props: PanelViewProps) {
  // The box scales uniformly (`meet`), so its scale is the smaller of the two ratios. Dividing the
  // wrapper's `--fs-2xs` by it gives a tick size in user units that draws at `--fs-2xs` on screen.
  // The size comes off the wrapper's computed style, not the token by name, as PanelGrid reads its gap.
  const [tickFont, setTickFont] = createSignal(TICK_FONT)
  let observer: ResizeObserver | undefined
  onCleanup(() => observer?.disconnect())
  const watch = (svg: SVGSVGElement) => {
    const measure = () => {
      const scale = Math.min(svg.clientWidth / CHART_BOX.width, svg.clientHeight / CHART_BOX.height)
      const px = Number.parseFloat(getComputedStyle(svg.parentElement ?? svg).fontSize)
      if (scale > 0 && px > 0) setTickFont(Math.round((px / scale) * 10) / 10)
    }
    queueMicrotask(measure)
    if (typeof ResizeObserver === 'undefined') return
    observer?.disconnect()
    observer = new ResizeObserver(measure)
    observer.observe(svg)
  }
  const plot = createMemo(() =>
    buildChart(props.rows, props.schema, props.view, props.groupBy ? { groupBy: props.groupBy } : {}, tickFont()))

  // Every coordinate comes off the plot's own frame, never a module constant, because the left
  // gutter is as wide as this chart's y axis labels need. `CHART_FRAME` is only the stand-in for
  // the un-drawable case below.
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
        <EmptyState align="start" size="sm" title="Can't chart this source">
          It has no status, category, or date field to chart by.
        </EmptyState>
      )}
    >
      <Show when={props.rows.length} fallback={<EmptyState align="start" size="sm">Nothing to show.</EmptyState>}>
        <div class="dash-chart-wrap">
          {/* One row above the plot, wrapping rather than truncating. Identity lives in the swatch,
              never in coloured text, so the legend reads the same to someone who cannot tell the
              swatches apart. */}
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
          {/* `font-size` in user units, from the frame (chart.ts § TICK_FONT); the stylesheet keeps
              the colour. */}
          <svg
            ref={watch}
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

            {/* Centred on its gridline, except at the edges: `chart.ts` anchors a label that would
                otherwise hang half of itself outside the box, which is what cut "Aug 18" to "Aug 1". */}
            <For each={xTicks()}>
              {(tick) => (
                <text
                  class="dash-chart-tick"
                  x={tick.at}
                  y={frame().baseline + frame().labelDrop}
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
