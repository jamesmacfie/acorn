import { describe, expect, it } from 'vitest'
import type { AgentSession, AgentSessionSnapshot, AgentTurn } from '@acorn/protocol/managedAgents.ts'
import { emptyAgentPricingPreferences } from '../../shared/pricing'
import { sessionHeaderContext } from './sessionHeaderContext'

const session = (): AgentSession => ({
  id: 'session-1', taskId: 'task-1', providerId: 'codex', profileId: 'codex', kind: 'interactive',
  driverKind: 'codex', driverVersion: '1', providerSessionRef: 'thread-1', controller: 'acorn',
  runtimeState: 'ready', attention: 'none', statusAuthority: 'protocol', title: 'Session', model: null,
  config: {}, parentSessionId: null, parentTurnId: null, subagents: [], queuedTurns: 0,
  lastEventSeq: 0, lastReadSeq: 0, archivedAt: null, createdAt: 1, updatedAt: 1,
})

const turn = (): AgentTurn => ({
  id: 'turn-1', sessionId: 'session-1', ordinal: 1, source: 'interactive', status: 'active', input: [],
  effectivePolicy: { providerAdvertisedPolicy: [{ category: 'model', value: 'gpt-5.6-terra' }] },
  providerTurnRef: null, stopReason: null, usage: { inputTokens: 10 }, error: null, attempt: 1,
  createdAt: 1, startedAt: 1, completedAt: null,
})

describe('agent session header context', () => {
  it('folds the live usage line and resolves the captured model price', () => {
    const row = session()
    const currentTurn = turn()
    const snapshot: AgentSessionSnapshot = {
      session: row,
      turns: [currentTurn],
      events: [{
        id: 'event-1', sessionId: row.id, turnId: currentTurn.id, seq: 1, schemaVersion: 1,
        event: { type: 'usage', usage: { inputTokens: 100, cachedInputTokens: 20 } },
        searchText: null, createdAt: 2,
      }],
      requests: [],
    }
    expect(sessionHeaderContext('task-1', row, snapshot, emptyAgentPricingPreferences())).toMatchObject({
      providerId: 'codex',
      tokenAccounting: 'cumulative',
      costAccounting: 'cumulative',
      turns: [{
        turnId: 'turn-1',
        model: 'gpt-5.6-terra',
        usage: { inputTokens: 100, cachedInputTokens: 20 },
        price: { input: 2, output: 12, cacheWrite: 2.5, cacheRead: 0.2 },
      }],
    })
  })

  it('declares independent accounting for a provider whose usage belongs to each turn', () => {
    const row = { ...session(), providerId: 'claude', profileId: 'claude', driverKind: 'acp' }
    expect(sessionHeaderContext('task-1', row, undefined, emptyAgentPricingPreferences()))
      .toMatchObject({ tokenAccounting: 'per-turn', costAccounting: 'per-turn' })
  })
})
