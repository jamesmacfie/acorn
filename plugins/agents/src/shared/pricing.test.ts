import { describe, expect, it } from 'vitest'
import {
  claudeModelPrice,
  codexModelPrice,
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

  it('prices Opus 5.5 on its own rather than as Opus 5', () => {
    expect(claudeModelPrice('claude-opus-5-5')).toEqual({
      input: 4,
      output: 20,
      cacheWrite: 5,
      cacheRead: 0.2,
    })
    expect(claudeModelPrice('claude-opus-5-20260724')?.input).toBe(5)
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

  it('includes the Codex model catalog and applies Codex overrides', () => {
    const preferences = emptyAgentPricingPreferences()
    expect(codexModelPrice('gpt-6-astra', Date.now(), preferences)).toEqual({
      input: 10,
      output: 50,
      cacheWrite: 12.5,
      cacheRead: 1,
    })
    expect(codexModelPrice('gpt-5.6-terra', Date.now(), preferences)?.input).toBe(2)
    expect(codexModelPrice('gpt-6-sol', Date.now(), preferences)?.input).toBe(2)
    expect(codexModelPrice('gpt-6-luna', Date.now(), preferences)?.cacheRead).toBe(0.01)
    expect(codexModelPrice('gpt-6.1-sol', Date.now(), preferences)?.cacheRead).toBe(0.1)
    expect(codexModelPrice('gpt-5.5', Date.now(), preferences)?.output).toBe(30)
    expect(codexModelPrice('gpt-5.5', Date.now(), preferences)?.cacheWrite).toBe(5)
    expect(codexModelPrice('gpt-5.5-pro', Date.now(), preferences)).toBeNull()
    preferences.codex.overrides.push({
      catalogId: 'gpt-5-6-terra',
      price: { input: 3, output: 13, cacheWrite: 3.75, cacheRead: 0.3 },
    })
    expect(codexModelPrice('gpt-5.6-terra', Date.now(), preferences)?.input).toBe(3)
  })

  it('prices dated snapshots without assigning base prices to distinct model variants', () => {
    expect(codexModelPrice('gpt-5.5-2026-04-23')?.input).toBe(5)
    expect(codexModelPrice('gpt-6.1-sol-2026-09-29')?.cacheRead).toBe(0.1)
    for (const model of ['gpt-5.6-pro', 'gpt-5.6-cyber', 'gpt-6-astra-pro', 'gpt-6-sol-unknown']) {
      expect(codexModelPrice(model), model).toBeNull()
    }
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

  it('normalizes old Claude-only version-1 settings without losing overrides', () => {
    const parsed = parseAgentPricingPreferences(JSON.stringify({
      version: 1,
      claude: {
        overrides: [{
          catalogId: 'opus-5',
          price: { input: 6, output: 30, cacheWrite: 7.5, cacheRead: 0.6 },
        }],
        customModels: [],
      },
    }))
    expect(parsed.claude.overrides).toHaveLength(1)
    expect(parsed.codex).toEqual({ overrides: [], customModels: [] })
  })
})
