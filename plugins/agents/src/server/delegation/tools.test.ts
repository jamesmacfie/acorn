import { describe, expect, it, vi } from 'vitest'
import type { AgentDelegationService } from './service'
import { delegationTools } from './tools'

describe('delegation agent tools', () => {
  it('registers all tools as task-scoped, session-required, execute-tier contributions', () => {
    const service = {
      canSpawn: vi.fn(async () => true),
      spawn: vi.fn(),
      prompt: vi.fn(),
      wait: vi.fn(),
      read: vi.fn(),
      cancel: vi.fn(),
    } as unknown as AgentDelegationService
    expect(delegationTools(service).map(({ name, scope, risk, requiresSession }) => ({
      name,
      scope,
      risk,
      requiresSession,
    }))).toEqual([
      { name: 'agent_spawn', scope: 'task', risk: 'execute', requiresSession: true },
      { name: 'agent_prompt', scope: 'task', risk: 'execute', requiresSession: true },
      { name: 'agent_wait', scope: 'task', risk: 'execute', requiresSession: true },
      { name: 'agent_read', scope: 'task', risk: 'execute', requiresSession: true },
      { name: 'agent_cancel', scope: 'task', risk: 'execute', requiresSession: true },
    ])

    const spawn = delegationTools(service).find((tool) => tool.name === 'agent_spawn')!
    expect(spawn.input.parse({ title: 'Child', prompt: 'Work independently.', isolation: 'worktree' }))
      .toMatchObject({ isolation: 'worktree' })
  })
})
