import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import type { AppEnv, CoreServices, Principal } from '@acorn/plugin-api/node'
import { testGate } from '@acorn/plugin-api/testkit'
import { taskPulls } from './taskPulls'

const request = (principal: Principal, taskId: string, tasks: CoreServices['tasks']) => {
  const app = new Hono<AppEnv>().use('/api/*', ...testGate(principal)).route('/api/tasks', taskPulls({ tasks }))
  return app.request(`/api/tasks/${taskId}/pulls`)
}

describe('task pull relations', () => {
  it('does not expose another task to a task-confined principal', async () => {
    const tasks = {
      load: vi.fn(),
      changeRequests: vi.fn(),
    } as unknown as CoreServices['tasks']

    const response = await request(
      { kind: 'internal', userId: 'owner', scope: 'task', taskId: 'task-a' },
      'task-b',
      tasks,
    )

    expect(response.status).toBe(404)
    expect(tasks.load).not.toHaveBeenCalled()
    expect(tasks.changeRequests).not.toHaveBeenCalled()
  })

  it('returns durable relations for the principal own task', async () => {
    const tasks = {
      load: vi.fn().mockResolvedValue({ id: 'task-a' }),
      changeRequests: vi.fn().mockResolvedValue([
        {
          taskId: 'task-a',
          provider: 'github',
          host: 'github.com',
          path: 'acme/widget',
          number: 42,
          role: 'related',
          provenance: 'agent',
          sessionId: 'session-1',
        },
        // Linked on the task rather than by an agent, so not a durable agent relation.
        {
          taskId: 'task-a',
          provider: 'github',
          host: 'github.com',
          path: 'acme/widget',
          number: 41,
          role: 'primary',
          provenance: 'task',
        },
      ]),
    } as unknown as CoreServices['tasks']

    const response = await request(
      { kind: 'internal', userId: 'owner', scope: 'task', taskId: 'task-a' },
      'task-a',
      tasks,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      pulls: [
        {
          pull: { owner: 'acme', repo: 'widget', number: '42' },
          role: 'related',
          provenance: 'agent',
          sessionId: 'session-1',
        },
      ],
    })
  })
})
