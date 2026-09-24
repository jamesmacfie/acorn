import { describe, expect, it } from 'vitest'
import { eventTime } from './eventTime'

describe('agent event time', () => {
  it('formats one instant in the reader timezone with an explicit zone and offset', () => {
    const at = Date.parse('2026-09-25T03:24:18Z')
    const auckland = eventTime(at, 'en-NZ', 'Pacific/Auckland')
    const london = eventTime(at, 'en-GB', 'Europe/London')

    expect(auckland.full).toContain('Pacific/Auckland')
    expect(auckland.full).toContain('GMT+12')
    expect(london.full).toContain('Europe/London')
    expect(london.full).toContain('GMT+1')
    expect(auckland.short).not.toBe(london.short)
  })
})
