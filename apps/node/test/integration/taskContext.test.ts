import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../helpers/registerProviders'
import type { TaskContext } from '@acorn/protocol/api.ts'
import { getDb, schema } from '@acorn/node-core/server/db/index.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import {
  asContextSection,
  changeRequestSection,
  linkedIssuesSection,
  registerContextSection,
  removeContextSections,
} from '@acorn/node-core/server/agentTools'
import { memoryIdentityStore } from '@acorn/node-core/server/activeIdentity.ts'
import { createProjectService, createTaskService } from '@acorn/node-core/server/core'
import { declareCodeHost } from '@acorn/node-core/server/pluginHost'
import { taskContext } from '@acorn/node-core/server/routes'
import { registerRoute, removePluginRoutes } from '@acorn/node-core/server/routes/registry.ts'
import { makeTestDb, makeTestPluginDb, type TestDb, type TestPluginDb } from '@acorn/node-core/testkit'
// Core owns `issues` and `pr`. The `pr` section asks GitHub's change request routes, which reach this
// test through the plugin's testkit, and notes is shaped by the plugin that owns its rows.
import { changeRequestRoutes, checks, prFiles, pullRequests, repos } from '@acorn/plugin-github/testkit'
import { notesSection, type ContextNotesSource } from '@acorn/plugin-notes/testkit'
import type { Env } from '@acorn/node-core/server/bindings.ts'
import { buildAgentTools } from '@acorn/node-core/server/agentTools'

vi.mock('@acorn/node-core/server/db/index.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@acorn/node-core/server/db/index.ts')>()
  return { ...actual, getDb: vi.fn() }
})

