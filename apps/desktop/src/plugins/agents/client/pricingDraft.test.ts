import { describe, expect, it } from 'vitest'
import { emptyAgentPricingPreferences } from '../shared/pricing'
import {
  blankAgentPriceDraft,
  preferencesFromPricingDraft,
  pricingDraftFromPreferences,
} from './pricingDraft'

describe('agent pricing settings draft', () => {
  it('does not persist unchanged built-in prices', () => {
    const draft = pricingDraftFromPreferences(emptyAgentPricingPreferences(), new Date(2026, 6, 29).getTime())
    const result = preferencesFromPricingDraft(draft)
    expect(result).toMatchObject({
      ok: true,
      value: { claude: { overrides: [], customModels: [] } },
    })
  })

  it('turns edited and exact rows into validated preferences', () => {
    const draft = pricingDraftFromPreferences(emptyAgentPricingPreferences())
    const opus = draft.catalog.find((entry) => entry.catalogId === 'opus-5')
    if (!opus) throw new Error('missing Opus 5 draft')
    opus.overridden = true
    opus.price.input = '6.5'
    draft.customModels.push({
      id: 'new:1',
      model: 'claude-future',
      price: { input: '1', output: '2', cacheWrite: '1.25', cacheRead: '0.1' },
    })

    expect(preferencesFromPricingDraft(draft)).toMatchObject({
      ok: true,
      value: {
        claude: {
          overrides: [{ catalogId: 'opus-5', price: { input: 6.5 } }],
          customModels: [{ model: 'claude-future', price: { output: 2 } }],
        },
      },
    })
  })

  it('rejects a blank custom row instead of treating blank prices as zero', () => {
    const draft = pricingDraftFromPreferences(emptyAgentPricingPreferences())
    draft.customModels.push({ id: 'new:1', model: 'claude-future', price: blankAgentPriceDraft() })
    expect(preferencesFromPricingDraft(draft).ok).toBe(false)
  })
})
