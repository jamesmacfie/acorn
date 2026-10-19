import { describe, expect, it } from 'vitest'
import type { DashboardDisplayRow, DashboardDisplaySchema } from './display'
import { buildHeatmap, heatmapStep } from './heatmap'

const weekday = {
  id: 'day',
  name: 'Weekday',
  type: 'enum' as const,
  values: [
    { id: 'mon', label: 'Monday' },
    { id: 'tue', label: 'Tuesday' },
    { id: 'wed', label: 'Wednesday' },
  ],
}
const hour = {
  id: 'hour',
  name: 'Hour',
  type: 'enum' as const,
  values: [
    { id: '13', label: '13:00' },
    { id: '14', label: '14:00' },
  ],
}
const active = { id: 'active', name: 'Run time', type: 'number' as const, unit: 'ms' }
const schema: DashboardDisplaySchema = { fields: [weekday, hour, active] }
const row = (id: string, values: DashboardDisplayRow['values']): DashboardDisplayRow => ({
  id,
  values,
  pluginId: 'agents',
  sourceId: 'turns',
})
const sum = { kind: 'heatmap', x: 'hour', y: 'day', aggregate: 'sum' as const, field: 'active' }

describe('heatmap', () => {
  it('draws every value of both axes in declared order, the empty ones as step 0', () => {
    const map = buildHeatmap([row('1', { day: 'tue', hour: '14', active: 3_000 })], schema, sum)!
    expect(map.rows.map((entry) => entry.label)).toEqual(['Monday', 'Tuesday', 'Wednesday'])
    expect(map.columns.map((entry) => entry.label)).toEqual(['13:00', '14:00'])
    expect(map.rows.map((entry) => entry.cells.map((cell) => cell.step))).toEqual([
      [0, 0],
      [0, 5],
      [0, 0],
    ])
    expect(map.rows[1]!.cells[1]!.name).toBe('Tuesday, 14:00: 3,000 ms')
    expect(map.rows[0]!.cells[0]).toMatchObject({ value: 0, name: 'Monday, 13:00: 0 ms' })
    expect(map.legend).toEqual({ low: '3,000 ms', high: '3,000 ms' })
  })

  it('leaves an average over no rows without a value, and has no legend when nothing has one', () => {
    const map = buildHeatmap([], schema, { ...sum, aggregate: 'avg' })!
    expect(map.rows[0]!.cells[0]).toEqual({ value: null, step: 0, name: 'Monday, 13:00: no value' })
    expect(map.legend).toBeUndefined()
  })

  it('counts rows when no measure is named', () => {
    const map = buildHeatmap([row('1', { day: 'mon', hour: '13' }), row('2', { day: 'mon', hour: '13' })], schema, {
      kind: 'heatmap',
      x: 'hour',
      y: 'day',
    })!
    expect(map.rows[0]!.cells[0]!.value).toBe(2)
    expect(map.measure).toBe('Rows')
  })

  it('spreads nonzero values over five steps from the lowest to the highest', () => {
    expect([0, 1, 2, 3, 4, 5].map((value) => heatmapStep(value, 1, 5))).toEqual([0, 1, 2, 3, 4, 5])
    expect([1, 10].map((value) => heatmapStep(value, 1, 10))).toEqual([1, 5])
    expect(heatmapStep(null, 1, 10)).toBe(0)
    expect(heatmapStep(7, 7, 7)).toBe(5)
  })

  it('orders a summary date axis oldest first, after values the axis never declared', () => {
    const week = { id: 'week', name: 'Week', type: 'datetime' as const }
    const map = buildHeatmap(
      [
        row('1', { day: 'mon', week: '2026-10-12' }),
        row('2', { day: 'fri', week: '2026-10-05' }),
        row('3', { day: 'mon', week: null }),
      ],
      { fields: [weekday, week] },
      { kind: 'heatmap', x: 'week', y: 'day' },
    )!
    expect(map.columns.map((entry) => entry.id)).toEqual(['2026-10-05', '2026-10-12', expect.any(String)])
    expect(map.columns[2]!.label).toBe('Uncategorised')
    expect(map.rows.map((entry) => entry.id)).toEqual(['mon', 'tue', 'wed', 'fri'])
  })

  it('draws nothing when an axis is gone', () => {
    expect(buildHeatmap([], schema, { kind: 'heatmap', x: 'hour', y: 'missing' })).toBeUndefined()
    expect(buildHeatmap([], schema, { kind: 'heatmap', x: 'active', y: 'day' })).toBeUndefined()
  })
})
