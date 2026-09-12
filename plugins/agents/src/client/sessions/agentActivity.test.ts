import { describe, expect, it } from 'vitest'
import type { AgentRuntimeState, AgentSession } from '@acorn/protocol/managedAgents.ts'
import { canStopAgent } from './agentActivity'

const RUNTIME_STATES: AgentRuntimeState[] = [
  'creating',
  'connecting',
  'replaying',
  'ready',
  'working',
  'waiting',
  'cancelling',
  'reconnecting',
  'stopped',
  'failed',
  'archived',
]

const stoppable = (state: AgentRuntimeState) => canStopAgent({ runtimeState: state } as AgentSession)

describe('canStopAgent', () => {
  it('covers the states a cancel request can reach, and only those', () => {
    expect(RUNTIME_STATES.filter(stoppable)).toEqual(['working', 'waiting', 'cancelling'])
  })

  it('lets a second stop through while the first is still landing', () => {
    expect(stoppable('cancelling')).toBe(true)
  })
})
