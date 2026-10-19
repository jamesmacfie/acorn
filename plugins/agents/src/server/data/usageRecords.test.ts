import { describe, expect, it } from 'vitest'
import { emptyAgentPricingPreferences } from '../../shared/pricing'
import { usageRecords, type UsageEventInput } from './usageRecords'

const event = (id: string, at: number, model: string, inputTokens: number): UsageEventInput => ({
  id,
  at,
  model,
  sessionId: 'session',
  turnId: id,
  taskId: 'task',
  provider: 'codex',
  usage: { inputTokens, outputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0 },
})

describe('usage records', () => {
  it('makes event deltas before window filtering and prices each event at its model', () => {
    const records = usageRecords(
      [
        event('before', Date.parse('2026-08-31T23:00:00Z'), 'gpt-6-luna', 100),
        event('inside', Date.parse('2026-09-01T01:00:00Z'), 'gpt-6-astra', 140),
      ],
      emptyAgentPricingPreferences(),
    )
    const inside = records.filter((record) => record.data.at >= Date.parse('2026-09-01T00:00:00Z'))
    expect(inside).toHaveLength(1)
    expect(inside[0]?.data).toMatchObject({ model: 'gpt-6-astra', inputTokens: 40, costSource: 'estimated' })
  })

  it("counts a reported cost from the session's previous report, because it is the session's running total", () => {
    const report = (id: string, turnId: string, amount: number): UsageEventInput => ({
      ...event(id, 1, 'claude-fable-5-1', 0),
      provider: 'claude',
      turnId,
      usage: { contextUsed: 1_000, cost: { amount, currency: 'USD' } },
    })
    const records = usageRecords(
      [report('first', 'turn-1', 0.31), report('second', 'turn-2', 0.64), report('third', 'turn-2', 0.7)],
      emptyAgentPricingPreferences(),
    )
    expect(records.map((record) => Number(record.data.costUsd?.toFixed(2)))).toEqual([0.31, 0.33, 0.06])
    expect(records.every((record) => record.data.costSource === 'reported')).toBe(true)
  })

  it('leaves an unpriced model unknown', () => {
    const records = usageRecords([event('one', 1, 'future-model', 100)], emptyAgentPricingPreferences())
    expect(records[0]?.data).toMatchObject({ costUsd: null, costSource: 'unknown', priceName: null })
  })
})
