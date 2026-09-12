import { describe, expect, it } from 'vitest'
import type { AgentEventRecord, AgentNormalizedEvent } from '@acorn/protocol/managedAgents.ts'
import { foldUsageEvents, mergeAgentUsage, openUsageLine } from './usageFold'

let seq = 0
const record = (turnId: string | null, event: AgentNormalizedEvent): AgentEventRecord => ({
  id: `e${++seq}`,
  sessionId: 's1',
  turnId,
  seq,
  schemaVersion: 1,
  event,
  searchText: null,
  createdAt: seq,
})
const usage = (turnId: string | null, fields: Record<string, unknown>) =>
  record(turnId, { type: 'usage', usage: fields })
const prose = (turnId: string | null, text: string) =>
  record(turnId, { type: 'assistant_message', text, messageId: 'm1' })

describe('folding usage rows to one line a turn', () => {
  it('leaves a run with no usage in it alone', () => {
    const events = [prose('t1', 'a'), prose('t1', 'b')]
    expect(foldUsageEvents(events)).toEqual(events)
  })

  it('collapses a turn’s updates onto the first of them', () => {
    const events = [
      prose('t1', 'thinking'),
      usage('t1', { contextUsed: 100 }),
      prose('t1', ' harder'),
      usage('t1', { contextUsed: 900, inputTokens: 12 }),
      usage('t1', { contextUsed: 1_800, outputTokens: 34 }),
    ]
    const folded = foldUsageEvents(events)
    expect(folded).toHaveLength(3)
    const line = folded[1]
    // The first update's envelope, so the card lands where it always landed and the seq order holds.
    expect(line.id).toBe(events[1].id)
    expect(line.seq).toBe(events[1].seq)
    expect(line.event).toEqual({ type: 'usage', usage: { contextUsed: 1_800, inputTokens: 12, outputTokens: 34 } })
  })

  it('gives each turn its own line', () => {
    const folded = foldUsageEvents([
      usage('t1', { contextUsed: 1 }),
      usage('t1', { contextUsed: 2 }),
      usage('t2', { contextUsed: 3 }),
      usage('t2', { contextUsed: 4 }),
    ])
    expect(folded).toHaveLength(2)
    expect(folded.map((item) => item.turnId)).toEqual(['t1', 't2'])
  })

  it('folds a trailing update that lost its turn id onto the open line', () => {
    // A turn's last usage update can arrive after the turn is marked complete. That is how a cost
    // joins a line that started with only a context count.
    const folded = foldUsageEvents([
      usage('t1', { contextUsed: 900 }),
      record('t1', { type: 'turn_completed' }),
      usage(null, { cost: { amount: 0.12, currency: 'USD' } }),
    ])
    expect(folded).toHaveLength(2)
    expect(folded[0].event).toEqual({
      type: 'usage',
      usage: { contextUsed: 900, cost: { amount: 0.12, currency: 'USD' } },
    })
  })

  it('collapses fifty-eight updates to one', () => {
    const events = Array.from({ length: 58 }, (_, at) => usage('t1', { contextUsed: at + 1 }))
    const folded = foldUsageEvents(events)
    expect(folded).toHaveLength(1)
    expect(folded[0].event).toEqual({ type: 'usage', usage: { contextUsed: 58 } })
  })

  it('never wipes a reported field with an absent one', () => {
    expect(mergeAgentUsage({ contextUsed: 5, cost: { amount: 1, currency: 'USD' } }, { contextUsed: 9 }))
      .toEqual({ contextUsed: 9, cost: { amount: 1, currency: 'USD' } })
  })

  it('points at the last usage record, or nowhere', () => {
    expect(openUsageLine([prose('t1', 'a')])).toBe(-1)
    expect(openUsageLine([usage('t1', {}), prose('t1', 'a'), usage('t2', {})])).toBe(2)
  })
})
