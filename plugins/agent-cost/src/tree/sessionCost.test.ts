import { describe, expect, it } from 'vitest'
import { estimateSessionCost } from './sessionCost'
import type { SessionHeaderProps, SessionHeaderTurn } from './sessionHeaderContract'

const price = { input: 2, output: 12, cacheWrite: 2.5, cacheRead: 0.2 }
const turn = (
  turnId: string,
  usage: SessionHeaderTurn['usage'],
  turnPrice: SessionHeaderTurn['price'] = price,
): SessionHeaderTurn => ({ turnId, model: 'gpt-5.6-terra', usage, price: turnPrice })
const context = (
  turns: SessionHeaderTurn[],
  over: Partial<SessionHeaderProps> = {},
): SessionHeaderProps => ({
  taskId: 'task-1', sessionId: 'session-1', providerId: 'codex',
  tokenAccounting: 'cumulative', costAccounting: 'cumulative', turns, ...over,
})

describe('session cost estimate', () => {
  it('prices cumulative token counters as deltas', () => {
    const result = estimateSessionCost(context([
      turn('turn-1', { inputTokens: 100_000, outputTokens: 10_000, cachedInputTokens: 40_000 }),
      turn('turn-2', { inputTokens: 160_000, outputTokens: 16_000, cachedInputTokens: 70_000 }),
    ]))
    expect(result).toEqual({ amountUsd: 0.386, source: 'estimated' })
  })

  it('uses each turn price and supports per-turn counters', () => {
    const result = estimateSessionCost(context([
      turn('turn-1', { inputTokens: 100_000 }, { input: 0.2, output: 1.2, cacheWrite: 0.25, cacheRead: 0.02 }),
      turn('turn-2', { inputTokens: 100_000 }),
    ], { tokenAccounting: 'per-turn' }))
    expect(result?.amountUsd).toBeCloseTo(0.22)
  })

  it('prefers provider-reported USD and observes its accounting mode', () => {
    const turns = [
      turn('turn-1', { cost: { amount: 0.2, currency: 'USD' } }, null),
      turn('turn-2', { cost: { amount: 0.42, currency: 'USD' } }, null),
    ]
    expect(estimateSessionCost(context(turns))).toEqual({ amountUsd: 0.42, source: 'provider' })
    expect(estimateSessionCost(context(turns, { costAccounting: 'per-turn' })))
      .toEqual({ amountUsd: 0.62, source: 'provider' })
  })

  it('declines unknown prices and regressing cumulative counters', () => {
    expect(estimateSessionCost(context([turn('turn-1', { inputTokens: 10 }, null)]))).toBeNull()
    expect(estimateSessionCost(context([
      turn('turn-1', { inputTokens: 10 }),
      turn('turn-2', { inputTokens: 9 }),
    ]))).toBeNull()
  })
})
