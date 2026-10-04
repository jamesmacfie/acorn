import { describe, expect, it } from 'vitest'
import { emptyAgentPricingPreferences } from '../../shared/pricing'
import { usageRecords, type UsageEventInput } from './usageRecords'

const event = (id: string, at: number, model: string, inputTokens: number): UsageEventInput => ({
  id, at, model, sessionId: 'session', turnId: id, taskId: 'task', provider: 'codex',
  usage: { inputTokens, outputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0 },
})

describe('usage records', () => {
  it('makes event deltas before window filtering and prices each event at its model', () => {
    const records = usageRecords([
      event('before', Date.parse('2026-08-31T23:00:00Z'), 'gpt-6-luna', 100),
      event('inside', Date.parse('2026-09-01T01:00:00Z'), 'gpt-6-astra', 140),
    ], emptyAgentPricingPreferences())
    const inside = records.filter(record => record.data.at >= Date.parse('2026-09-01T00:00:00Z'))
    expect(inside).toHaveLength(1)
    expect(inside[0]?.data).toMatchObject({ model: 'gpt-6-astra', inputTokens: 40, costSource: 'estimated' })
  })

  it('leaves an unpriced model unknown', () => {
    const records = usageRecords([event('one', 1, 'future-model', 100)], emptyAgentPricingPreferences())
    expect(records[0]?.data).toMatchObject({ costUsd: null, costSource: 'unknown', priceName: null })
  })
})
