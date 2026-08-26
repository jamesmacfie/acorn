import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workspace } from '@acorn/protocol/api.ts'
import { getDb } from '../db'
import type { AppEnv } from '../middleware/auth'
import { workspaces } from './workspaces'
import { makeTestDb, type TestDb } from '../../testkit/db'
import type { Env } from '../../main/bindings'

vi.mock('../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db')>()
  return { ...actual, getDb: vi.fn() }
})

const makeApp = () => {
  const app = new Hono<AppEnv>()
  app.use('/api/*', async (c, next) => {
    c.set('principal', { kind: 'device', userId: 'james' })
    await next()
  })
  app.route('/api/workspaces', workspaces)
  return app
}

const jsonReq = (url: string, method: string, body: unknown) =>
  new Request(`http://acorn.test${url}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('workspace identity', () => {
  let t: TestDb
  let app: Hono<AppEnv>

  beforeEach(() => {
    t = makeTestDb()
    vi.mocked(getDb).mockReturnValue(t.db)
    app = makeApp()
  })

  afterEach(() => t.cleanup())

  const create = async (): Promise<Workspace> => {
    const res = await app.fetch(jsonReq('/api/workspaces', 'POST', { name: 'Runn' }), {} as Env)
    expect(res.status).toBe(200)
    return (await res.json()) as Workspace
  }

  const read = async (id: string): Promise<Workspace | undefined> => {
    const res = await app.fetch(new Request('http://acorn.test/api/workspaces'), {} as Env)
    const all = (await res.json()) as Workspace[]
    return all.find((w) => w.id === id)
  }

  it('PATCHes a workspace name and reads it back', async () => {
    const w = await create()
    const res = await app.fetch(jsonReq(`/api/workspaces/${w.id}`, 'PATCH', { name: 'Acorn' }), {} as Env)
    expect(res.status).toBe(200)
    const back = await read(w.id)
    expect(back?.name).toBe('Acorn')
  })

  it('rejects an empty or unrelated patch', async () => {
    const w = await create()
    expect((await app.fetch(jsonReq(`/api/workspaces/${w.id}`, 'PATCH', {}), {} as Env)).status).toBe(400)
    expect((await app.fetch(jsonReq(`/api/workspaces/${w.id}`, 'PATCH', { color: 'green' }), {} as Env)).status).toBe(400)
    expect((await app.fetch(jsonReq(`/api/workspaces/${w.id}`, 'PATCH', { name: 'Acorn', icon: { kind: 'github' } }), {} as Env)).status).toBe(400)
  })

  it('404s a PATCH for an unknown workspace id', async () => {
    const res = await app.fetch(jsonReq('/api/workspaces/nope', 'PATCH', { name: 'Ghost' }), {} as Env)
    expect(res.status).toBe(404)
  })
  // Build/run/db/preview config (including the AI schema source) is repository-scoped and is set via
  // the repo-path config route, not this workspace route.
})
