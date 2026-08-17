import { describe, expect, it } from 'vitest'
import type { PluginCollectionRow, PluginCollectionSchema } from '@acorn/protocol/collections.ts'
import {
  buildChart,
  CHART_FRAME,
  chartAxisFields,
  chartShapesFor,
  chartSupportedBy,
  dayBucket,
  defaultChartAxis,
  defaultChartView,
  niceTicks,
} from './chart'
import { viewsForSchema } from './model'

// The chart's arithmetic. `ChartView.tsx` cannot be tested here — vitest runs in node with no Solid
// plugin — so everything that can be wrong lives in `chart.ts` and is checked below.

const DAY = 86_400_000

const schema = (...fields: PluginCollectionSchema['fields']): PluginCollectionSchema => ({ fields })

const status = {
  id: 'state',
  name: 'State',
  type: 'enum' as const,
  role: 'status' as const,
  values: [
    { id: 'open', label: 'Open', tone: 'warn' as const },
    { id: 'merged', label: 'Merged', tone: 'ok' as const },
  ],
}
const updated = { id: 'updated', name: 'Updated', type: 'datetime' as const, role: 'updated' as const }
const size = { id: 'size', name: 'Size', type: 'number' as const, unit: 'MB' }
const title = { id: 'title', name: 'Title', type: 'text' as const, role: 'title' as const }

const row = (id: string, values: PluginCollectionRow['values']): PluginCollectionRow =>
  ({ id, values, pluginId: 'github', collectionId: 'pulls-mine' })

describe('what a schema can chart', () => {
  it('offers bar for an enum, line for a datetime, both for both', () => {
    expect(chartShapesFor(schema(status))).toEqual(['bar'])
    expect(chartShapesFor(schema(updated))).toEqual(['line'])
    expect(chartShapesFor(schema(status, updated))).toEqual(['bar', 'line'])
  })

  it('offers nothing for a schema with numbers but no axis to draw them against', () => {
    expect(chartShapesFor(schema(title, size))).toEqual([])
    expect(chartSupportedBy(schema(title, size))).toBe(false)
  })

  it('agrees with the view gate in model.ts, which spells the same predicate separately', () => {
    for (const candidate of [schema(status), schema(updated), schema(title, size), schema()]) {
      expect(viewsForSchema(candidate).includes('chart')).toBe(chartSupportedBy(candidate))
    }
  })

  it('offers only fields of the type the shape needs', () => {
    expect(chartAxisFields(schema(status, updated, size), 'bar').map((field) => field.id)).toEqual(['state'])
    expect(chartAxisFields(schema(status, updated, size), 'line').map((field) => field.id)).toEqual(['updated'])
  })
})

describe('type-inferred defaults', () => {
  it('prefers a time axis, and the updated-role field on it', () => {
    const view = defaultChartView(schema(status, updated, size), {})
    expect(view.shape).toBe('line')
    expect(view.x).toBe('updated')
  })

  it('falls back to a bar keyed on the status-role enum', () => {
    const other = { id: 'kind', name: 'Kind', type: 'enum' as const }
    const view = defaultChartView(schema(other, status), {})
    expect(view.shape).toBe('bar')
    expect(view.x).toBe('state')
  })

  it('takes the panel’s existing grouping over the role, so board → chart keeps the categories', () => {
    const other = { id: 'kind', name: 'Kind', type: 'enum' as const }
    expect(defaultChartAxis(schema(status, other), 'bar', { groupBy: 'kind' })).toBe('kind')
  })

  it('measures the first number when there is one, and counts rows when there is not', () => {
    expect(defaultChartView(schema(status, size), {})).toMatchObject({ aggregate: 'sum', field: 'size' })
    expect(defaultChartView(schema(status), {})).toMatchObject({ aggregate: 'count' })
  })

  it('splits a line into series only where the grouping was already a decision', () => {
    expect(defaultChartView(schema(status, updated), {}).series).toBeUndefined()
    expect(defaultChartView(schema(status, updated), { groupBy: 'state' }).series).toBe('state')
  })
})

