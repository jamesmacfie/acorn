import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../registerProviders'
import type { TaskContext } from '@acorn/protocol/api.ts'
import { getDb, schema } from '@acorn/node-core/server/db/index.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import {
  asContextSection,
  linkedIssuesSection,
  memorySection,
  notesSection,
  pullRequestSection,
  registerContextSection,
  removeContextSections,
  type ContextMemorySource,
  type ContextNotesSource,
} from '@acorn/node-core/server/agentTools/contextSections.ts'
import { taskContext } from '@acorn/node-core/server/routes/taskContext.ts'
import { makeTestDb, makeTestPluginDb, type TestDb, type TestPluginDb } from '@acorn/node-core/testkit/db.ts'
import { migrationsDir as githubMigrationsDir } from '@acorn/plugin-github/node/migrations.ts'
import { mirroredPullRequest } from '@acorn/plugin-github/server/mirrorQueries.ts'
import { pullRequests, prFiles, repos } from '@acorn/plugin-github/node/schema.ts'
import type { Env } from '@acorn/node-core/main/bindings.ts'

vi.mock('@acorn/node-core/server/db/index.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@acorn/node-core/server/db/index.ts')>()
  return { ...actual, getDb: vi.fn() }
})

describe('GET /api/tasks/:id/context (docs/agent-tools.md §4)', () => {
  let t: TestDb
  // The github mirror is a SECOND database now (docs/data-layer.md § Plugin DBs), so the `pr` section's
  // fixture is seeded into the plugin's own migrated file and reaches the section through the same
  // injected source production uses. Two handles in one test is the honest shape: the assertions below
  // still exercise `mirroredPullRequest` for real rather than a hand-written stand-in, which is what keeps
  // them able to catch a drift between the section's contract and the mirror's columns.
  let gh: TestPluginDb
  let app: Hono<AppEnv>
  let notesSource: ContextNotesSource
  let memorySource: ContextMemorySource

  beforeEach(async () => {
    t = makeTestDb()
    gh = makeTestPluginDb('github', githubMigrationsDir())
    notesSource = async () => []
    memorySource = async () => []
    // Sections are registered per owner now (server/plugin/types.ts § PluginContextSectionRegistry), so the
    // fixture registers them the way production does: core's `issues` under 'core', and the three
    // plugin-owned ones under the plugin that owns their rows. `PluginContextSection.assemble` takes no `db`,
    // which is why these three read only what their source gives them.
    removeContextSections('core')
    for (const owner of ['github', 'notes', 'memory']) removeContextSections(owner)
    registerContextSection('core', linkedIssuesSection)
    registerContextSection('github', asContextSection(pullRequestSection((userId, owner, name, number) => mirroredPullRequest(gh.db, userId, owner, name, number))))
    registerContextSection('notes', asContextSection(notesSection((...args) => notesSource(...args))))
    registerContextSection('memory', asContextSection(memorySection((...args) => memorySource(...args))))
    vi.mocked(getDb).mockReturnValue(t.db)
    const now = Date.now()
    await t.db.insert(schema.workspaces).values({ id: 'workspace-1', name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await t.db.insert(schema.projects).values({
      id: 'project-api', name: 'api', path: null, workspaceId: 'workspace-1', sort: 0, hidden: false,
      vcs: 'git', defaultBranch: 'main', remoteUrl: 'https://github.com/acme/api.git', githubOwner: 'acme', githubName: 'api', githubRepoId: 99,
      createdAt: now, updatedAt: now,
    })
    app = new Hono<AppEnv>()
    app.use('/api/*', async (c, next) => {
      c.set('principal', { kind: 'device', userId: 'james' })
      await next()
    })
    app.route('/api/tasks', taskContext)
    await t.db.insert(schema.tasks).values({
      id: 'task1',
      title: 'fix: guard null token',
      origin: 'rollbar',
      projectId: 'project-api',
      branch: 'fix/null-token',
      worktreePath: '/wt/acme-api-fix-null-token',
      pullNumber: 813,
      status: 'active',
      sort: 0,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    })
    await gh.db.insert(repos).values({
      userId: 'james',
      id: 99,
      owner: 'acme',
      name: 'api',
      private: false,
      defaultBranch: 'main',
      pushedAt: null,
      fetchedAt: now,
    })
    await gh.db.insert(pullRequests).values({
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
    await gh.db.insert(prFiles).values([
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
    for (const owner of ['core', 'github', 'notes', 'memory']) removeContextSections(owner)
    gh.cleanup()
    t.cleanup()
  })

  const fetchCtx = async (qs = '?include=*'): Promise<TaskContext> => {
    const res = await app.fetch(new Request(`http://acorn.test/api/tasks/task1/context${qs}`), {} as Env)
    expect(res.status).toBe(200)
    // Node's Response.json() is typed unknown (the DOM lib types it `any`); this package compiles
    // against plain Node types, so the route's contract is asserted explicitly.
    return res.json() as Promise<TaskContext>
  }

  it('composes task + PR (from the mirror) + linked issues; note/memory seams return []', async () => {
    const ctx = await fetchCtx()
    expect(ctx.task).toEqual({
      id: 'task1',
      title: 'fix: guard null token',
      projectId: 'project-api',
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
    expect(ctx.sections.find((section) => section.id === 'issues')).toMatchObject({
      defaultIncluded: true,
      absent: { reason: 'missing-cache' },
    })
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
    notesSource = async () => [{ slug: 'plan', scope: 'task', title: 'plan', kind: 'plan', body: 'do the thing', author: 'user' }]
    memorySource = async () => [{ name: 'auth-conventions', description: 'how auth flows work' }]
    const ctx = await fetchCtx()
    expect(ctx.notes).toEqual([{ slug: 'plan', scope: 'task', title: 'plan', body: 'do the thing' }])
    expect(ctx.memory).toEqual([{ name: 'auth-conventions', description: 'how auth flows work' }])
  })

  it('gives workflow assembly only its own run-scoped handoff note', async () => {
    notesSource = async () => [
      { slug: 'human-plan', scope: 'task', title: 'human plan', kind: 'plan', body: 'keep me', author: 'user' },
      { slug: 'workflow-handoffs-run-a', scope: 'task', title: 'run a', kind: 'handoff', body: 'current output', author: 'workflow' },
      { slug: 'workflow-handoffs-run-b', scope: 'task', title: 'run b', kind: 'handoff', body: 'other run output', author: 'workflow' },
    ]
    const ctx = await fetchCtx('?include=notes&workflowRunId=run-a')
    expect(ctx.notes.map((note) => note.slug)).toEqual(['human-plan', 'workflow-handoffs-run-a'])
    expect(ctx.sections[0].compact).not.toContain('other run output')
  })

  it('workspace notes ride the assembler once the 09 P2 source is wired (real NotesStore)', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { NotesStore } = await import('@acorn/plugin-notes/main/notes.ts')
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
          out.push({ slug: s.slug, scope: 'task', title: `${n.title} (${n.kind})`, kind: n.kind, body: n.body, author: n.author })
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
    notesSource = async () => Array.from({ length: 12 }, (_, index) => ({ slug: `n-${index}`, scope: 'task', title: `N${index}`, kind: 'plan', body: 'x'.repeat(2_100), author: 'user' as const }))
    const ctx = await fetchCtx('')
    expect(ctx.sections.map((section) => section.id)).toEqual(['issues', 'notes'])
    const notes = ctx.sections.find((section) => section.id === 'notes')
    expect(notes?.items).toHaveLength(10)
    expect(notes?.omitted).toBe(2)
    expect(notes?.items[0].body?.endsWith('…')).toBe(true)
  })

  it('404s an unknown task', async () => {
    const res = await app.fetch(new Request('http://acorn.test/api/tasks/nope/context'), {} as Env)
    expect(res.status).toBe(404)
  })
})
