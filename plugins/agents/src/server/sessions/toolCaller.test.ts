import { describe, expect, it, vi } from 'vitest'
import type { AgentSession } from '../../contract/wire.ts'
import { createToolCallers } from './toolCaller'

const session = (id: string, patch: Partial<AgentSession> = {}) =>
  ({ id, taskId: 'task', title: id, kind: 'interactive', config: {}, archivedAt: null, ...patch }) as AgentSession

const store = {
  getSession: async (id: string) =>
    (
      ({
        chat: session('chat'),
        step: session('step', { kind: 'workflow', config: { workflowRunId: 'run-1' } }),
        archived: session('archived', { archivedAt: 1 }),
        child: session('child', { kind: 'delegated', config: { delegationSpawnId: 'spawn-1' } }),
      }) as Record<string, AgentSession>
    )[id] ?? null,
  activeTurn: async (id: string) => (id === 'chat' ? ({ id: 'turn-1' } as never) : null),
}

describe('agents.toolCaller', () => {
  it('resolves only live sessions of the named task', async () => {
    const { lookup } = createToolCallers(store)
    expect(await lookup.resolve('task', 'chat')).toEqual({
      taskId: 'task',
      sessionId: 'chat',
      title: 'chat',
      workflowOwned: false,
      delegated: false,
      workflowRunId: null,
      activeTurnId: 'turn-1',
    })
    expect(await lookup.resolve('task', 'child')).toMatchObject({ delegated: true, workflowOwned: false })
    expect(await lookup.resolve('task', 'step')).toMatchObject({ workflowOwned: true, workflowRunId: 'run-1' })
    expect(await lookup.resolve('other-task', 'chat')).toBeNull()
    expect(await lookup.resolve('task', 'archived')).toBeNull()
    expect(await lookup.resolve('task', 'terminal-session')).toBeNull()
  })

  it('tells subscribers about settled turns only, and survives a failing one', () => {
    const callers = createToolCallers(store)
    const heard = vi.fn()
    callers.lookup.onTurnSettled(() => {
      throw new Error('subscriber bug')
    })
    const stop = callers.lookup.onTurnSettled(heard)
    const event = { taskId: 'task', sessionId: 'chat', turnId: 'turn-1', source: 'interactive', attempt: 0 } as const
    callers.turnChanged({ ...event, status: 'active' })
    callers.turnChanged({ ...event, status: 'cancelled' })
    expect(heard).toHaveBeenCalledExactlyOnceWith({
      taskId: 'task',
      sessionId: 'chat',
      turnId: 'turn-1',
      status: 'cancelled',
    })
    stop()
    callers.turnChanged({ ...event, status: 'completed' })
    expect(heard).toHaveBeenCalledTimes(1)
  })
})
