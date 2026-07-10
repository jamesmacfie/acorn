import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../core/shared/api'
import { settleBackground } from '../../../../core/server/background'
import { getDb, schema } from '../../../../core/server/db'
import { reposResource } from '../../../../core/server/db/resourceKeys'
import { gh } from '..'
import type { AppEnv } from '../../../../core/server/middleware/auth'
import { REPOS_STALE_AFTER_MS } from '../../../../core/server/sync/policy'
import { repos } from './repos'
import { makeTestDb, type TestDb } from '../../../../core/server/routes/testDb'

vi.mock('../../../../core/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../core/server/db')>()
  return { ...actual, getDb: vi.fn() }
})

vi.mock('..', async (importOriginal) => {
  const actual = await importOriginal<typeof import('..')>()
  return { ...actual, gh: vi.fn() }
})

const ghRepo = {
  id: 19847,
  name: 'runn',
  private: true,
  default_branch: 'main',
  pushed_at: '2026-06-25T01:00:00Z',
  owner: { login: 'Runn-Fast' },
}

const publicRepo: Repo = { id: 19847, owner: 'Runn-Fast', name: 'runn', private: true, defaultBranch: 'main', pushedAt: Date.parse('2026-06-25T01:00:00Z') }

const responseJson = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json', ...init?.headers } })

describe('repos list (serve-then-revalidate via the sync engine)', () => {
  let t: TestDb
  let app: Hono<AppEnv>

  beforeEach(() => {
    vi.clearAllMocks()
    t = makeTestDb()
    vi.mocked(getDb).mockReturnValue(t.db)
    app = new Hono<AppEnv>()
    app.use('/api/*', async (c, next) => {
      c.set('principal', { kind: 'user', user: { token: 'token', login: 'james', name: '', avatar: '', scopes: [] } })
      await next()
    })
    app.route('/api/repos', repos)
  })

  afterEach(() => t.cleanup())

  const get = () => app.fetch(new Request('http://acorn.test/api/repos'), {} as Env)
  const syncRow = () =>
    t.db.select().from(schema.syncState).where(and(eq(schema.syncState.userId, 'james'), eq(schema.syncState.resource, reposResource())))

  it('cold: blocks on GitHub, mirrors the list + ETag, serves it', async () => {
    vi.mocked(gh).mockResolvedValueOnce(responseJson([ghRepo], { headers: { etag: '"repos-v1"' } }))

    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([publicRepo])
    expect(gh).toHaveBeenCalledWith('token', '/user/repos?sort=pushed&direction=desc&per_page=100', { headers: {} })

    const [sync] = await syncRow()
    expect(sync.etag).toBe('"repos-v1"')
  })

  it('cold error surfaces the GitHub status', async () => {
    vi.mocked(gh).mockResolvedValueOnce(new Response('nope', { status: 401 }))
    const res = await get()
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'reauth' })
  })

  it('stale: serves the mirror immediately, then revalidates with If-None-Match → 304 keeps rows', async () => {
    const stale = Date.now() - REPOS_STALE_AFTER_MS - 1
    await t.db.insert(schema.repos).values({ userId: 'james', ...publicRepo, pushedAt: publicRepo.pushedAt, fetchedAt: stale })
    await t.db.insert(schema.syncState).values({ userId: 'james', resource: reposResource(), etag: '"repos-v1"', fetchedAt: stale })
    vi.mocked(gh).mockResolvedValueOnce(new Response(null, { status: 304 }))

    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([publicRepo]) // stale mirror served immediately

    await settleBackground()
    expect(gh).toHaveBeenCalledWith('token', '/user/repos?sort=pushed&direction=desc&per_page=100', { headers: { 'If-None-Match': '"repos-v1"' } })
    // 304 → rows untouched, freshness bumped.
    expect(await t.db.select().from(schema.repos)).toHaveLength(1)
    const [sync] = await syncRow()
    expect(sync.fetchedAt).toBeGreaterThan(stale)
  })

  it('POST /refresh zeroes freshness so the next read revalidates', async () => {
    await t.db.insert(schema.repos).values({ userId: 'james', ...publicRepo, pushedAt: publicRepo.pushedAt, fetchedAt: Date.now() })
    await t.db.insert(schema.syncState).values({ userId: 'james', resource: reposResource(), etag: '"repos-v1"', fetchedAt: Date.now() })

    const res = await app.fetch(new Request('http://acorn.test/api/repos/refresh', { method: 'POST' }), {} as Env)
    expect(res.status).toBe(204)
    const [sync] = await syncRow()
    expect(sync.fetchedAt).toBe(0)
    expect(sync.etag).toBe('"repos-v1"') // ETag preserved so the refetch can still 304
  })
})
