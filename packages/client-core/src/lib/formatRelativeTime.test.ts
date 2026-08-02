import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from './formatRelativeTime'

describe('formatRelativeTime', () => {
  const now = Date.UTC(2026, 5, 23, 12)

  it('formats missing and current timestamps quietly', () => {
    expect(formatRelativeTime(null, now)).toBe('')
    expect(formatRelativeTime(now - 10_000, now)).toBe('now')
  })

  it('formats minutes, hours, days, and months', () => {
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5m ago')
    expect(formatRelativeTime(now - 2 * 60 * 60_000, now)).toBe('2h ago')
    expect(formatRelativeTime(now - 3 * 24 * 60 * 60_000, now)).toBe('3d ago')
    expect(formatRelativeTime(now - 65 * 24 * 60 * 60_000, now)).toBe('2mo ago')
  })
})
