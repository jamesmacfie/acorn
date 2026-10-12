import { Hono } from 'hono'
import { afterEach, expect, it } from 'vitest'
import type { AppEnv, Env } from '@acorn/plugin-api/testkit'
import { agentInstructionReview, setAgentInstructionReviewBridge } from './instructionReview'
import type { InstructionAdmission } from '../sessions/instructionAdmission'

const request = (path: string, method = 'GET', body?: unknown) =>
  new Request(`http://acorn.test/api/agents${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
const app = (kind: 'device' | 'task' | 'service') => {
  const router = new Hono<AppEnv>()
  router.use('/api/*', async (c, next) => {
    c.set(
      'principal',
      (kind === 'device'
        ? { kind: 'device', userId: 'owner' }
        : { kind: 'internal', userId: 'owner', scope: kind, taskId: 'task' }) as never,
    )
    await next()
  })
  return router.route('/api/agents', agentInstructionReview)
}
afterEach(() => setAgentInstructionReviewBridge(null))

it('requires a device before reading or approving instruction bodies', async () => {
  const calls: string[] = []
  setAgentInstructionReviewBridge({
    projects: async () => {
      calls.push('projects')
      return []
    },
    admission: async () => {
      calls.push('admission')
      return {} as InstructionAdmission
    },
  })
  for (const kind of ['task', 'service'] as const) {
    const client = app(kind)
    expect((await client.fetch(request('/instruction-review/projects'), {} as Env)).status).toBe(403)
    expect((await client.fetch(request('/instruction-review?projectId=project'), {} as Env)).status).toBe(403)
    expect(
      (await client.fetch(request('/instruction-review/review/approve', 'POST', { projectId: 'project' }), {} as Env))
        .status,
    ).toBe(403)
  }
  expect(calls).toEqual([])
})

it('reports drift as a conflict and accepts a device review', async () => {
  const calls: string[] = []
  setAgentInstructionReviewBridge({
    projects: async () => [{ id: 'project', name: 'Project' }],
    admission: async () =>
      ({
        review: async (id: string) => {
          calls.push(`review:${id}`)
          return { id: 'review' }
        },
        approve: async (projectId: string, id: string) => {
          calls.push(`approve:${projectId}:${id}`)
          throw new Error('changed')
        },
      }) as unknown as InstructionAdmission,
  })
  const client = app('device')
  expect((await client.fetch(request('/instruction-review?projectId=project'), {} as Env)).status).toBe(200)
  expect(
    (await client.fetch(request('/instruction-review/review/approve', 'POST', { projectId: 'project' }), {} as Env))
      .status,
  ).toBe(409)
  expect(calls).toEqual(['review:project', 'approve:project:review'])
})

it('returns an actionable incomplete result when required discovery fails', async () => {
  setAgentInstructionReviewBridge({
    projects: async () => [],
    admission: async () =>
      ({
        review: async () => {
          throw new Error('Cannot read AGENTS.md')
        },
      }) as unknown as InstructionAdmission,
  })
  const response = await app('device').fetch(request('/instruction-review?projectId=project'), {} as Env)
  expect(response.status).toBe(422)
  expect(await response.text()).toContain('Retry')
})
