import { describe, expect, it } from 'vitest'
import { sessionCacheLabel, sessionCostLabel } from './sessionCostLabel'

describe('session cost label', () => {
  it('shows cents, and a floor below one cent', () => {
    expect(sessionCostLabel(0.012345, true)).toBe('≈$0.01')
    expect(sessionCostLabel(0.004, true)).toBe('≈<$0.01')
  })

  it('uses cents for larger and provider-reported amounts', () => {
    expect(sessionCostLabel(12.345, true)).toBe('≈$12.35')
    expect(sessionCostLabel(1.2, false)).toBe('$1.20')
  })

  it('describes the cache share, and writes only when reported', () => {
    expect(sessionCacheLabel({ inputTokens: 160_000, readTokens: 90_000, writeTokens: 15_000 }))
      .toBe('56% of 160K input tokens came from the prompt cache, 15K written to it.')
    expect(sessionCacheLabel({ inputTokens: 1_250_000, readTokens: 1_000_000, writeTokens: null }))
      .toBe('80% of 1.3M input tokens came from the prompt cache.')
  })
})
