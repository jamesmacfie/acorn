import { testSecretEnv } from '@acorn/node-core/testkit/db.ts'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../contract/api'
import { settleBackground } from '@acorn/node-core/server/background.ts'
import { reposResource } from '../resourceKeys'
import { gh } from '..'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { REPOS_STALE_AFTER_MS } from '../syncPolicy'
import { repos } from './repos'
import { makeTestDb, makeTestPluginDb, type TestDb, type TestPluginDb } from '@acorn/node-core/testkit/db.ts'
import { migrationsDir } from '../../node/migrations'
import { seedGithubIntegration } from '../../testkit/githubToken'
import type { Env } from '@acorn/node-core/main/bindings.ts'
// Aliased away from the `repos` router imported above because the table and route factory share a name.
import { repos as reposTable, syncState } from '../../node/schema'

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

const ENC_KEY = '0'.repeat(64)

const publicRepo: Repo = { id: 19847, owner: 'Runn-Fast', name: 'runn', private: true, defaultBranch: 'main', pushedAt: Date.parse('2026-06-25T01:00:00Z') }

const responseJson = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json', ...init?.headers } })

// TWO handles, and no getDb mock any more: `repos`/`sync_state` are this plugin's tables in
// <data-root>/plugins/github.sqlite and the router is a factory over that handle, while the stored GitHub
// credential still lives in CORE's `integrations` table and is read through the core seam off `env.DB`.
describe('repos list (serve-then-revalidate via the sync engine)', () => {
  let core: TestDb
  let plugin: TestPluginDb
  let app: Hono<AppEnv>

  beforeEach(async () => {
    vi.clearAllMocks()
    core = makeTestDb()
    plugin = makeTestPluginDb('github', migrationsDir())
    // The GitHub token comes from a stored integration row now, not from the caller's identity.
    await seedGithubIntegration(core.db, 'james', 'token', ENC_KEY)
    app = new Hono<AppEnv>()
    app.use('/api/*', async (c, next) => {
      c.set('principal', { kind: 'device', userId: 'james' })
      await next()
    })
    app.route('/api/repos', repos(plugin.db))
  })

  afterEach(() => {
    plugin.cleanup()
    core.cleanup()
  })

  const get = () => app.fetch(new Request('http://acorn.test/api/repos'), { DB: core.db, ...testSecretEnv(ENC_KEY) } as Env)
  const syncRow = () =>
    plugin.db.select().from(syncState).where(and(eq(syncState.userId, 'james'), eq(syncState.resource, reposResource())))

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
    expect(await res.json()).toMatchObject({ error: { code: 'reauth' } })
  })

  it('stale: serves the mirror immediately, then revalidates with If-None-Match → 304 keeps rows', async () => {
    const stale = Date.now() - REPOS_STALE_AFTER_MS - 1
    await plugin.db.insert(reposTable).values({ userId: 'james', ...publicRepo, pushedAt: publicRepo.pushedAt, fetchedAt: stale })
    await plugin.db.insert(syncState).values({ userId: 'james', resource: reposResource(), etag: '"repos-v1"', fetchedAt: stale })
    vi.mocked(gh).mockResolvedValueOnce(new Response(null, { status: 304 }))

    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([publicRepo]) // stale mirror served immediately

    await settleBackground()
    expect(gh).toHaveBeenCalledWith('token', '/user/repos?sort=pushed&direction=desc&per_page=100', { headers: { 'If-None-Match': '"repos-v1"' } })
    // 304 → rows untouched, freshness bumped.
    expect(await plugin.db.select().from(reposTable)).toHaveLength(1)
    const [sync] = await syncRow()
    expect(sync.fetchedAt).toBeGreaterThan(stale)
  })

  it('POST /refresh zeroes freshness so the next read revalidates', async () => {
    await plugin.db.insert(reposTable).values({ userId: 'james', ...publicRepo, pushedAt: publicRepo.pushedAt, fetchedAt: Date.now() })
    await plugin.db.insert(syncState).values({ userId: 'james', resource: reposResource(), etag: '"repos-v1"', fetchedAt: Date.now() })

    const res = await app.fetch(new Request('http://acorn.test/api/repos/refresh', { method: 'POST' }), { DB: core.db, ...testSecretEnv(ENC_KEY) } as Env)
    expect(res.status).toBe(204)
    const [sync] = await syncRow()
    expect(sync.fetchedAt).toBe(0)
    expect(sync.etag).toBe('"repos-v1"') // ETag preserved so the refetch can still 304
  })
})
