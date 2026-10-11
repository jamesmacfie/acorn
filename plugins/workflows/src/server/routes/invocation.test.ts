import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setRouteTestCapability, type AppEnv } from '@acorn/plugin-api/node'
import { workflowInvocationRoutes } from './invocation'
import { WORKFLOW_INVOCATION_ROUTE, type WorkflowInvocationBridge } from './invocationBridge'

const post = (path: string, body: unknown) =>
  new Request(`http://acorn.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const appFor = (principal: unknown) => {
  const app = new Hono<AppEnv>()
  app.use('/invocation/*', async (c, next) => {
    c.set('principal', principal as never)
    await next()
  })
  return app.route('/invocation', workflowInvocationRoutes)
}

const approval = {
  projectId: 'project',
  definitionKey: 'db:flow',
  graphDigest: 'g',
  callerInputs: ['ticket'],
  fixedInputs: { area: 'billing' },
  limits: { maxTurns: 5, maxWallTimeMs: 600_000 },
  startsPerSession: 5,
}

describe('agent invocation routes', () => {
  afterEach(() => setRouteTestCapability(WORKFLOW_INVOCATION_ROUTE, null))

  it('keeps approvals away from an agent credential', async () => {
    const approve = vi.fn(async () => ({}) as never)
    setRouteTestCapability(WORKFLOW_INVOCATION_ROUTE, {
      review: vi.fn(),
      approve,
      revoke: vi.fn(),
    } as unknown as WorkflowInvocationBridge)
    const agent = appFor({ kind: 'internal', scope: 'task', userId: 'owner', taskId: 'task', sessionId: 'session' })
    expect((await agent.fetch(post('/invocation/approve', approval))).status).toBe(403)
    expect(approve).not.toHaveBeenCalled()
  })

  it('needs finite turn and time limits before the bridge sees an approval', async () => {
    const approve = vi.fn(async () => ({}) as never)
    setRouteTestCapability(WORKFLOW_INVOCATION_ROUTE, {
      review: vi.fn(),
      approve,
      revoke: vi.fn(),
    } as unknown as WorkflowInvocationBridge)
    const owner = appFor({ kind: 'device', userId: 'owner', deviceId: 'device' })
    const { maxTurns: _maxTurns, ...withoutTurns } = approval.limits
    expect((await owner.fetch(post('/invocation/approve', { ...approval, limits: withoutTurns }))).status).toBe(400)
    expect((await owner.fetch(post('/invocation/approve', { ...approval, startsPerSession: 0 }))).status).toBe(400)
    expect(approve).not.toHaveBeenCalled()
    expect((await owner.fetch(post('/invocation/approve', approval))).status).toBe(200)
    expect(approve).toHaveBeenCalledWith(approval)
  })
})
