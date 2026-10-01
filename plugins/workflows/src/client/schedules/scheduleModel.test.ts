import { describe, expect, it } from 'vitest'
import { cadenceForChoice, formatOccurrence, limitsSummary, nextScheduleOccurrences, scheduleStateLabel } from './scheduleModel'

describe('workflow schedule editor model', () => {
  it('shows three concrete timezone occurrences with their UTC offsets', () => {
    const occurrences = nextScheduleOccurrences({ daily: '09:00' }, 'Pacific/Auckland', Date.UTC(2026, 8, 20, 0), 3)
    expect(occurrences).toHaveLength(3)
    expect(formatOccurrence(occurrences[0]!, 'Pacific/Auckland')).toMatch(/GMT\+12|UTC\+12/)
  })

  it('uses elapsed time for intervals across a daylight-saving change', () => {
    const start = Date.UTC(2026, 8, 26, 13, 30)
    const occurrences = nextScheduleOccurrences({ every: 3600 }, 'Pacific/Auckland', start, 3)
    expect(occurrences).toEqual([start + 3_600_000, start + 7_200_000, start + 10_800_000])
  })

  it('keeps the UI vocabulary human-facing', () => {
    expect(scheduleStateLabel('needs-review')).toBe('Needs review')
    expect(cadenceForChoice('weekly')).toEqual({ weekly: { day: 1, at: '09:00' } })
    expect(limitsSummary({ maxDescendants: 80, maxConcurrency: 3, budget: { maxWallTimeMs: 7_200_000 } }))
      .toBe('Up to 80 tasks, 3 at a time, 120 minutes.')
  })
})
