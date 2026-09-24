import { describe, expect, it } from 'vitest'
import type { AgentSession, AgentAttentionReason, AgentRuntimeState } from '../contract/wire'
import { fromManagedSession } from '../contract/attention'

const session = (over: Partial<AgentSession>): AgentSession => ({
  id: 's1', taskId: 't1', providerId: 'claude', profileId: 'p', kind: 'interactive',
  driverKind: 'd', driverVersion: '1', providerSessionRef: null, controller: 'acorn',
  runtimeState: 'working', attention: 'none', statusAuthority: 'protocol', title: 'claude',
  model: null, config: {}, parentSessionId: null, parentTurnId: null, subagents: [], queuedTurns: 0,
  lastEventSeq: 0, lastReadSeq: 0, archivedAt: null, createdAt: 0, updatedAt: 0, ...over,
})

describe('the managed adapter (docs/notifications.md)', () => {
  const state = (attention: AgentAttentionReason, runtimeState: AgentRuntimeState) =>
    fromManagedSession(session({ attention, runtimeState }), 'n1').state

  it('reads attention first, then the runtime state', () => {
    for (const reason of ['permission', 'question', 'workflow_gate'] as const)
      expect(state(reason, 'working')).toBe('blocked')
    expect(state('completed', 'ready')).toBe('finished')
    expect(state('error', 'working')).toBe('error')
    // An attention reason outranks the runtime state: a failed process still asking a question is
    // a question.
    expect(state('permission', 'failed')).toBe('blocked')
  })

  it('maps every runtime state when nothing is asking', () => {
    for (const reason of ['none', 'unread'] as const) {
      for (const running of ['working', 'waiting', 'cancelling', 'reconnecting', 'connecting', 'replaying', 'creating'] as const)
        expect(state(reason, running)).toBe('working')
      for (const resting of ['ready', 'stopped', 'archived'] as const)
        expect(state(reason, resting)).toBe('idle')
      expect(state(reason, 'failed')).toBe('error')
    }
  })

  it('falls back to the provider when a session has no title', () => {
    expect(fromManagedSession(session({ title: '' }), 'n1').title).toBe('claude')
  })
})
