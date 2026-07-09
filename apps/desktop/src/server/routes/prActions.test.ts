import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiError } from '../../shared/api'
import { getDb, schema } from '../db'
import type { AppEnv, Principal, SessionUser } from '../middleware/auth'
import { prActions } from './prActions'
import { testGate } from './testAuth'
import { makeTestDb, type TestDb } from './testDb'

vi.mock('../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db')>()
  return { ...actual, getDb: vi.fn() }
})

const USER: SessionUser = { token: 'gh', login: 'james', name: '', avatar: '', scopes: [] }
const PRINCIPAL: Principal = { kind: 'user', user: USER }

const req = (principal: Principal | null, method: string, path: string, body?: unknown) => {
  const app = new Hono<AppEnv>().use('/api/*', ...testGate(principal)).route('/api/repos', prActions)
  return app.fetch(
    new Request(`http://acorn.test${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    {} as Env,
  )
}

describe('prActions auth + ApiError envelope (no GitHub call paths)', () => {
  let t: TestDb

  beforeEach(async () => {
    t = makeTestDb()
    vi.mocked(getDb).mockReturnValue(t.db)
    await t.db.insert(schema.repos).values({ userId: 'james', id: 1, owner: 'acme', name: 'widget', fetchedAt: Date.now() })
  })
  afterEach(() => t.cleanup())

  it('401s (ApiError) when logged out', async () => {
    const res = await req(null, 'POST', '/api/repos/acme/widget/pulls/1/merge', { method: 'merge' })
    expect(res.status).toBe(401)
    expect((await res.json()) as ApiError).toEqual({ error: 'unauthenticated' })
  })

  it('repo_not_found (ApiError) when the repo is not mirrored — resolvePr fails before GitHub', async () => {
    const res = await req(PRINCIPAL, 'POST', '/api/repos/other/repo/pulls/1/merge', { method: 'merge' })
    expect(res.status).toBe(404)
    expect((await res.json()) as ApiError).toEqual({ error: 'repo_not_found' })
  })

  it('bad_number (ApiError) for a non-integer PR number', async () => {
    const res = await req(PRINCIPAL, 'POST', '/api/repos/acme/widget/pulls/abc/merge', { method: 'merge' })
    expect(res.status).toBe(400)
    expect((await res.json()) as ApiError).toEqual({ error: 'bad_number' })
  })

  it('empty_body (ApiError) — resolvePr succeeds, validation rejects before GitHub', async () => {
    const res = await req(PRINCIPAL, 'POST', '/api/repos/acme/widget/pulls/1/comments', {})
    expect(res.status).toBe(400)
    expect((await res.json()) as ApiError).toEqual({ error: 'empty_body' })
  })

  it('viewed toggle is app-state only → typed success, no GitHub call', async () => {
    const res = await req(PRINCIPAL, 'POST', '/api/repos/acme/widget/pulls/1/viewed', { path: 'src/a.ts', viewed: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ path: 'src/a.ts', viewed: true })
  })
})
