import { testSecretEnv } from '@acorn/node-core/testkit/db.ts'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pull } from '../../contract/api'
import { settleBackground } from '@acorn/node-core/server/background.ts'
import { pullsResource } from '../resourceKeys'
import { gh } from '..'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { PULLS_STALE_AFTER_MS } from '../syncPolicy'
import { pulls } from './pulls'
import { makeTestDb, makeTestPluginDb, type TestDb, type TestPluginDb } from '@acorn/node-core/testkit/db.ts'
import { migrationsDir } from '../../node/migrations'
import { createTaskService } from '@acorn/node-core/main/core/tasks.ts'
import { schema } from '@acorn/node-core/server/db/index.ts'
import { seedGithubIntegration } from '../../testkit/githubToken'
import type { Env } from '@acorn/node-core/main/bindings.ts'
import { pullRequests, repos, syncState } from '../../node/schema'

vi.mock('..', async (importOriginal) => {
  const actual = await importOriginal<typeof import('..')>()
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

const ENC_KEY = '0'.repeat(64)

describe('pulls list (serve-then-revalidate via the sync engine)', () => {
  let core: TestDb
  let plugin: TestPluginDb
  let app: Hono<AppEnv>

  beforeEach(async () => {
    vi.clearAllMocks()
    core = makeTestDb()
    plugin = makeTestPluginDb('github', migrationsDir())
    // The GitHub token comes from a stored integration row now, not from the caller's identity.
    await seedGithubIntegration(core.db, 'james', 'token', ENC_KEY)
    const now = Date.now()
    await core.db.insert(schema.workspaces).values({ id: 'workspace-1', name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await core.db.insert(schema.projects).values({
      id: 'project-runn', name: 'runn', path: null, workspaceId: 'workspace-1', sort: 0, hidden: false,
      vcs: 'git', defaultBranch: 'main', remoteUrl: 'https://github.com/Runn-Fast/runn.git', githubOwner: 'Runn-Fast', githubName: 'runn', githubRepoId: REPO_ID,
      createdAt: now, updatedAt: now,
    })
    // Seed the repo so resolveRepoForUser hits the mirror (no GitHub round-trip for resolution).
    await plugin.db.insert(repos).values({ userId: 'james', id: REPO_ID, owner: 'Runn-Fast', name: 'runn', private: true, defaultBranch: 'main', pushedAt: 0, fetchedAt: Date.now() })
    app = new Hono<AppEnv>()
    app.use('/api/*', async (c, next) => {
      c.set('principal', { kind: 'device', userId: 'james' })
      await next()
    })
    app.route('/api/repos', pulls(plugin.db, { tasks: createTaskService(core.db) }))
  })

  afterEach(() => {
    plugin.cleanup()
    core.cleanup()
  })

  const getOpen = () => app.fetch(new Request('http://acorn.test/api/repos/Runn-Fast/runn/pulls'), { DB: core.db, ...testSecretEnv(ENC_KEY) } as Env)

  it('cold: blocks on GitHub, mirrors the list, and adopts a matching local task (Flow B)', async () => {
    // A local-first task on the same branch with no PR yet — the refresh should adopt PR #42.
    await core.db.insert(schema.tasks).values({
      id: 'task-1', title: 'wip', origin: 'local', projectId: 'project-runn', branch: 'feature-x', status: 'active', createdAt: 0, updatedAt: 0,
    })
    vi.mocked(gh).mockResolvedValueOnce(responseJson([ghPull], { headers: { etag: '"pulls-v1"' } }))

    const res = await getOpen()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([publicPull])
    expect(gh).toHaveBeenCalledWith('token', '/repos/Runn-Fast/runn/pulls?state=open&sort=updated&direction=desc&per_page=100', { headers: {} })

    const [task] = await core.db.select().from(schema.tasks).where(eq(schema.tasks.id, 'task-1'))
    expect(task.pullNumber).toBe(42) // Flow B: task inherited the freshly-opened PR

    const [sync] = await plugin.db.select().from(syncState).where(eq(syncState.resource, pullsResource(REPO_ID, 'open')))
    expect(sync.etag).toBe('"pulls-v1"')
  })

  it('stale: serves the mirror immediately, then revalidates with If-None-Match → 304 keeps rows', async () => {
    const stale = Date.now() - PULLS_STALE_AFTER_MS - 1
    await plugin.db.insert(pullRequests).values({ userId: 'james', repoId: REPO_ID, number: 42, nodeId: 'PR_kw42', state: 'open', draft: false, title: 'Add sync engine', headRef: 'feature-x', baseRef: 'main', author: 'james', updatedAt: publicPull.updatedAt, fetchedAt: stale })
    await plugin.db.insert(syncState).values({ userId: 'james', resource: pullsResource(REPO_ID, 'open'), etag: '"pulls-v1"', fetchedAt: stale })
    vi.mocked(gh).mockResolvedValueOnce(new Response(null, { status: 304 }))

    const res = await getOpen()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([publicPull]) // stale mirror served immediately

    await settleBackground()
    expect(gh).toHaveBeenCalledWith('token', '/repos/Runn-Fast/runn/pulls?state=open&sort=updated&direction=desc&per_page=100', { headers: { 'If-None-Match': '"pulls-v1"' } })
    expect(await plugin.db.select().from(pullRequests).where(eq(pullRequests.repoId, REPO_ID))).toHaveLength(1)
    const [sync] = await plugin.db.select().from(syncState).where(eq(syncState.resource, pullsResource(REPO_ID, 'open')))
    expect(sync.fetchedAt).toBeGreaterThan(stale)
  })
})
