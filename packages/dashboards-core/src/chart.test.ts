import { describe, expect, it } from 'vitest'
import type { PluginCollectionRow, PluginCollectionSchema } from '@acorn/protocol/collections.ts'
import {
  buildChart,
  CHART_FRAME,
  chartAxisFields,
  chartSeriesFields,
  chartShapesFor,
  chartSupportedBy,
  dayBucket,
  defaultChartAxis,
  defaultChartView,
  niceTicks,
  TICK_FONT,
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

  it('always counts rows, and never pre-picks a number field to sum', () => {
    // The field vocabulary cannot tell a QUANTITY from an IDENTIFIER — `number` covers a size in MB and
    // github's pull request number alike — so summing "the first number there is" opened the PR panel
    // on the sum of PR numbers, an axis reaching 200,000 that meant nothing. A count always means
    // something, and the sum is one select away.
    expect(defaultChartView(schema(status, size), {})).toMatchObject({ aggregate: 'count' })
    expect(defaultChartView(schema(status, size), {}).field).toBeUndefined()
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
    // Against the plot's OWN frame, not a module constant: the left gutter is as wide as this chart's
    // labels needed, so a bounds check against a fixed number would pass for the wrong reason.
    for (const bar of plot.bars) {
      expect(bar.x).toBeGreaterThanOrEqual(plot.frame.plotLeft)
      expect(bar.x + bar.w).toBeLessThanOrEqual(plot.frame.plotLeft + plot.frame.plotWidth + 0.001)
      expect(bar.y).toBeGreaterThanOrEqual(plot.frame.plotTop - 0.001)
      expect(bar.y + bar.h).toBeLessThanOrEqual(plot.frame.baseline + 0.001)
    }
  })

  it('thins the labels rather than overprinting them', () => {
    const many = { id: 'kind', name: 'Kind', type: 'enum' as const, values: Array.from({ length: 20 }, (_, index) => ({ id: `v${index}`, label: `V${index}` })) }
    const plot = buildChart([], schema(many), { kind: 'chart', shape: 'bar', x: 'kind' }, {})
    if (plot?.shape !== 'bar') throw new Error('expected a bar chart')
    expect(plot.bars).toHaveLength(20)
    expect(plot.xTicks.length).toBeLessThanOrEqual(8)
  })

  it('gives a value DECLARED WITHOUT A TONE an identity slot, not the muted default', () => {
    // The plugin declared that the value exists, not what it means, so there is no meaning to keep —
    // and colouring every value of an untoned enum `muted` would make them all the same bar
    // (charts.md § 1: the ramp is for identity with no declared tone).
    const kind = { id: 'kind', name: 'Kind', type: 'enum' as const, values: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }
    const plot = buildChart([row('1', { kind: 'a' })], schema(kind), { kind: 'chart', shape: 'bar', x: 'kind' }, {})
    if (plot?.shape !== 'bar') throw new Error('expected a bar chart')
    expect(plot.bars.map((bar) => bar.series)).toEqual([1, 2])
  })

  it('draws no legend for an unsplit bar — its categories are named on the axis, not by a swatch', () => {
    const plot = buildChart(rows, schema(status), { kind: 'chart', shape: 'bar', x: 'state' }, {})
    expect(plot?.legend).toBeUndefined()
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

describe('the grouped bar', () => {
  const kind = {
    id: 'kind',
    name: 'Kind',
    type: 'enum' as const,
    values: [{ id: 'bug', label: 'Bug' }, { id: 'feat', label: 'Feature' }],
  }
  const rows = [
    row('1', { state: 'open', kind: 'bug' }),
    row('2', { state: 'open', kind: 'feat' }),
    row('3', { state: 'open', kind: 'feat' }),
    row('4', { state: 'merged', kind: 'bug' }),
  ]
  const grouped = { kind: 'chart' as const, shape: 'bar' as const, x: 'state', series: 'kind' }

  it('clusters one bar per series inside each category, on the shared measure scale', () => {
    const plot = buildChart(rows, schema(status, kind), grouped, {})
    if (plot?.shape !== 'bar') throw new Error('expected a bar chart')
    // Two categories × two series, and the arithmetic is the intersection of both bucketings.
    expect(plot.bars.map((bar) => [bar.label, bar.value]))
      .toEqual([['Open', 1], ['Merged', 1], ['Open', 2], ['Merged', 0]])
    // The x axis still names the CATEGORY once, at the centre of its cluster.
    expect(plot.xTicks.map((tick) => tick.label)).toEqual(['Open', 'Merged'])
  })

  it('offers the split only where a second enum exists, and never the category axis itself', () => {
    expect(chartSeriesFields(schema(status, kind), 'bar', { kind: 'chart', x: 'state' }, {}).map((f) => f.id))
      .toEqual(['kind'])
    expect(chartSeriesFields(schema(status), 'bar', { kind: 'chart', x: 'state' }, {})).toEqual([])
    // A line's axis is a datetime, so every enum is a candidate there.
    expect(chartSeriesFields(schema(status, updated), 'line', { kind: 'chart', x: 'updated' }, {}).map((f) => f.id))
      .toEqual(['state'])
  })

  it('ignores a split naming the category axis rather than drawing one bar per cluster', () => {
    const plot = buildChart(rows, schema(status, kind), { ...grouped, series: 'state' }, {})
    if (plot?.shape !== 'bar') throw new Error('expected a bar chart')
    expect(plot.bars).toHaveLength(2)
    expect(plot.legend).toBeUndefined()
  })

  it('colours by SERIES once split, and leaves the categories to the axis', () => {
    const plot = buildChart(rows, schema(status, kind), grouped, {})
    if (plot?.shape !== 'bar') throw new Error('expected a bar chart')
    // `kind` declares no tones, so the two series take identity slots — and the status enum's own
    // warn/ok never reach the marks, because the category is no longer what the colour answers.
    expect(plot.bars.map((bar) => bar.series)).toEqual([1, 1, 2, 2])
    expect(plot.bars.every((bar) => bar.tone === undefined)).toBe(true)
  })

  it('keeps every bar of a cluster inside the slot the ungrouped bar had', () => {
    const single = buildChart(rows, schema(status, kind), { kind: 'chart', shape: 'bar', x: 'state' }, {})
    const plot = buildChart(rows, schema(status, kind), grouped, {})
    if (plot?.shape !== 'bar' || single?.shape !== 'bar') throw new Error('expected bar charts')
    const cluster = single.bars[0]
    for (const bar of plot.bars.filter((entry) => entry.label === 'Open')) {
      expect(bar.x).toBeGreaterThanOrEqual(cluster.x - 0.001)
      expect(bar.x + bar.w).toBeLessThanOrEqual(cluster.x + cluster.w + 0.001)
    }
  })

  it('names the category AND the series in a bar’s tooltip', () => {
    const plot = buildChart(rows, schema(status, kind), grouped, {})
    if (plot?.shape !== 'bar') throw new Error('expected a bar chart')
    expect(plot.bars[0].title).toBe('Open · Bug: 1')
  })

  it('is INVISIBLE to a client that does not draw it — the old ungrouped bar, never nothing', () => {
    // The acceptance test charts.md § 3 set. `series` is a key the codec already round-trips, and the
    // pre-grouped-bar `buildBar` simply never read it: the same definition still answers a bar.
    const plot = buildChart(rows, schema(status, kind), grouped, {})
    expect(plot?.shape).toBe('bar')
  })
})

describe('the legend', () => {
  const kind = { id: 'kind', name: 'Kind', type: 'enum' as const }
  const day = (n: number) => n * DAY + 3_600_000

  it('carries the mark’s own colour attribute, so a swatch cannot drift from its mark', () => {
    const rows = [
      row('1', { updated: day(1), state: 'open' }),
      row('2', { updated: day(2), state: 'merged' }),
    ]
    const plot = buildChart(rows, schema(updated, status), { kind: 'chart', shape: 'line', x: 'updated', series: 'state' }, {})
    expect(plot?.legend).toEqual([
      { id: 'open', label: 'Open', tone: 'warn' },
      { id: 'merged', label: 'Merged', tone: 'ok' },
    ])
  })

  it('collapses the fold into one key that says how many went in', () => {
    const rows = ['a', 'b', 'c', 'd', 'e'].map((value, index) =>
      row(`${index}`, { updated: day(index + 1), kind: value }))
    const plot = buildChart(rows, schema(updated, kind), { kind: 'chart', shape: 'line', x: 'updated', series: 'kind' }, {})
    expect(plot?.legend?.map((key) => key.label)).toEqual(['a', 'b', 'c', 'Other (2)'])
    expect(plot?.legend?.slice(-1)[0].series).toBe('other')
  })

  it('is absent for a single series — one mark has no sibling to be told apart from', () => {
    const plot = buildChart([row('1', { updated: day(1) })], schema(updated), { kind: 'chart', shape: 'line', x: 'updated' }, {})
    expect(plot?.legend).toBeUndefined()
  })

  it('stands for the lines that DREW, not the columns that exist', () => {
    // `merged` is declared, so `boardColumns` keeps it — but no row carries it and no line is drawn,
    // so a swatch for it would stand for nothing on screen.
    const rows = [row('1', { updated: day(1), state: 'open' })]
    const plot = buildChart(rows, schema(updated, status), { kind: 'chart', shape: 'line', x: 'updated', series: 'state' }, {})
    expect(plot?.legend).toBeUndefined()
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
    expect(plot.lines[0].points[0].x).toBe(plot.frame.plotLeft + plot.frame.plotWidth / 2)
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
      expect(point.x).toBeGreaterThanOrEqual(plot.frame.plotLeft - 0.001)
      expect(point.x).toBeLessThanOrEqual(plot.frame.plotLeft + plot.frame.plotWidth + 0.001)
      expect(point.y).toBeGreaterThanOrEqual(plot.frame.plotTop - 0.001)
      expect(point.y).toBeLessThanOrEqual(plot.frame.baseline + 0.001)
    }
  })
})

describe('a day with no rows', () => {
  const day = (n: number) => n * DAY + 3_600_000
  const gappy = [row('1', { updated: day(1), size: 4 }), row('2', { updated: day(3), size: 6 })]
  const vertices = (path: string) => path.split(/[ML]/).filter(Boolean).length

  it('is a zero on the path, not a straight line across the gap', () => {
    const plot = buildChart(gappy, schema(updated, size), { kind: 'chart', shape: 'line', x: 'updated' }, {})
    if (plot?.shape !== 'line') throw new Error('expected a line chart')
    // Three days in the span, three vertices — the middle one on the floor. Joining day 1 straight to
    // day 3 drew "steady at 1" across a day on which nothing happened.
    expect(vertices(plot.lines[0].path)).toBe(3)
    const middle = plot.lines[0].path.split(/[ML]/).filter(Boolean)[1]
    expect(Number(middle.trim().split(' ')[1])).toBeCloseTo(plot.frame.baseline, 6)
  })

  it('gets no dot, so the tooltips stay on the days that have something to say', () => {
    const plot = buildChart(gappy, schema(updated, size), { kind: 'chart', shape: 'line', x: 'updated' }, {})
    if (plot?.shape !== 'line') throw new Error('expected a line chart')
    expect(plot.lines[0].points).toHaveLength(2)
  })

  it('is filled for a sum as well as a count — both are additive', () => {
    const plot = buildChart(gappy, schema(updated, size), { kind: 'chart', shape: 'line', x: 'updated', aggregate: 'sum', field: 'size' }, {})
    if (plot?.shape !== 'line') throw new Error('expected a line chart')
    expect(vertices(plot.lines[0].path)).toBe(3)
  })

  it('stays a gap for an average, a minimum or a maximum, which are undefined over no rows', () => {
    for (const aggregate of ['avg', 'min', 'max'] as const) {
      const plot = buildChart(gappy, schema(updated, size), { kind: 'chart', shape: 'line', x: 'updated', aggregate, field: 'size' }, {})
      if (plot?.shape !== 'line') throw new Error('expected a line chart')
      // Two real days, two vertices. A filled zero here would draw a dip to the floor that no row says
      // happened — "the average size on a day with no rows" has no answer, and 0 is not it.
      expect(vertices(plot.lines[0].path)).toBe(2)
    }
  })

  it('does not resurrect a declared series that has no rows at all', () => {
    // `merged` is a declared column `boardColumns` keeps, and filling every day of it would draw a flat
    // line along zero for a series nothing is in.
    const rows = [row('1', { updated: day(1), state: 'open' }), row('2', { updated: day(3), state: 'open' })]
    const plot = buildChart(rows, schema(updated, status), { kind: 'chart', shape: 'line', x: 'updated', series: 'state' }, {})
    if (plot?.shape !== 'line') throw new Error('expected a line chart')
    expect(plot.lines.map((line) => line.label)).toEqual(['Open'])
  })

  it('leaves a very wide span alone rather than filling more days than the box can draw', () => {
    const wide = [row('1', { updated: day(1) }), row('2', { updated: day(900) })]
    const plot = buildChart(wide, schema(updated), { kind: 'chart', shape: 'line', x: 'updated' }, {})
    if (plot?.shape !== 'line') throw new Error('expected a line chart')
    expect(vertices(plot.lines[0].path)).toBe(2)
  })
})

describe('the axis gutter', () => {
  const day = (n: number) => n * DAY + 3_600_000

  it('widens for the labels it actually has, so a big number is not sliced off at the edge', () => {
    const small = buildChart([row('1', { state: 'open', size: 2 })], schema(status, size), { kind: 'chart', shape: 'bar', x: 'state' }, {})
    const big = buildChart(
      Array.from({ length: 40 }, (_, index) => row(String(index), { state: 'open', size: 20_000 })),
      schema(status, size),
      { kind: 'chart', shape: 'bar', x: 'state', aggregate: 'sum', field: 'size' },
      {},
    )
    if (!small || !big) throw new Error('expected two charts')
    expect(big.frame.plotLeft).toBeGreaterThan(small.frame.plotLeft)
    // Whatever the labels, the widest of them fits in the gutter it asked for.
    for (const plot of [small, big]) {
      const widest = Math.max(...plot.yTicks.map((tick) => tick.label.length))
      expect(widest * TICK_FONT * 0.62).toBeLessThanOrEqual(plot.frame.plotLeft)
    }
  })

  it('never squeezes the plot away, however long a field formats its labels', () => {
    const plot = buildChart([row('1', { state: 'open', size: 987_654_321 })], schema(status, size), { kind: 'chart', shape: 'bar', x: 'state', aggregate: 'sum', field: 'size' }, {})
    if (!plot) throw new Error('expected a chart')
    expect(plot.frame.plotWidth).toBeGreaterThan(CHART_FRAME.width / 2)
  })

  it('anchors an end label inward rather than letting half of it hang outside the box', () => {
    // The last tick sits on the last gridline, a few units from the right edge — centred, "Aug 18" lost
    // its second digit off the side of the SVG.
    const rows = [row('1', { updated: day(1) }), row('2', { updated: day(40) })]
    const plot = buildChart(rows, schema(updated), { kind: 'chart', shape: 'line', x: 'updated' }, {})
    if (plot?.shape !== 'line') throw new Error('expected a line chart')
    expect(plot.xTicks.slice(-1)[0].anchor).toBe('end')
    for (const tick of plot.xTicks) {
      const half = (tick.label.length * TICK_FONT * 0.62) / 2
      const right = tick.anchor === 'end' ? tick.at : tick.anchor === 'start' ? tick.at + half * 2 : tick.at + half
      expect(right).toBeLessThanOrEqual(CHART_FRAME.width + 0.001)
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
