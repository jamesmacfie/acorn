import { createMemo, createSignal, For, Index, Show } from 'solid-js'
import { buildHeatmap } from '@acorn/dashboards-core/heatmap.ts'
import { EmptyState } from '../../../kit/components/primitives'
import type { PanelViewProps } from './props'

// The heatmap view. Every value and shade comes out of `heatmap.ts`, which is pure and tested; this
// file lays the grid out and moves focus through it. A cell's shade is the `data-step` attribute, and
// `dashboards.css` maps it to `--viz-scale-*`.

/** At most this many column labels show, so hour labels don't collide. Every cell still names its column. */
const MAX_COLUMN_LABELS = 12

export default function HeatmapView(props: PanelViewProps) {
  const map = createMemo(() => buildHeatmap(props.rows, props.schema, props.view))
  // The grid is one tab stop: the active cell takes focus, and arrows move it.
  const [active, setActive] = createSignal({ row: 0, column: 0 })
  let table: HTMLTableElement | undefined

  const stride = () => Math.ceil((map()?.columns.length ?? 0) / MAX_COLUMN_LABELS)
  const move = (event: KeyboardEvent) => {
    const grid = map()
    if (!grid?.rows.length || !grid.columns.length) return
    const { row, column } = active()
    const last = grid.columns.length - 1
    const next =
      event.key === 'ArrowLeft'
        ? { row, column: Math.max(0, column - 1) }
        : event.key === 'ArrowRight'
          ? { row, column: Math.min(last, column + 1) }
          : event.key === 'ArrowUp'
            ? { row: Math.max(0, row - 1), column }
            : event.key === 'ArrowDown'
              ? { row: Math.min(grid.rows.length - 1, row + 1), column }
              : event.key === 'Home'
                ? { row, column: 0 }
                : event.key === 'End'
                  ? { row, column: last }
                  : undefined
    if (!next) return
    event.preventDefault()
    setActive(next)
    table?.querySelector<HTMLElement>(`[data-cell="${next.row}:${next.column}"]`)?.focus()
  }
  const isActive = (row: number, column: number) => {
    const grid = map()!
    // A refresh can shrink the grid under the active cell, which would leave no tab stop.
    const current = active()
    const clamped = {
      row: Math.min(current.row, grid.rows.length - 1),
      column: Math.min(current.column, grid.columns.length - 1),
    }
    return clamped.row === row && clamped.column === column
  }

  return (
    <Show
      when={map()}
      fallback={
        <EmptyState align="start" size="sm" title="Can't draw this heatmap">
          It needs two columns to draw along. Edit the panel to choose them.
        </EmptyState>
      }
    >
      {(grid) => (
        <Show
          when={props.rows.length}
          fallback={
            <EmptyState align="start" size="sm">
              Nothing to show.
            </EmptyState>
          }
        >
          <div class="dash-heatmap-wrap">
            {/* Scrolls sideways at narrow widths; the row labels stay in place (dashboards.css). */}
            <div class="dash-heatmap-scroll">
              <table
                ref={table}
                class="dash-heatmap"
                role="grid"
                aria-label={`${grid().measure} by ${grid().yLabel} and ${grid().xLabel}`}
                onKeyDown={move}
              >
                <thead>
                  <tr>
                    <th scope="col" class="dash-heatmap-corner">
                      <span class="sr-only">{grid().yLabel}</span>
                    </th>
                    <Index each={grid().columns}>
                      {(column, index) => (
                        <th scope="col" class="dash-heatmap-column" title={column().label}>
                          <Show when={index % stride() === 0} fallback={<span class="sr-only">{column().label}</span>}>
                            {column().label}
                          </Show>
                        </th>
                      )}
                    </Index>
                  </tr>
                </thead>
                <tbody>
                  <Index each={grid().rows}>
                    {(row, rowIndex) => (
                      <tr>
                        <th scope="row" class="dash-heatmap-row">
                          {row().label}
                        </th>
                        <Index each={row().cells}>
                          {(cell, columnIndex) => (
                            <td
                              class="dash-heatmap-cell"
                              role="gridcell"
                              data-cell={`${rowIndex}:${columnIndex}`}
                              data-step={cell().step}
                              tabindex={isActive(rowIndex, columnIndex) ? 0 : -1}
                              aria-label={cell().name}
                              title={cell().name}
                              onFocus={() => setActive({ row: rowIndex, column: columnIndex })}
                            />
                          )}
                        </Index>
                      </tr>
                    )}
                  </Index>
                </tbody>
              </table>
            </div>
            <Show when={grid().legend}>
              {(legend) => (
                <div class="dash-heatmap-legend">
                  <span>{grid().measure}</span>
                  <span>{legend().low}</span>
                  <span class="dash-heatmap-ramp" aria-hidden="true">
                    <For each={[1, 2, 3, 4, 5]}>{(step) => <span class="dash-heatmap-cell" data-step={step} />}</For>
                  </span>
                  <span>{legend().high}</span>
                </div>
              )}
            </Show>
          </div>
        </Show>
      )}
    </Show>
  )
}
