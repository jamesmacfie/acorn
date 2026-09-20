import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import type { Principal } from '../middleware/auth'
import type { AppEnv } from '../middleware/auth'
import { authoring } from './authoring'

const valid = {
  target: 'query', scope: { workspaceId: 'w1', projectId: 'p1' }, targetId: 'q1', baseRevision: 1,
  base: {}, backendId: 'connection:model', instruction: 'Add the active state.', context: [], samplesEnabled: false,
}

const app = (principal: Principal) => new Hono<AppEnv>()
  .use('*', async (c, next) => { c.set('principal', principal); await next() })
  .route('/authoring', authoring)

describe('authoring route admission', () => {
  it('refuses task and service principals before model or source access', async () => {
    for (const principal of [
      { kind: 'internal', userId: 'u1', scope: 'task', taskId: 't1' },
      { kind: 'internal', userId: 'u1', scope: 'service' },
    ] as const) {
      const response = await app(principal).request('/authoring/turn', { method: 'POST', body: JSON.stringify(valid), headers: { 'content-type': 'application/json' } })
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ error: { code: 'interactive_user_required' } })
    }
  })

  it('rejects workflow targets because the workflow plugin owns their validation and source bridge', async () => {
    const response = await app({ kind: 'device', userId: 'u1', deviceId: 'd1' }).request('/authoring/turn', {
      method: 'POST', body: JSON.stringify({ ...valid, target: 'workflow' }), headers: { 'content-type': 'application/json' },
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'invalid-request' } })
  })

  it('rejects unknown metadata-bearing fields at the public boundary', async () => {
    const response = await app({ kind: 'device', userId: 'u1', deviceId: 'd1' }).request('/authoring/turn', {
      method: 'POST', body: JSON.stringify({ ...valid, publish: true }), headers: { 'content-type': 'application/json' },
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'invalid-request' } })
  })
})
