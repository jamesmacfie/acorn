import { describe, expect, it } from 'vitest'
import { sessionCostLabel } from './sessionCostLabel'

describe('session cost label', () => {
  it('shows cents, and a floor below one cent', () => {
    expect(sessionCostLabel(0.012345, true)).toBe('≈$0.01')
    expect(sessionCostLabel(0.004, true)).toBe('≈<$0.01')
  })

  it('uses cents for larger and provider-reported amounts', () => {
    expect(sessionCostLabel(12.345, true)).toBe('≈$12.35')
    expect(sessionCostLabel(1.2, false)).toBe('$1.20')
  })
})
