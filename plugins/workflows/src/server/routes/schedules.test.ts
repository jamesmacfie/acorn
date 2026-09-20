import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setRouteTestCapability, type AppEnv } from '@acorn/plugin-api/node'
import { WORKFLOW_SCHEDULES_ROUTE, workflowScheduleRoutes, type WorkflowSchedulesBridge } from './schedules'

const post = (path: string, body: unknown) => new Request(`http://acorn.test${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})

const appFor = (principal: unknown) => {
  const app = new Hono<AppEnv>()
  app.use('/schedules/*', async (c, next) => { c.set('principal', principal as never); await next() })
  return app.route('/schedules', workflowScheduleRoutes)
}

const bridge = (overrides: Partial<WorkflowSchedulesBridge> = {}): WorkflowSchedulesBridge => ({
  list: async () => [],
  get: async id => ({ id }),
  defaults: async () => ({ timezone: 'UTC' }),
  prepare: async input => input,
  save: async input => input,
  approve: async (id, firstCheck, freshEpoch) => ({ id, firstCheck, freshEpoch }),
  pause: async (id, paused) => ({ id, paused }),
  runNow: async id => ({ id }),
  remove: async id => ({ id }),
  ...overrides,
})

describe('workflow schedule routes', () => {
  afterEach(() => setRouteTestCapability(WORKFLOW_SCHEDULES_ROUTE, null))

  it('keeps schedule bindings behind the device gate', async () => {
    const save = vi.fn(bridge().save)
    setRouteTestCapability(WORKFLOW_SCHEDULES_ROUTE, bridge({ save }))
    const response = await appFor({ kind: 'internal', scope: 'task', userId: 'owner', taskId: 'task' })
      .fetch(post('/schedules', { projectId: 'p', workflowId: 'w', timezone: 'UTC' }))
    expect(response.status).toBe(403)
    expect(save).not.toHaveBeenCalled()
  })

  it('validates typed drafts and approval choices before the bridge', async () => {
    const save = vi.fn(bridge().save)
    const approve = vi.fn(bridge().approve)
    setRouteTestCapability(WORKFLOW_SCHEDULES_ROUTE, bridge({ save, approve }))
    const app = appFor({ kind: 'device', userId: 'owner', deviceId: 'device' })
    expect((await app.fetch(post('/schedules', { projectId: 'p', workflowId: 'w' }))).status).toBe(400)
    expect((await app.fetch(post('/schedules/id/approve', { firstCheck: 'maybe' }))).status).toBe(400)
    expect(save).not.toHaveBeenCalled()
    expect(approve).not.toHaveBeenCalled()
  })

  it('passes a bounded draft and explicit baseline choice to the workflow owner', async () => {
    const save = vi.fn(bridge().save)
    const approve = vi.fn(bridge().approve)
    setRouteTestCapability(WORKFLOW_SCHEDULES_ROUTE, bridge({ save, approve }))
    const app = appFor({ kind: 'device', userId: 'owner', deviceId: 'device' })
    const draft = { projectId: 'p', workflowId: 'w', timezone: 'Pacific/Auckland', inputs: { count: 2 } }
    expect((await app.fetch(post('/schedules', draft))).status).toBe(200)
    expect((await app.fetch(post('/schedules/id/approve', { firstCheck: 'track-now', freshEpoch: true }))).status).toBe(200)
    expect(save).toHaveBeenCalledWith(draft)
    expect(approve).toHaveBeenCalledWith('id', 'track-now', true)
  })
})