describe('GET /api/tasks/:id/context (docs/agent-tools/context-sections.md § The task context route)', () => {
  let t: TestDb
  // The github mirror is a second database (docs/data-layer/plugin-databases.md § Plugin databases), so the `pr`
  // section's fixture is seeded into the plugin's own migrated file and reaches the section through
  // GitHub's real change request routes. Two handles in one test is the honest shape: the assertions
  // below exercise the mirror reads for real rather than a hand-written stand-in, which is what keeps
  // them able to catch a drift between the routes' contract and the mirror's columns.
  let gh: TestPluginDb
  let app: Hono<AppEnv>
  let notesSource: ContextNotesSource
  let undeclare: () => void
  const env = { ACTIVE_IDENTITY: { get: () => 'james' } } as unknown as Env

  beforeEach(async () => {
    t = makeTestDb()
    gh = makeTestPluginDb('github')
    notesSource = async () => []
    // Sections are registered per owner (`PluginContextSectionRegistry`), so the
    // fixture registers them the way production does: core's `issues` under 'core', and the two
    // plugin-owned ones under the plugin that owns their rows. `PluginContextSection.assemble` takes no `db`,
    // which is why these two read only what their source gives them.
    removeContextSections('core')
    for (const owner of ['github', 'notes', 'memory']) removeContextSections(owner)
    registerContextSection('core', linkedIssuesSection)
    registerContextSection('core', changeRequestSection(env))
    undeclare = declareCodeHost(
      'github',
      {
        label: 'GitHub',
        hosts: ['github.com'],
        changeRequest: { label: 'pull request', prefix: '#', api: '/v1/p/github/change-requests' },
      },
      true,
    )
    registerRoute({
      plugin: 'github',
      prefix: '/change-requests',
      router: changeRequestRoutes(gh.db, {
        tasks: createTaskService(t.db),
        projects: createProjectService(t.db, memoryIdentityStore('james')),
      }),
    })
    registerContextSection('notes', asContextSection(notesSection((...args) => notesSource(...args))))
    vi.mocked(getDb).mockReturnValue(t.db)
    const now = Date.now()
    await t.db
      .insert(schema.workspaces)
      .values({ id: 'workspace-1', name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await t.db.insert(schema.projects).values({
      id: 'project-api',
      name: 'api',
      path: null,
      workspaceId: 'workspace-1',
      sort: 0,
      hidden: false,
      vcs: 'git',
      defaultBranch: 'main',
      remoteUrl: 'https://github.com/acme/api.git',
      repoProvider: 'github',
      repoHost: 'github.com',
      repoPath: 'acme/api',
      repoExternalId: '99',
      githubOwner: 'acme',
      githubName: 'api',
      githubRepoId: 99,
      createdAt: now,
      updatedAt: now,
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
    await t.db.insert(schema.taskChangeRequests).values({
      taskId: 'task1',
      provider: 'github',
      repoHost: 'github.com',
      repoPath: 'acme/api',
      number: 813,
      role: 'primary',
      provenance: 'task',
      createdAt: now,
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
      {
        userId: 'james',
        repoId: 99,
        number: 813,
        path: 'src/auth/login.ts',
        status: 'modified',
        additions: 3,
        deletions: 1,
        sha: 's1',
        position: 0,
        patchState: 'unavailable',
      },
      {
        userId: 'james',
        repoId: 99,
        number: 813,
        path: 'src/auth/token.ts',
        status: 'modified',
        additions: 1,
        deletions: 0,
        sha: 's2',
        position: 1,
        patchState: 'unavailable',
      },
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
    removePluginRoutes('github')
    undeclare()
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

  it('composes task, PR, linked issues and notes without duplicating standing memory', async () => {
    const ctx = await fetchCtx()
    expect(ctx.task).toEqual({
      id: 'task1',
      title: 'fix: guard null token',
      projectId: 'project-api',
      repo: 'acme/api',
      branch: 'fix/null-token',
      worktreePath: '/wt/acme-api-fix-null-token',
      pullNumber: 813,
      changeRequest: { provider: 'github', number: 813 },
    })
    expect(Object.keys(ctx).sort()).toEqual(['sections', 'task'])
    expect(ctx.sections.find((section) => section.id === 'pr')?.items).toEqual([
      {
        id: 'pr:813',
        kind: 'PR',
        label: '#813 fix: guard null token',
        body: '<p>Guards the token.</p>',
        details: ['src/auth/login.ts', 'src/auth/token.ts'],
        jump: undefined,
      },
    ])
    expect(ctx.sections.find((section) => section.id === 'issues')?.items).toMatchObject([
      {
        kind: 'Linear',
        providerId: 'linear',
        label: expect.stringContaining('ENG-42'),
        jump: { pane: 'linear', ref: { providerId: 'linear', displayId: 'ENG-42' } },
      },
      { kind: 'Rollbar', providerId: 'rollbar', details: ['Cache: missing'] },
    ])
    expect(ctx.sections.map((section) => section.id)).toEqual(['pr', 'issues', 'notes'])
    expect(ctx.sections.find((section) => section.id === 'issues')).toMatchObject({
      defaultIncluded: true,
      absent: { reason: 'missing-cache' },
    })
    expect(ctx.sections.find((section) => section.id === 'notes')?.items).toEqual([])
    expect(ctx.sections.some((section) => section.id === 'memory')).toBe(false)
  })

  it('include filters slices', async () => {
    const ctx = await fetchCtx('?include=issues')
    expect(ctx.sections.map((section) => section.id)).toEqual(['issues'])
    expect(ctx.sections[0].items).toHaveLength(2)
    const prOnly = await fetchCtx('?include=pr')
    expect(prOnly.sections.map((section) => section.id)).toEqual(['pr'])
    expect(prOnly.sections[0].items[0].id).toBe('pr:813')
  })

  it('projects the same bounded items to agent tools', async () => {
    const tools = buildAgentTools({ db: t.db, secrets: t.secrets, env })
    const call = async (name: string, input: unknown = {}) =>
      tools.find((tool) => tool.name === name)!.handler(input, { userLogin: 'james', taskId: 'task1' } as never)
    const context = await fetchCtx()
    const issues = context.sections.find((section) => section.id === 'issues')!.items
    const pr = context.sections.find((section) => section.id === 'pr')!.items[0]
    expect(await call('task_current')).toMatchObject({ links: issues })
    expect(await call('pr_current')).toEqual(pr)
    expect(await call('pr_changed_files')).toEqual(pr.details)
    // The two tools GitHub used to own, through core and GitHub's own routes.
    await gh.db.insert(checks).values([
      { userId: 'james', repoId: 99, number: 813, name: 'test', status: 'failure', url: null, runId: 7, position: 0 },
      { userId: 'james', repoId: 99, number: 813, name: 'lint', status: null, url: null, runId: null, position: 1 },
    ])
    expect(await call('pr_checks')).toEqual({
      number: 813,
      checks: [
        { name: 'lint', status: null, url: null, runId: null },
        { name: 'test', status: 'failure', url: null, runId: 7 },
      ],
      failing: ['test'],
      pending: ['lint'],
    })
    expect(await call('pr_review_comments')).toEqual({
      number: 813,
      reviews: [],
      threads: [],
      comments: [],
      omitted: 0,
    })
    expect(await call('linked_issues')).toEqual(issues)
    expect(await call('linked_issues', { provider: 'linear' })).toEqual(
      issues.filter((item) => item.providerId === 'linear'),
    )
  })

  it('composes notes when its source is registered', async () => {
    notesSource = async () => [
      { slug: 'plan', scope: 'task', title: 'plan', kind: 'plan', body: 'do the thing', author: 'user' },
    ]
    const ctx = await fetchCtx()
    expect(ctx.sections.find((section) => section.id === 'notes')?.items).toMatchObject([
      { id: 'task:plan', label: 'plan', body: 'do the thing' },
    ])
  })

  it('gives workflow assembly only its own run-scoped handoff note', async () => {
    notesSource = async () => [
      { slug: 'human-plan', scope: 'task', title: 'human plan', kind: 'plan', body: 'keep me', author: 'user' },
      {
        slug: 'workflow-handoffs-run-a',
        scope: 'task',
        title: 'run a',
        kind: 'handoff',
        body: 'current output',
        author: 'workflow',
      },
      {
        slug: 'workflow-handoffs-run-b',
        scope: 'task',
        title: 'run b',
        kind: 'handoff',
        body: 'other run output',
        author: 'workflow',
      },
    ]
    const ctx = await fetchCtx('?include=notes&workflowRunId=run-a')
    expect(ctx.sections[0].items.map((note) => note.id)).toEqual(['task:human-plan', 'task:workflow-handoffs-run-a'])
    expect(ctx.sections[0].compact).not.toContain('other run output')
  })

  it('workspace notes ride the assembler once the 09 P2 source is wired (real NotesStore)', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { NotesStore } = await import('@acorn/plugin-notes/testkit')
    const dir = mkdtempSync(join(tmpdir(), 'acorn-ctx-notes-'))
    try {
      const store = new NotesStore(dir)
      const location = { scope: 'task' as const, taskId: 'task1' }
      await store.create(location, 'eng-42 plan', { kind: 'plan', body: 'Guard the null token first.\n' })
      await store.create(location, 'handoff', {
        kind: 'handoff',
        author: 'agent',
        body: 'Left the redirect for next session.\n',
      })
      // The same wiring shape terminal.ts registers: task → workspace → notes list + bodies.
      notesSource = async () => {
        const list = await store.list(location)
        const out: Awaited<ReturnType<ContextNotesSource>> = []
        for (const s of list) {
          const n = await store.read(location, s.slug)
          out.push({
            slug: s.slug,
            scope: 'task',
            title: `${n.title} (${n.kind})`,
            kind: n.kind,
            body: n.body,
            author: n.author,
          })
        }
        return out
      }
      const ctx = await fetchCtx()
      const notes = ctx.sections.find((section) => section.id === 'notes')?.items ?? []
      expect(notes.map((note) => note.label).sort()).toEqual(['eng-42 plan (plan)', 'handoff (handoff)'])
      expect(notes.find((note) => note.label.startsWith('eng-42'))?.body).toContain('Guard the null token')
      // include filter still respected: pr-only leaves notes out.
      expect((await fetchCtx('?include=pr')).sections.some((section) => section.id === 'notes')).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('uses contribution defaults and enforces the declared note budget', async () => {
    notesSource = async () =>
      Array.from({ length: 12 }, (_, index) => ({
        slug: `n-${index}`,
        scope: 'task',
        title: `N${index}`,
        kind: 'plan',
        body: 'x'.repeat(2_100),
        author: 'user' as const,
      }))
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
