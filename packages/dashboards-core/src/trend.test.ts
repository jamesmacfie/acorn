import { describe, expect, it } from 'vitest'
import type { PluginCollectionRow, PluginCollectionSchema } from '@acorn/protocol/collections.ts'
import { activityPoints, baselineValue, historyPoints, sparkline, TREND_DAYS, trendDelta } from './trend'

// A fake clock, always. Every function here takes `now` for exactly this reason: a trend is
// arithmetic over a window, and a test that read the wall clock would pass at 23:59 and fail at
// 00:01.
const DAY = 86_400_000
const NOW = Date.UTC(2026, 7, 17, 10, 30)
const day = (back: number) => Date.UTC(2026, 7, 17) - back * DAY

const schema: PluginCollectionSchema = {
  fields: [
    { id: 'updated', name: 'Updated', type: 'datetime', role: 'updated' },
    { id: 'size', name: 'Size', type: 'number' },
  ],
}
const row = (at: number, size = 1): PluginCollectionRow =>
  ({ id: `r${at}${size}`, pluginId: 'p', collectionId: 'c', values: { updated: at, size } })

describe('historyPoints', () => {
  it('draws the fortnight whatever the series covers, keeping the day’s last value', () => {
    const points = historyPoints([
      { bucket: day(1) + 3 * 3_600_000, value: 5 },
      { bucket: day(1) + 9 * 3_600_000, value: 7 },
      { bucket: day(0), value: 9 },
    ], NOW)

    expect(points).toHaveLength(TREND_DAYS)
    expect(points[TREND_DAYS - 1]).toEqual({ day: day(0), value: 9 })
    // The day's LAST value, not its first and not an average: a stat shows point-in-time state.
    expect(points[TREND_DAYS - 2]).toEqual({ day: day(1), value: 7 })
  })

  it('leaves a day with no sample as a gap rather than interpolating it', () => {
    const points = historyPoints([{ bucket: day(3), value: 4 }, { bucket: day(1), value: 6 }], NOW)
    expect(points[TREND_DAYS - 3]).toEqual({ day: day(2), value: null })
  })
})

describe('activityPoints', () => {
  it('counts the rows that changed each day, and a quiet day is a zero rather than a gap', () => {
    const points = activityPoints([row(day(0)), row(day(0)), row(day(2))], schema, { kind: 'stat' }, NOW)
    expect(points[TREND_DAYS - 1].value).toBe(2)
    // Nothing changed yesterday — that is a fact about the rows, not an absence of knowledge.
    expect(points[TREND_DAYS - 2].value).toBe(0)
    expect(points[TREND_DAYS - 3].value).toBe(1)
  })

  it('uses the panel’s own measure, not a count it invented', () => {
    const points = activityPoints([row(day(0), 3), row(day(0), 4)], schema, { kind: 'stat', aggregate: 'sum', field: 'size' }, NOW)
    expect(points[TREND_DAYS - 1].value).toBe(7)
  })

  it('draws nothing for a schema with no datetime to bucket by', () => {
    expect(activityPoints([], { fields: [{ id: 'n', name: 'N', type: 'text' }] }, { kind: 'stat' }, NOW)).toEqual([])
  })
})

describe('sparkline', () => {
  const points = (values: (number | null)[]) => values.map((value, index) => ({ day: day(values.length - 1 - index), value }))

  it('breaks the line at a gap instead of drawing across it', () => {
    const mark = sparkline(points([1, 2, null, 4, 5]))!
    expect(mark.segments).toHaveLength(2)
    expect(mark.dots).toEqual([])
  })

  it('draws an isolated day as a dot, since a one-point run has no line', () => {
    const mark = sparkline(points([1, null, 3, null, 5]))!
    expect(mark.segments).toEqual([])
    expect(mark.dots).toHaveLength(3)
  })

  it('puts the end dot on the most recent day that has a value, not on the window’s edge', () => {
    const withGap = sparkline(points([1, 2, 3, null, null]))!
    const solid = sparkline(points([1, 2, 3, 4, 5]))!
    expect(withGap.end.x).toBeLessThan(solid.end.x)
  })

  it('answers nothing for a series with no values yet — the cold state is not an empty box', () => {
    expect(sparkline(points([null, null]))).toBeUndefined()
  })

  it('centres a flat series rather than dividing by zero', () => {
    const mark = sparkline(points([4, 4, 4]))!
    expect(mark.segments[0].line).toBe('M3 14 L60 14 L117 14')
  })
})

describe('baselineValue', () => {
  const samples = [
    { bucket: NOW - 30 * DAY, value: 100 },
    { bucket: NOW - 8 * DAY, value: 20 },
    { bucket: NOW - 7 * DAY - 3_600_000, value: 30 },
    { bucket: NOW - 2 * DAY, value: 40 },
    { bucket: NOW, value: 50 },
  ]

  it('takes the newest sample at or before the window, never one after it', () => {
    expect(baselineValue(samples, 'week', NOW)).toBe(30)
  })

  it('says nothing when the nearest sample is further back than twice the window', () => {
    expect(baselineValue([{ bucket: NOW - 30 * DAY, value: 100 }], 'week', NOW)).toBeUndefined()
    // …and an empty series is the same answer: absence, not zero.
    expect(baselineValue([], 'day', NOW)).toBeUndefined()
  })
})

describe('trendDelta', () => {
  const samples = [{ bucket: NOW - 8 * DAY, value: 4 }]

  it('draws nothing without a comparison, a measure, or a baseline', () => {
    expect(trendDelta(6, samples, { kind: 'stat' }, NOW)).toBeUndefined()
    expect(trendDelta(null, samples, { kind: 'stat', compare: 'week' }, NOW)).toBeUndefined()
    expect(trendDelta(6, [], { kind: 'stat', compare: 'week' }, NOW)).toBeUndefined()
  })

  it('is neutral until the panel says which direction is good', () => {
    expect(trendDelta(6, samples, { kind: 'stat', compare: 'week' }, NOW)).toEqual({ change: 2, tone: 'muted' })
  })

  it('tones by the declared direction, both ways round', () => {
    expect(trendDelta(6, samples, { kind: 'stat', compare: 'week', good: 'up' }, NOW)?.tone).toBe('ok')
    expect(trendDelta(6, samples, { kind: 'stat', compare: 'week', good: 'down' }, NOW)?.tone).toBe('bad')
    expect(trendDelta(2, samples, { kind: 'stat', compare: 'week', good: 'down' }, NOW)?.tone).toBe('ok')
  })

  it('keeps no change neutral even where a direction is declared', () => {
    expect(trendDelta(4, samples, { kind: 'stat', compare: 'week', good: 'up' }, NOW)).toEqual({ change: 0, tone: 'muted' })
  })
})
