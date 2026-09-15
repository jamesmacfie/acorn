import { describe, expect, it } from 'vitest'
import { sessionCostLabel } from './sessionCostLabel'

describe('session cost label', () => {
  it('keeps useful precision for small estimates', () => {
    expect(sessionCostLabel(0.012345, true)).toBe('≈$0.0123')
    expect(sessionCostLabel(0.00001, true)).toBe('≈<$0.0001')
  })

  it('uses cents for larger and provider-reported amounts', () => {
    expect(sessionCostLabel(12.345, true)).toBe('≈$12.35')
    expect(sessionCostLabel(1.2, false)).toBe('$1.20')
  })
})
