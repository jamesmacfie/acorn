import type { DashboardDisplayRow, DashboardDisplaySchema } from './display'
import { axisColumns, axisNumber, measureLabel } from './chart'
import type { PanelView } from './model'
import { aggregateRows } from './shaping'

// The heatmap view's arithmetic: which rows land in which cell, each cell's value, and its shade.
// Pure and tested because `HeatmapView.tsx` cannot be, as with `chart.ts`.

/** Zero, or no value, draws step 0. The rest spread over five steps of `--viz-scale-1..5`. */
const STEPS = 5

export type HeatmapStep = 0 | 1 | 2 | 3 | 4 | 5

type HeatmapCell = {
  value: number | null
  step: HeatmapStep
  /** What a screen reader says and a tooltip shows: "Tuesday, 14:00: 3". */
  name: string
}

export type Heatmap = {
  /** The `x` axis, left to right. */
  columns: { id: string; label: string }[]
  /** The `y` axis, top to bottom, each with one cell per column. */
  rows: { id: string; label: string; cells: HeatmapCell[] }[]
  xLabel: string
  yLabel: string
  measure: string
  /** The lowest and highest nonzero values, in the measure's units. Absent when every cell is empty. */
  legend?: { low: string; high: string }
}

/** The step a value draws at, from the lowest nonzero value to the highest. */
export function heatmapStep(value: number | null, low: number, high: number): HeatmapStep {
  if (value === null || value === 0) return 0
  if (high === low) return STEPS
  return Math.min(STEPS, 1 + Math.floor(((value - low) / (high - low)) * STEPS)) as HeatmapStep
}

/** The whole grid, or `undefined` when the schema no longer has both axes, which draws the inert
 *  notice. Every value of an axis draws, including empty ones, so a quiet Sunday shows as empty. */
export function buildHeatmap(
  rows: readonly DashboardDisplayRow[],
  schema: DashboardDisplaySchema,
  view: PanelView,
): Heatmap | undefined {
  const axis = (id: string | undefined) => {
    const field = id ? schema.fields.find((candidate) => candidate.id === id) : undefined
    return field && ['enum', 'person', 'text', 'datetime'].includes(field.type) ? field : undefined
  }
  const xField = axis(view.x)
  const yField = axis(view.y)
  if (!xField || !yField) return undefined
  const xColumns = axisColumns(rows, xField)
  const yColumns = axisColumns(rows, yField)
  // Object identity, as the grouped bar does: `axisColumns` already decided where each row goes.
  const xOf = new Map(xColumns.flatMap((column, index) => column.rows.map((row) => [row, index] as const)))

  const values = yColumns.map((yColumn) => {
    const cells = xColumns.map(() => [] as DashboardDisplayRow[])
    for (const row of yColumn.rows) cells[xOf.get(row)!]!.push(row)
    // An empty cell counts and sums to zero. An average of nothing has no value.
    return cells.map((cellRows) =>
      cellRows.length
        ? aggregateRows(cellRows, schema, view)
        : ['avg', 'min', 'max'].includes(view.aggregate ?? 'count')
          ? null
          : 0,
    )
  })
  const nonzero = values.flat().filter((value): value is number => value !== null && value !== 0)
  const low = Math.min(...nonzero)
  const high = Math.max(...nonzero)
  const text = (value: number | null) => (value === null ? 'no value' : axisNumber(schema, view, value))

  return {
    columns: xColumns.map(({ id, label }) => ({ id, label })),
    rows: yColumns.map((yColumn, yIndex) => ({
      id: yColumn.id,
      label: yColumn.label,
      cells: xColumns.map((xColumn, xIndex) => {
        const value = values[yIndex]![xIndex]!
        return {
          value,
          step: heatmapStep(value, low, high),
          name: `${yColumn.label}, ${xColumn.label}: ${text(value)}`,
        }
      }),
    })),
    xLabel: xField.name,
    yLabel: yField.name,
    measure: measureLabel(schema, view),
    ...(nonzero.length ? { legend: { low: text(low), high: text(high) } } : {}),
  }
}
