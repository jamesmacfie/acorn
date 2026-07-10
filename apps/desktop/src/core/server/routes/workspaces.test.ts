import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workspace } from '../../shared/api'
import { getDb } from '../db'
import type { AppEnv } from '../middleware/auth'
import { workspaces } from './workspaces'
import { makeTestDb, type TestDb } from './testDb'

vi.mock('../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db')>()
  return { ...actual, getDb: vi.fn() }
})

const makeApp = () => {
  const app = new Hono<AppEnv>()
  app.use('/api/*', async (c, next) => {
    c.set('principal', { kind: 'user', user: { token: 'token', login: 'james', name: '', avatar: '', scopes: [] } })
    await next()
  })
  app.route('/api/workspaces', workspaces)
  return app
}

const jsonReq = (url: string, method: string, body: unknown) =>
  new Request(`http://acorn.test${url}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('workspace icon + colour', () => {
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
    return res.json()
  }

  const read = async (id: string): Promise<Workspace | undefined> => {
    const res = await app.fetch(new Request('http://acorn.test/api/workspaces'), {} as Env)
    const all: Workspace[] = await res.json()
    return all.find((w) => w.id === id)
  }

  it('PATCHes icon + colour and reads them back', async () => {
    const w = await create()
    expect(w.icon).toBeNull()
    expect(w.color).toBeNull()
    const res = await app.fetch(jsonReq(`/api/workspaces/${w.id}`, 'PATCH', { icon: { kind: 'emoji', value: '🌰' }, color: 'green' }), {} as Env)
    expect(res.status).toBe(200)
    const back = await read(w.id)
    expect(back?.icon).toEqual({ kind: 'emoji', value: '🌰' })
    expect(back?.color).toBe('green')
  })

  it('clears icon/colour with explicit null', async () => {
    const w = await create()
    await app.fetch(jsonReq(`/api/workspaces/${w.id}`, 'PATCH', { icon: { kind: 'github' }, color: '#8250df' }), {} as Env)
    const res = await app.fetch(jsonReq(`/api/workspaces/${w.id}`, 'PATCH', { icon: null, color: null }), {} as Env)
    expect(res.status).toBe(200)
    const back = await read(w.id)
    expect(back?.icon).toBeNull()
    expect(back?.color).toBeNull()
  })

  it('rejects invalid icon or colour payloads', async () => {
    const w = await create()
    expect((await app.fetch(jsonReq(`/api/workspaces/${w.id}`, 'PATCH', { icon: { kind: 'image', value: 'x.png' } }), {} as Env)).status).toBe(400)
    expect((await app.fetch(jsonReq(`/api/workspaces/${w.id}`, 'PATCH', { color: 'reddish' }), {} as Env)).status).toBe(400)
  })

  it('404s a PATCH for an unknown workspace id', async () => {
    const res = await app.fetch(jsonReq('/api/workspaces/nope', 'PATCH', { name: 'Ghost' }), {} as Env)
    expect(res.status).toBe(404)
  })
})