describe('niceTicks', () => {
  it('walks the 1/2/5 ladder from zero', () => {
    expect(niceTicks(10)).toEqual([0, 2, 4, 6, 8, 10])
    expect(niceTicks(9)).toEqual([0, 2, 4, 6, 8, 10])
    expect(niceTicks(1)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
  })

  it('always reaches at least the maximum, so nothing draws above the top gridline', () => {
    for (const max of [1, 3, 7, 11, 23, 47, 99, 1234, 0.07]) {
      expect(niceTicks(max).slice(-1)[0]).toBeGreaterThanOrEqual(max)
    }
  })

  it('always starts at zero, so a bar chart cannot lie about its baseline', () => {
    expect(niceTicks(1000)[0]).toBe(0)
  })

  it('answers a single tick rather than dividing by zero on an empty chart', () => {
    expect(niceTicks(0)).toEqual([0])
    expect(niceTicks(Number.NaN)).toEqual([0])
  })

  it('does not leak floating-point accumulation into a label', () => {
    for (const value of niceTicks(0.3)) expect(String(value)).not.toMatch(/0{6}|9{6}/)
  })
})

describe('bar charts', () => {
  const rows = [
    row('1', { state: 'open', size: 3 }),
    row('2', { state: 'open', size: 1 }),
    row('3', { state: 'merged', size: 6 }),
  ]

  it('counts rows per declared value, in declaration order', () => {
    const plot = buildChart(rows, schema(status, size), { kind: 'chart', shape: 'bar', x: 'state' }, {})
    expect(plot?.shape).toBe('bar')
    if (plot?.shape !== 'bar') return
    expect(plot.bars.map((bar) => [bar.label, bar.value])).toEqual([['Open', 2], ['Merged', 1]])
  })

  it('aggregates a number field instead when the measure names one', () => {
    const plot = buildChart(rows, schema(status, size), { kind: 'chart', shape: 'bar', x: 'state', aggregate: 'sum', field: 'size' }, {})
    if (plot?.shape !== 'bar') throw new Error('expected a bar chart')
    expect(plot.bars.map((bar) => bar.value)).toEqual([4, 6])
  })

  it('keeps the tone the plugin declared for a value, rather than inventing one', () => {
    const plot = buildChart(rows, schema(status), { kind: 'chart', shape: 'bar', x: 'state' }, {})
    if (plot?.shape !== 'bar') throw new Error('expected a bar chart')
    expect(plot.bars.map((bar) => bar.tone)).toEqual(['warn', 'ok'])
    // A declared value carries NO series slot: identity colour has no job where meaning is declared.
    expect(plot.bars.every((bar) => bar.series === undefined)).toBe(true)
  })

  it('gives an undeclared category an identity slot, never a status tone', () => {
    const kind = { id: 'kind', name: 'Kind', type: 'enum' as const }
    const undeclared = ['a', 'b', 'c', 'd', 'e'].map((value, index) => row(`${index}`, { kind: value }))
    const plot = buildChart(undeclared, schema(kind), { kind: 'chart', shape: 'bar', x: 'kind' }, {})
    if (plot?.shape !== 'bar') throw new Error('expected a bar chart')
    // Three slots then the fold — and not one of them borrows ok/warn/bad, which is the whole point
    // of the decision (charts.md § 1).
    expect(plot.bars.map((bar) => bar.series)).toEqual([1, 2, 3, 'other', 'other'])
    expect(plot.bars.every((bar) => bar.tone === undefined)).toBe(true)
  })

  it('draws a declared value with no rows as a zero-height bar rather than dropping the column', () => {
    const plot = buildChart([row('1', { state: 'open' })], schema(status), { kind: 'chart', shape: 'bar', x: 'state' }, {})
    if (plot?.shape !== 'bar') throw new Error('expected a bar chart')
    expect(plot.bars).toHaveLength(2)
    expect(plot.bars[1].h).toBe(0)
  })

  it('keeps every bar inside the plot area', () => {
    const plot = buildChart(rows, schema(status, size), { kind: 'chart', shape: 'bar', x: 'state', aggregate: 'sum', field: 'size' }, {})
    if (plot?.shape !== 'bar') throw new Error('expected a bar chart')
    for (const bar of plot.bars) {
      expect(bar.x).toBeGreaterThanOrEqual(CHART_FRAME.plotLeft)
      expect(bar.x + bar.w).toBeLessThanOrEqual(CHART_FRAME.plotLeft + CHART_FRAME.plotWidth + 0.001)
      expect(bar.y).toBeGreaterThanOrEqual(CHART_FRAME.plotTop - 0.001)
      expect(bar.y + bar.h).toBeLessThanOrEqual(CHART_FRAME.baseline + 0.001)
    }
  })

  it('thins the labels rather than overprinting them', () => {
    const many = { id: 'kind', name: 'Kind', type: 'enum' as const, values: Array.from({ length: 20 }, (_, index) => ({ id: `v${index}`, label: `V${index}` })) }
    const plot = buildChart([], schema(many), { kind: 'chart', shape: 'bar', x: 'kind' }, {})
    if (plot?.shape !== 'bar') throw new Error('expected a bar chart')
    expect(plot.bars.filter((bar) => bar.labelled).length).toBeLessThanOrEqual(8)
  })

  it('falls back to the shaping group-by when the view names no axis', () => {
    const plot = buildChart(rows, schema(status), { kind: 'chart', shape: 'bar' }, { groupBy: 'state' })
    if (plot?.shape !== 'bar') throw new Error('expected a bar chart')
    expect(plot.xLabel).toBe('State')
  })

  it('reads the units off the field, so an axis of MB says MB', () => {
    const plot = buildChart(rows, schema(status, size), { kind: 'chart', shape: 'bar', x: 'state', aggregate: 'sum', field: 'size' }, {})
    if (plot?.shape !== 'bar') throw new Error('expected a bar chart')
    expect(plot.yTicks.some((tick) => tick.label.includes('MB'))).toBe(true)
  })
})

describe('line charts', () => {
  const day = (n: number) => n * DAY + 3_600_000

  it('buckets by day and counts within the bucket', () => {
    const rows = [
      row('1', { updated: day(1) }),
      row('2', { updated: day(1) + 1000 }),
      row('3', { updated: day(3) }),
    ]
    const plot = buildChart(rows, schema(updated), { kind: 'chart', shape: 'line', x: 'updated' }, {})
    if (plot?.shape !== 'line') throw new Error('expected a line chart')
    expect(plot.lines).toHaveLength(1)
    expect(plot.lines[0].points).toHaveLength(2)
    expect(plot.lines[0].points[0].label).toContain('2')
  })

  it('sorts points by time whatever order the rows arrived in', () => {
    const rows = [row('1', { updated: day(9) }), row('2', { updated: day(2) })]
    const plot = buildChart(rows, schema(updated), { kind: 'chart', shape: 'line', x: 'updated' }, {})
    if (plot?.shape !== 'line') throw new Error('expected a line chart')
    const [first, second] = plot.lines[0].points
    expect(first.x).toBeLessThan(second.x)
  })

  it('splits into one line per declared enum value when a series is named', () => {
    const rows = [
      row('1', { updated: day(1), state: 'open' }),
      row('2', { updated: day(2), state: 'merged' }),
    ]
    const plot = buildChart(rows, schema(updated, status), { kind: 'chart', shape: 'line', x: 'updated', series: 'state' }, {})
    if (plot?.shape !== 'line') throw new Error('expected a line chart')
    expect(plot.lines.map((line) => line.label)).toEqual(['Open', 'Merged'])
    expect(plot.lines.map((line) => line.tone)).toEqual(['warn', 'ok'])
    expect(plot.lines.every((line) => line.series === undefined)).toBe(true)
  })

  it('colours an undeclared series split by identity slot, and folds past the third', () => {
    const kind = { id: 'kind', name: 'Kind', type: 'enum' as const }
    const rows = ['a', 'b', 'c', 'd'].map((value, index) => row(`${index}`, { updated: day(index + 1), kind: value }))
    const plot = buildChart(rows, schema(updated, kind), { kind: 'chart', shape: 'line', x: 'updated', series: 'kind' }, {})
    if (plot?.shape !== 'line') throw new Error('expected a line chart')
    expect(plot.lines.map((line) => line.series)).toEqual([1, 2, 3, 'other'])
    expect(plot.lines.every((line) => line.tone === undefined)).toBe(true)
  })

  it('leaves the single unsplit line on accent — one mark has no sibling to be told apart from', () => {
    const plot = buildChart([row('1', { updated: day(1) })], schema(updated), { kind: 'chart', shape: 'line', x: 'updated' }, {})
    if (plot?.shape !== 'line') throw new Error('expected a line chart')
    expect(plot.lines[0].tone).toBe('accent')
    expect(plot.lines[0].series).toBeUndefined()
  })

  it('draws a single-day series as points with no path, centred rather than dividing by zero', () => {
    const plot = buildChart([row('1', { updated: day(4) })], schema(updated), { kind: 'chart', shape: 'line', x: 'updated' }, {})
    if (plot?.shape !== 'line') throw new Error('expected a line chart')
    expect(plot.lines[0].path).toBe('')
    expect(plot.lines[0].points[0].x).toBe(CHART_FRAME.plotLeft + CHART_FRAME.plotWidth / 2)
  })

  it('ignores a row whose time cell is missing or unparseable', () => {
    const rows = [row('1', { updated: day(1) }), row('2', { updated: null }), row('3', { updated: 'soon' })]
    const plot = buildChart(rows, schema(updated), { kind: 'chart', shape: 'line', x: 'updated' }, {})
    if (plot?.shape !== 'line') throw new Error('expected a line chart')
    expect(plot.lines[0].points).toHaveLength(1)
  })

  it('answers an empty plot rather than nothing when no row carries a time', () => {
    const plot = buildChart([row('1', { updated: null })], schema(updated), { kind: 'chart', shape: 'line', x: 'updated' }, {})
    if (plot?.shape !== 'line') throw new Error('expected a line chart')
    expect(plot.lines).toEqual([])
    expect(plot.xTicks).toEqual([])
  })

  it('keeps every point inside the plot area', () => {
    const rows = Array.from({ length: 12 }, (_, index) => row(String(index), { updated: day(index), size: index }))
    const plot = buildChart(rows, schema(updated, size), { kind: 'chart', shape: 'line', x: 'updated', aggregate: 'max', field: 'size' }, {})
    if (plot?.shape !== 'line') throw new Error('expected a line chart')
    for (const point of plot.lines[0].points) {
      expect(point.x).toBeGreaterThanOrEqual(CHART_FRAME.plotLeft - 0.001)
      expect(point.x).toBeLessThanOrEqual(CHART_FRAME.plotLeft + CHART_FRAME.plotWidth + 0.001)
      expect(point.y).toBeGreaterThanOrEqual(CHART_FRAME.plotTop - 0.001)
      expect(point.y).toBeLessThanOrEqual(CHART_FRAME.baseline + 0.001)
    }
  })
})

describe('a definition the schema can no longer draw', () => {
  it('answers undefined rather than an empty chart, so the view can say so', () => {
    expect(buildChart([], schema(title, size), { kind: 'chart', shape: 'bar' }, {})).toBeUndefined()
    expect(buildChart([], schema(title, size), { kind: 'chart', shape: 'line' }, {})).toBeUndefined()
  })

  it('draws whatever the schema supports when the definition names no shape at all', () => {
    expect(buildChart([], schema(updated), { kind: 'chart' }, {})?.shape).toBe('line')
    expect(buildChart([], schema(status), { kind: 'chart' }, {})?.shape).toBe('bar')
  })
})

describe('dayBucket', () => {
  it('floors to UTC midnight', () => {
    expect(dayBucket(3 * DAY + 1)).toBe(3 * DAY)
    expect(dayBucket(3 * DAY)).toBe(3 * DAY)
  })
})
