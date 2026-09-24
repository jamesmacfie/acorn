import { describe, expect, it } from 'vitest'
import type { AgentTurn } from '@acorn/protocol/managedAgents.ts'
import { senderLabel } from './turnSender'

const turn = (source: AgentTurn['source'], input: AgentTurn['input'] = []): AgentTurn => ({
  id: 't', sessionId: 's', ordinal: 0, source, status: 'completed', input, effectivePolicy: {},
  providerTurnRef: null, stopReason: null, usage: null, error: null, attempt: 1,
  createdAt: 0, startedAt: null, completedAt: null,
})

const sender = (source: string, label: string): AgentTurn['input'][number] => ({
  type: 'context', contextId: 'c', label, content: '', source, capturedAt: 0,
})

describe('senderLabel', () => {
  it('names the reader for their own turns', () => {
    expect(senderLabel(undefined)).toBe('You')
    expect(senderLabel(turn('interactive'))).toBe('You')
  })

  it('names the other agent for delegated traffic', () => {
    expect(senderLabel(turn('delegation', [sender('delegation', 'Planner')]))).toBe('From Planner')
    expect(senderLabel(turn('delegation_report', [sender('delegation_report', 'Fix parser')]))).toBe('From Fix parser')
  })

  it('ignores an unrelated context part and falls back for older turns', () => {
    expect(senderLabel(turn('delegation', [sender('agents', 'History copied from X')]))).toBe('From the delegating agent')
  })
})
