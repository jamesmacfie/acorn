import { describe, expect, it } from 'vitest'
import {
  claudeModelPrice,
  emptyAgentPricingPreferences,
  parseAgentPricingPreferences,
  validateAgentPricingPreferences,
} from './pricing'

describe('agent pricing preferences', () => {
  it('includes Opus 5 in the built-in catalog', () => {
    expect(claudeModelPrice('claude-opus-5')).toEqual({
      input: 5,
      output: 25,
      cacheWrite: 6.25,
      cacheRead: 0.5,
    })
  })

  it('applies a catalog override and gives an exact model price priority', () => {
    const preferences = emptyAgentPricingPreferences()
    preferences.claude.overrides.push({
      catalogId: 'opus-5',
      price: { input: 6, output: 30, cacheWrite: 7.5, cacheRead: 0.6 },
    })
    preferences.claude.customModels.push({
      model: 'claude-opus-5',
      price: { input: 7, output: 35, cacheWrite: 8.75, cacheRead: 0.7 },
    })

    expect(claudeModelPrice('claude-opus-5', Date.now(), preferences)?.input).toBe(7)
    expect(claudeModelPrice('claude-opus-5-20260724', Date.now(), preferences)?.input).toBe(6)
  })

  it('rejects invalid prices, duplicate models, and unknown catalog ids', () => {
    const result = validateAgentPricingPreferences({
      version: 1,
      claude: {
        overrides: [{
          catalogId: 'missing',
          price: { input: -1, output: 1, cacheWrite: 1, cacheRead: 1 },
        }],
        customModels: [
          { model: 'same', price: { input: 1, output: 1, cacheWrite: 1, cacheRead: 1 } },
          { model: 'SAME', price: { input: 1, output: 1, cacheWrite: 1, cacheRead: 1 } },
        ],
      },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('unknown catalog id')
      expect(result.errors.join(' ')).toContain('must be between')
      expect(result.errors.join(' ')).toContain('duplicates')
    }
  })

  it('falls back to built-ins when persisted settings are malformed', () => {
    expect(parseAgentPricingPreferences('{bad')).toEqual(emptyAgentPricingPreferences())
    expect(parseAgentPricingPreferences(JSON.stringify({ version: 2 }))).toEqual(emptyAgentPricingPreferences())
  })
})
