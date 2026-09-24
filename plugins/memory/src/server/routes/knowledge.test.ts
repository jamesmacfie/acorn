import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppEnv } from '@acorn/plugin-api/testkit'
import { requireUser } from '@acorn/plugin-api/testkit'
import type { Env } from '@acorn/plugin-api/testkit'
import { knowledge, setKnowledgeBridge, type KnowledgeBridge } from './knowledge'

const req = (path: string, method = 'GET', body?: unknown) => new Request(`http://acorn.test/api${path}`, {
  method,
  headers: body === undefined ? undefined : { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

const as = (principal: unknown) => new Hono<AppEnv>()
  .use('/api/*', async (c, next) => { c.set('principal', principal as never); await next() })
  .route('/api', knowledge)
const device = () => as({ kind: 'device', userId: 'james', deviceId: 'device-1' })
const task = () => as({ kind: 'internal', userId: 'james', scope: 'task', taskId: 'task1' })
const service = () => as({ kind: 'internal', userId: 'james', scope: 'service' })

const bridge = (over: Partial<KnowledgeBridge> = {}): KnowledgeBridge => ({
  memoryList: async () => [],
  memorySearch: async () => [],
  memoryAdd: async () => ({ path: '/x' }),
  ...over,
})

describe('memory routes', () => {
  afterEach(() => setKnowledgeBridge(null))

  it('routes memory list and add through its bridge', async () => {
    const calls: string[] = []
    setKnowledgeBridge(bridge({
      memoryList: async (projectId) => { calls.push(`list:${projectId}`); return [] },
      memoryAdd: async (taskId, input) => { calls.push(`add:${taskId}:${input.scope}`); return { path: '/x' } },
    }))
    const app = device()
    expect((await app.fetch(req('/memory?projectId=project-widget'), {} as Env)).status).toBe(200)
    expect((await app.fetch(req('/tasks/task1/memory', 'POST', { scope: 'private', name: 'n', description: 'd', type: 'reference', body: 'b' }), {} as Env)).status).toBe(200)
    expect(calls).toEqual(['list:project-widget', 'add:task1:private'])
  })

  it('rejects malformed memory input and a search with no query', async () => {
    setKnowledgeBridge(bridge())
    const app = device()
    expect((await app.fetch(req('/tasks/task1/memory', 'POST', { scope: 'nope' }), {} as Env)).status).toBe(400)
    expect((await app.fetch(req('/memory/search'), {} as Env)).status).toBe(400)
  })

  it('requires a principal and an available bridge', async () => {
    const gated = new Hono<AppEnv>().use('/api/*', requireUser).route('/api', knowledge)
    expect((await gated.fetch(req('/memory'), {} as Env)).status).toBe(401)
    expect((await device().fetch(req('/memory'), {} as Env)).status).toBe(503)
  })

  it('keeps findings approval device-gated', async () => {
    const calls: string[] = []
    setKnowledgeBridge(bridge({ memoryApproveFinding: async (id, input) => { calls.push(`${id}:${input.revision}:${input.deviceId}`); return { ok: true } } }))
    const body = { revision: 3, payloadHash: 'sha256', idempotencyKey: 'approve-1' }
    expect((await task().fetch(req('/memory/findings/candidate-1/approve', 'POST', body), {} as Env)).status).toBe(403)
    expect((await service().fetch(req('/memory/findings/candidate-1/approve', 'POST', body), {} as Env)).status).toBe(403)
    expect((await device().fetch(req('/memory/findings/candidate-1/approve', 'POST', body), {} as Env)).status).toBe(200)
    expect(calls).toEqual(['candidate-1:3:device-1'])
  })

  it('has no Notes routes', async () => {
    setKnowledgeBridge(bridge())
    for (const path of ['/workspaces/global/notes', '/workspaces/ws1/notes/slug', '/tasks/task1/notes']) {
      expect((await device().fetch(req(path), {} as Env)).status).toBe(404)
    }
  })
})
