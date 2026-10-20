import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setRouteTestCapability, type AppEnv } from '@acorn/plugin-api/node'
import {
  legacyWorkflowScheduleRoutes,
  WORKFLOW_TRIGGERS_ROUTE,
  workflowTriggerRoutes,
  type WorkflowTriggersBridge,
} from './triggers'

const post = (path: string, body: unknown) =>
  new Request(`http://acorn.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const appFor = (principal: unknown) => {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('principal', principal as never)
    await next()
  })
  return app.route('/triggers', workflowTriggerRoutes).route('/schedules', legacyWorkflowScheduleRoutes)
}

const bridge = (overrides: Partial<WorkflowTriggersBridge> = {}): WorkflowTriggersBridge => ({
  list: async () => [],
  get: async (id) => ({ id }),
  defaults: async () => ({ timezone: 'UTC' }),
  prepare: async (input) => input,
  save: async (input) => input,
  approve: async (id, firstCheck, freshEpoch) => ({ id, firstCheck, freshEpoch }),
  pause: async (id, paused) => ({ id, paused }),
  runNow: async (id) => ({ id }),
  remove: async (id) => ({ id }),
  ...overrides,
})

describe('workflow trigger routes', () => {
  afterEach(() => setRouteTestCapability(WORKFLOW_TRIGGERS_ROUTE, null))

  it('keeps trigger bindings behind the device gate', async () => {
    const save = vi.fn(bridge().save)
    setRouteTestCapability(WORKFLOW_TRIGGERS_ROUTE, bridge({ save }))
    const response = await appFor({ kind: 'internal', scope: 'task', userId: 'owner', taskId: 'task' }).fetch(
      post('/triggers', { projectId: 'p', workflowId: 'w', when: { kind: 'clock', timezone: 'UTC' } }),
    )
    expect(response.status).toBe(403)
    expect(save).not.toHaveBeenCalled()
  })

  it('validates typed drafts and approval choices before the bridge', async () => {
    const save = vi.fn(bridge().save)
    const approve = vi.fn(bridge().approve)
    setRouteTestCapability(WORKFLOW_TRIGGERS_ROUTE, bridge({ save, approve }))
    const app = appFor({ kind: 'device', userId: 'owner', deviceId: 'device' })
    expect((await app.fetch(post('/triggers', { projectId: 'p', workflowId: 'w' }))).status).toBe(400)
    expect((await app.fetch(post('/triggers/id/approve', { firstCheck: 'maybe' }))).status).toBe(400)
    expect(save).not.toHaveBeenCalled()
    expect(approve).not.toHaveBeenCalled()
  })

  it('passes a bounded draft and explicit baseline choice to the workflow owner', async () => {
    const save = vi.fn(bridge().save)
    const approve = vi.fn(bridge().approve)
    setRouteTestCapability(WORKFLOW_TRIGGERS_ROUTE, bridge({ save, approve }))
    const app = appFor({ kind: 'device', userId: 'owner', deviceId: 'device' })
    const draft = {
      projectId: 'p',
      workflowId: 'w',
      when: { kind: 'clock', timezone: 'Pacific/Auckland' },
      inputs: { count: 2 },
    }
    expect((await app.fetch(post('/triggers', draft))).status).toBe(200)
    expect((await app.fetch(post('/triggers/id/approve', { firstCheck: 'track-now', freshEpoch: true }))).status).toBe(
      200,
    )
    expect(save).toHaveBeenCalledWith(draft)
    expect(approve).toHaveBeenCalledWith('id', 'track-now', true)
  })

  it('answers a client built before triggers on the schedules path in the shape it reads', async () => {
    const save = vi.fn(bridge().save)
    const view = { id: 't', when: { kind: 'clock', timezone: 'Pacific/Auckland' } }
    setRouteTestCapability(WORKFLOW_TRIGGERS_ROUTE, bridge({ save, list: async () => [view] }))
    const app = appFor({ kind: 'device', userId: 'owner', deviceId: 'device' })
    const saved = await app.fetch(post('/schedules', { projectId: 'p', workflowId: 'w', timezone: 'Pacific/Auckland' }))
    expect(saved.status).toBe(200)
    expect(save).toHaveBeenCalledWith({
      projectId: 'p',
      workflowId: 'w',
      when: { kind: 'clock', timezone: 'Pacific/Auckland' },
    })
    const listed = await app.fetch(new Request('http://acorn.test/schedules'))
    expect(await listed.json()).toEqual([{ ...view, timezone: 'Pacific/Auckland' }])
    expect(await (await app.fetch(new Request('http://acorn.test/triggers'))).json()).toEqual([view])
  })
})
