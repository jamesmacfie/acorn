import { describe, expect, it } from 'vitest'
import { resolveContextTime } from './contextTime'

describe('context time', () => {
  it('freezes relative instants at the evaluation time', () => {
    const evaluationTime = Date.parse('2026-10-03T04:00:00Z')
    expect(resolveContextTime({ from: 'context', name: 'now', offset: '-P7D' }, evaluationTime,
      { zone: 'Pacific/Auckland', weekStart: 'monday' })).toBe(evaluationTime - 7 * 86_400_000)
  })

  it('finds the local week boundary across a daylight saving change', () => {
    const evaluationTime = Date.parse('2026-10-03T04:00:00Z')
    expect(resolveContextTime({ from: 'context', name: 'calendar', boundary: 'startOfWeek', offset: '-P1W' },
      evaluationTime, { zone: 'Pacific/Auckland', weekStart: 'monday' }))
      .toBe(Date.parse('2026-09-20T12:00:00Z'))
  })
})
