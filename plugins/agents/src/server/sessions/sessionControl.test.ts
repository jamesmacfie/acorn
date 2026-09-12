import { describe, expect, it, vi } from 'vitest'
import { createSessionControl } from './sessionControl'

describe('workflow session cancellation', () => {
  it('cancels only a session owned by the supplied task', async () => {
    const cancelTurn = vi.fn(async () => undefined)
    const control = createSessionControl({
      store: {
        getSession: vi.fn(async (sessionId: string) => sessionId === 'session-1'
          ? { id: sessionId, taskId: 'task-1' }
          : undefined),
      } as never,
      cancelTurn,
    })

    await control.cancel('task-1', 'session-1')
    await expect(control.cancel('task-2', 'session-1')).rejects.toThrow('not found for this task')
    await expect(control.cancel('task-1', 'missing')).rejects.toThrow('not found for this task')
    expect(cancelTurn).toHaveBeenCalledTimes(1)
    expect(cancelTurn).toHaveBeenCalledWith('session-1')
  })
})
