import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pull } from '../../shared/api'
import { settleBackground } from '../background'
import { getDb, schema } from '../db'
import { pullsResource } from '../db/resourceKeys'
import { gh } from '../github'
import type { AppEnv } from '../middleware/auth'
import { PULLS_STALE_AFTER_MS } from '../sync/policy'
import { pulls } from './pulls'
import { makeTestDb, type TestDb } from './testDb'

vi.mock('../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db')>()
  return { ...actual, getDb: vi.fn() }
})

vi.mock('../github', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../github')>()
  return { ...actual, gh: vi.fn() }
})

const REPO_ID = 19847

const ghPull = {
  number: 42,
  node_id: 'PR_kw42',
  state: 'open',
  draft: false,
  title: 'Add sync engine',
  head: { ref: 'feature-x' },
  base: { ref: 'main' },
  user: { login: 'james' },
  updated_at: '2026-06-25T01:00:00Z',
}

const publicPull: Pull = {
  number: 42,
  title: 'Add sync engine',
  state: 'open',
  draft: false,
  author: 'james',
  headRef: 'feature-x',
  baseRef: 'main',
  updatedAt: Date.parse('2026-06-25T01:00:00Z'),
  mergeable: null,
  mergeStateStatus: null,
  autoMergeEnabled: false,
}

const responseJson = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json', ...init?.headers } })

describe('pulls list (serve-then-revalidate via the sync engine)', () => {
  let t: TestDb
  let app: Hono<AppEnv>

  beforeEach(async () => {
    vi.clearAllMocks()
    t = makeTestDb()
    vi.mocked(getDb).mockReturnValue(t.db)
    // Seed the repo so resolveRepoForUser hits the mirror (no GitHub round-trip for resolution).
    await t.db.insert(schema.repos).values({ userId: 'james', id: REPO_ID, owner: 'Runn-Fast', name: 'runn', private: true, defaultBranch: 'main', pushedAt: 0, fetchedAt: Date.now() })
    app = new Hono<AppEnv>()
    app.use('/api/*', async (c, next) => {
      c.set('principal', { kind: 'user', user: { token: 'token', login: 'james', name: '', avatar: '', scopes: [] } })
      await next()
    })
    app.route('/api/repos', pulls)
  })

  afterEach(() => t.cleanup())

  const getOpen = () => app.fetch(new Request('http://acorn.test/api/repos/Runn-Fast/runn/pulls'), {} as Env)

  it('cold: blocks on GitHub, mirrors the list, and adopts a matching local task (Flow B)', async () => {
    // A local-first task on the same branch with no PR yet — the refresh should adopt PR #42.
    await t.db.insert(schema.tasks).values({
      id: 'task-1', title: 'wip', origin: 'local', repoOwner: 'Runn-Fast', repoName: 'runn', branch: 'feature-x', status: 'active', createdAt: 0, updatedAt: 0,
    })
    vi.mocked(gh).mockResolvedValueOnce(responseJson([ghPull], { headers: { etag: '"pulls-v1"' } }))

    const res = await getOpen()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([publicPull])
    expect(gh).toHaveBeenCalledWith('token', '/repos/Runn-Fast/runn/pulls?state=open&sort=updated&direction=desc&per_page=100', { headers: {} })

    const [task] = await t.db.select().from(schema.tasks).where(eq(schema.tasks.id, 'task-1'))
    expect(task.pullNumber).toBe(42) // Flow B: task inherited the freshly-opened PR

    const [sync] = await t.db.select().from(schema.syncState).where(eq(schema.syncState.resource, pullsResource(REPO_ID, 'open')))
    expect(sync.etag).toBe('"pulls-v1"')
  })

  it('stale: serves the mirror immediately, then revalidates with If-None-Match → 304 keeps rows', async () => {
    const stale = Date.now() - PULLS_STALE_AFTER_MS - 1
    await t.db.insert(schema.pullRequests).values({ userId: 'james', repoId: REPO_ID, number: 42, nodeId: 'PR_kw42', state: 'open', draft: false, title: 'Add sync engine', headRef: 'feature-x', baseRef: 'main', author: 'james', updatedAt: publicPull.updatedAt, fetchedAt: stale })
    await t.db.insert(schema.syncState).values({ userId: 'james', resource: pullsResource(REPO_ID, 'open'), etag: '"pulls-v1"', fetchedAt: stale })
    vi.mocked(gh).mockResolvedValueOnce(new Response(null, { status: 304 }))

    const res = await getOpen()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([publicPull]) // stale mirror served immediately

    await settleBackground()
    expect(gh).toHaveBeenCalledWith('token', '/repos/Runn-Fast/runn/pulls?state=open&sort=updated&direction=desc&per_page=100', { headers: { 'If-None-Match': '"pulls-v1"' } })
    expect(await t.db.select().from(schema.pullRequests).where(eq(schema.pullRequests.repoId, REPO_ID))).toHaveLength(1)
    const [sync] = await t.db.select().from(schema.syncState).where(eq(schema.syncState.resource, pullsResource(REPO_ID, 'open')))
    expect(sync.fetchedAt).toBeGreaterThan(stale)
  })
})
