import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskContext } from '../../shared/api'
import { getDb, schema } from '../db'
import type { AppEnv } from '../middleware/auth'
import { setContextMemorySource, setContextNotesSource, taskContext } from './taskContext'
import { makeTestDb, type TestDb } from './testDb'

vi.mock('../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db')>()
  return { ...actual, getDb: vi.fn() }
})

describe('GET /api/tasks/:id/context (docs/next 11 §C)', () => {
  let t: TestDb
  let app: Hono<AppEnv>

  beforeEach(async () => {
    t = makeTestDb()
    vi.mocked(getDb).mockReturnValue(t.db)
    app = new Hono<AppEnv>()
    app.use('/api/*', async (c, next) => {
      c.set('user', { token: 'token', login: 'james', name: '', avatar: '', scopes: [] })
      await next()
    })
    app.route('/api/tasks', taskContext)
    const now = Date.now()
    await t.db.insert(schema.tasks).values({
      id: 'task1',
      title: 'fix: guard null token',
      origin: 'rollbar',
      repoOwner: 'acme',
      repoName: 'api',
      branch: 'fix/null-token',
      worktreePath: '/wt/acme-api-fix-null-token',
      pullNumber: 813,
      status: 'active',
      sort: 0,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    })
    await t.db.insert(schema.repos).values({
      userId: 'james',
      id: 99,
      owner: 'acme',
      name: 'api',
      private: false,
      defaultBranch: 'main',
      pushedAt: null,
      fetchedAt: now,
      staleAfter: 60_000,
      etag: null,
    })
    await t.db.insert(schema.pullRequests).values({
      userId: 'james',
      repoId: 99,
      number: 813,
      nodeId: null,
      state: 'open',
      draft: false,
      title: 'fix: guard null token',
      body: '<p>Guards the token.</p>',
      headSha: 'abc',
      headRef: 'fix/null-token',
      baseRef: 'main',
      author: 'james',
      updatedAt: now,
      mergeable: null,
      mergeStateStatus: null,
      autoMergeEnabled: false,
      fetchedAt: now,
      staleAfter: 60_000,
      etag: null,
    })
    await t.db.insert(schema.prFiles).values([
      { userId: 'james', repoId: 99, number: 813, path: 'src/auth/login.ts', status: 'modified', additions: 3, deletions: 1, sha: 's1', patch: null },
      { userId: 'james', repoId: 99, number: 813, path: 'src/auth/token.ts', status: 'modified', additions: 1, deletions: 0, sha: 's2', patch: null },
    ])
    await t.db.insert(schema.taskLinks).values([
      { taskId: 'task1', integrationId: 'lin1', provider: 'linear', identifier: 'ENG-42', createdAt: now },
      { taskId: 'task1', integrationId: 'rb1', provider: 'rollbar', identifier: '142', createdAt: now + 1 },
    ])
    await t.db.insert(schema.issues).values([
      {
        userId: 'james',
        integrationId: 'lin1',
        provider: 'linear',
        identifier: 'ENG-42',
        data: JSON.stringify({ title: 'Login crashes for SSO users', state: { name: 'In Progress' } }),
        fetchedAt: now,
      },
    ])
  })

  afterEach(() => {
    setContextNotesSource(async () => [])
    setContextMemorySource(async () => [])
    t.cleanup()
  })

  const fetchCtx = async (qs = ''): Promise<TaskContext> => {
    const res = await app.fetch(new Request(`http://acorn.test/api/tasks/task1/context${qs}`), {} as Env)
    expect(res.status).toBe(200)
    return res.json()
  }

  it('composes task + PR (from the mirror) + linked issues; note/memory seams return []', async () => {
    const ctx = await fetchCtx()
    expect(ctx.task).toEqual({
      id: 'task1',
      title: 'fix: guard null token',
      repo: 'acme/api',
      branch: 'fix/null-token',
      worktreePath: '/wt/acme-api-fix-null-token',
      pullNumber: 813,
    })
    expect(ctx.pr).toEqual({
      number: 813,
      title: 'fix: guard null token',
      body: '<p>Guards the token.</p>',
      changedFiles: ['src/auth/login.ts', 'src/auth/token.ts'],
    })
    expect(ctx.issues).toEqual([
      { provider: 'linear', identifier: 'ENG-42', title: 'Login crashes for SSO users', detail: 'In Progress' },
      { provider: 'rollbar', identifier: '142', title: '142', detail: '' }, // uncached link → identifier only
    ])
    expect(ctx.notes).toEqual([])
    expect(ctx.memory).toEqual([])
  })

  it('include filters slices', async () => {
    const ctx = await fetchCtx('?include=issues')
    expect(ctx.pr).toBeUndefined()
    expect(ctx.issues).toHaveLength(2)
    const prOnly = await fetchCtx('?include=pr')
    expect(prOnly.issues).toEqual([])
    expect(prOnly.pr?.number).toBe(813)
  })

  it('composes the M4 seams when sources are registered', async () => {
    setContextNotesSource(async () => [{ title: 'plan', body: 'do the thing' }])
    setContextMemorySource(async () => [{ name: 'auth-conventions', description: 'how auth flows work' }])
    const ctx = await fetchCtx()
    expect(ctx.notes).toEqual([{ title: 'plan', body: 'do the thing' }])
    expect(ctx.memory).toEqual([{ name: 'auth-conventions', description: 'how auth flows work' }])
  })

  it('404s an unknown task', async () => {
    const res = await app.fetch(new Request('http://acorn.test/api/tasks/nope/context'), {} as Env)
    expect(res.status).toBe(404)
  })
})
