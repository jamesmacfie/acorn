import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskContext } from '../../shared/api'
import { getDb, schema } from '../db'
import type { AppEnv } from '../middleware/auth'
import { buildContextSections, setContextSections, type ContextMemorySource, type ContextNotesSource } from '../agentTools/contextSections'
import { taskContext } from './taskContext'
import { makeTestDb, type TestDb } from './testDb'

vi.mock('../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db')>()
  return { ...actual, getDb: vi.fn() }
})

describe('GET /api/tasks/:id/context (docs/next 11 §C)', () => {
  let t: TestDb
  let app: Hono<AppEnv>
  let notesSource: ContextNotesSource
  let memorySource: ContextMemorySource

  beforeEach(async () => {
    t = makeTestDb()
    notesSource = async () => []
    memorySource = async () => []
    setContextSections(buildContextSections({ notes: (...args) => notesSource(...args), memory: (...args) => memorySource(...args) }))
    vi.mocked(getDb).mockReturnValue(t.db)
    app = new Hono<AppEnv>()
    app.use('/api/*', async (c, next) => {
      c.set('principal', { kind: 'user', user: { token: 'token', login: 'james', name: '', avatar: '', scopes: [] } })
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
    })
    await t.db.insert(schema.prFiles).values([
      { userId: 'james', repoId: 99, number: 813, path: 'src/auth/login.ts', status: 'modified', additions: 3, deletions: 1, sha: 's1' },
      { userId: 'james', repoId: 99, number: 813, path: 'src/auth/token.ts', status: 'modified', additions: 1, deletions: 0, sha: 's2' },
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
        data: JSON.stringify({
          identifier: 'ENG-42',
          title: 'Login crashes for SSO users',
          url: 'https://linear.app/acme/issue/ENG-42',
          state: { name: 'In Progress', type: 'started', color: '#55f' },
          assignee: null,
        }),
        fetchedAt: now,
      },
    ])
  })

  afterEach(() => {
    setContextSections(buildContextSections({ notes: async () => [], memory: async () => [] }))
    t.cleanup()
  })

  const fetchCtx = async (qs = '?include=*'): Promise<TaskContext> => {
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
      { provider: 'linear', identifier: 'ENG-42', title: 'Login crashes for SSO users', detail: 'In Progress', cache: 'present' },
      { provider: 'rollbar', identifier: '142', title: '142', detail: 'Cache: missing', cache: 'missing' },
    ])
    expect(ctx.sections.map((section) => section.id)).toEqual(['pr', 'issues', 'notes', 'memory'])
    expect(ctx.sections.find((section) => section.id === 'issues')?.absent?.reason).toBe('missing-cache')
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
    notesSource = async () => [{ slug: 'plan', scope: 'task', title: 'plan', kind: 'plan', body: 'do the thing' }]
    memorySource = async () => [{ name: 'auth-conventions', description: 'how auth flows work' }]
    const ctx = await fetchCtx()
    expect(ctx.notes).toEqual([{ slug: 'plan', scope: 'task', title: 'plan', body: 'do the thing' }])
    expect(ctx.memory).toEqual([{ name: 'auth-conventions', description: 'how auth flows work' }])
  })

  it('gives workflow assembly only its own run-scoped handoff note', async () => {
    notesSource = async () => [
      { slug: 'human-plan', scope: 'task', title: 'human plan', kind: 'plan', body: 'keep me' },
      { slug: 'workflow-handoffs-run-a', scope: 'task', title: 'run a', kind: 'handoff', body: 'current output' },
      { slug: 'workflow-handoffs-run-b', scope: 'task', title: 'run b', kind: 'handoff', body: 'other run output' },
    ]
    const ctx = await fetchCtx('?include=notes&workflowRunId=run-a')
    expect(ctx.notes.map((note) => note.slug)).toEqual(['human-plan', 'workflow-handoffs-run-a'])
    expect(ctx.sections[0].compact).not.toContain('other run output')
  })

  it('workspace notes ride the assembler once the 09 P2 source is wired (real NotesStore)', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { NotesStore } = await import('../../main/notes')
    const dir = mkdtempSync(join(tmpdir(), 'acorn-ctx-notes-'))
    try {
      const store = new NotesStore(dir)
      const location = { scope: 'task' as const, taskId: 'task1' }
      await store.create(location, 'eng-42 plan', { kind: 'plan', body: 'Guard the null token first.\n' })
      await store.create(location, 'handoff', { kind: 'handoff', author: 'agent', body: 'Left the redirect for next session.\n' })
      // The same wiring shape terminal.ts registers: task → workspace → notes list + bodies.
      notesSource = async () => {
        const list = await store.list(location)
        const out: Awaited<ReturnType<ContextNotesSource>> = []
        for (const s of list) {
          const n = await store.read(location, s.slug)
          out.push({ slug: s.slug, scope: 'task', title: `${n.title} (${n.kind})`, kind: n.kind, body: n.body })
        }
        return out
      }
      const ctx = await fetchCtx()
      expect(ctx.notes.map((n) => n.title).sort()).toEqual(['eng-42 plan (plan)', 'handoff (handoff)'])
      expect(ctx.notes.find((n) => n.title.startsWith('eng-42'))?.body).toContain('Guard the null token')
      // include filter still respected: pr-only leaves notes out.
      expect((await fetchCtx('?include=pr')).notes).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('uses contribution defaults and enforces the declared note budget', async () => {
    notesSource = async () => Array.from({ length: 12 }, (_, index) => ({ slug: `n-${index}`, scope: 'task', title: `N${index}`, kind: 'plan', body: 'x'.repeat(2_100) }))
    const ctx = await fetchCtx('')
    expect(ctx.sections.map((section) => section.id)).toEqual(['notes'])
    expect(ctx.sections[0].items).toHaveLength(10)
    expect(ctx.sections[0].omitted).toBe(2)
    expect(ctx.sections[0].items[0].body?.endsWith('…')).toBe(true)
  })

  it('404s an unknown task', async () => {
    const res = await app.fetch(new Request('http://acorn.test/api/tasks/nope/context'), {} as Env)
    expect(res.status).toBe(404)
  })
})
