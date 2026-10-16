import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestPluginDb, testGate, type TestPluginDb } from '@acorn/plugin-api/testkit'
import type { AppEnv, Env, Principal } from '@acorn/plugin-api/testkit'
import type { CoreServices } from '@acorn/plugin-api/node'
import { createPullRequest } from '../createPull'
import { checks, comments, prFiles, pullRequests, repos, reviews, reviewThreads } from '../../node/schema'
import { changeRequestRoutes } from './changeRequests'

vi.mock('../createPull', () => ({ createPullRequest: vi.fn() }))
vi.mock('../githubToken', () => ({ githubToken: async () => 'token' }))

const USER = 'owner'
const task = {
  id: 'task-1',
  title: 'Task',
  projectId: 'project-1',
  branch: 'feat/task',
  worktreePath: null,
  pullNumber: 7,
}
const project = {
  id: 'project-1',
  name: 'widget',
  path: null,
  workspaceId: 'workspace-1',
  github: { owner: 'acme', name: 'widget', repoId: 1 },
}
const core = {
  tasks: { load: async (id: string) => (id === task.id ? task : null) },
  projects: { byId: async () => project },
} as unknown as Pick<CoreServices, 'projects' | 'tasks'>
// How core calls the read routes: as the task.
const TASK_PRINCIPAL: Principal = { kind: 'internal', scope: 'task', userId: USER, taskId: 'task-1' }

// The routes behind core's `pr` section and `pr_*` tools, over real rows in this plugin's own migrated
// SQLite file, because the grouping of inline comments back into threads and the "absent is not empty"
// answer are both worth pinning.
describe('the change request routes', () => {
  let testDb: TestPluginDb

  beforeEach(async () => {
    testDb = makeTestPluginDb('github')
    await testDb.db
      .insert(repos)
      .values({ userId: USER, id: 1, owner: 'acme', name: 'widget', private: false, fetchedAt: 1 })
    await testDb.db
      .insert(pullRequests)
      .values({ userId: USER, repoId: 1, number: 7, state: 'open', title: 'Ship it', body: 'Why', fetchedAt: 1 })
  })

  afterEach(() => testDb.cleanup())

  const call = async (path: string, init: RequestInit = {}, principal: Principal = TASK_PRINCIPAL) => {
    const app = new Hono<AppEnv>()
      .use('/api/*', ...testGate(principal))
      .route('/api/change-requests', changeRequestRoutes(testDb.db, core))
    const response = await app.fetch(new Request(`http://acorn.test/api/change-requests${path}`, init), {} as Env)
    return { status: response.status, body: (await response.json()) as Record<string, unknown> }
  }

  it("answers the pull request's title, body, and sorted changed files", async () => {
    await testDb.db.insert(prFiles).values(
      ['src/b.ts', 'src/a.ts'].map((path, position) => ({
        userId: USER,
        repoId: 1,
        number: 7,
        path,
        status: 'modified',
        additions: 1,
        deletions: 0,
        sha: `s${position}`,
        position,
        patchState: 'unavailable' as const,
      })),
    )
    expect(await call('/7?taskId=task-1')).toEqual({
      status: 200,
      body: { number: 7, title: 'Ship it', body: 'Why', changedFiles: ['src/a.ts', 'src/b.ts'] },
    })
  })

  it('groups inline comments into their threads and leaves resolved ones out by default', async () => {
    await testDb.db.insert(reviewThreads).values([
      {
        userId: USER,
        repoId: 1,
        number: 7,
        threadId: 't1',
        id: 'c1',
        path: 'src/a.ts',
        line: null,
        originalLine: 10,
        outdated: true,
        side: 'RIGHT',
        resolved: false,
        author: 'reviewer',
        body: 'rename this',
        createdAt: 2,
        position: 0,
      },
      {
        userId: USER,
        repoId: 1,
        number: 7,
        threadId: 't1',
        id: 'c2',
        path: 'src/a.ts',
        line: null,
        originalLine: 10,
        outdated: true,
        side: 'RIGHT',
        resolved: false,
        author: 'author',
        body: 'done',
        createdAt: 3,
        position: 1,
      },
      {
        userId: USER,
        repoId: 1,
        number: 7,
        threadId: 't2',
        id: 'c3',
        path: 'src/b.ts',
        line: 4,
        side: 'RIGHT',
        resolved: true,
        author: 'reviewer',
        body: 'settled',
        createdAt: 1,
        position: 2,
      },
    ])
    await testDb.db.insert(reviews).values({
      userId: USER,
      repoId: 1,
      number: 7,
      id: 'r1',
      author: 'reviewer',
      state: 'CHANGES_REQUESTED',
      body: 'one thing',
      submittedAt: 4,
      position: 0,
    })
    await testDb.db.insert(comments).values({
      userId: USER,
      repoId: 1,
      number: 7,
      id: 'g1',
      author: 'bot',
      body: 'deployed',
      createdAt: 5,
      position: 0,
    })

    const open = (await call('/7/feedback?taskId=task-1')).body as {
      number: number
      reviews: { state: string | null }[]
      threads: { threadId: string; comments: { body: string | null }[] }[]
      comments: { body: string | null }[]
      omitted: number
    }
    expect(open.number).toBe(7)
    expect(open.reviews).toEqual([
      { author: 'reviewer', state: 'CHANGES_REQUESTED', body: 'one thing', submittedAt: 4 },
    ])
    expect(open.threads).toHaveLength(1)
    expect(open.threads[0]).toMatchObject({
      threadId: 't1',
      line: null,
      originalLine: 10,
      outdated: true,
      resolved: false,
    })
    expect(open.threads[0]!.comments.map((comment) => comment.body)).toEqual(['rename this', 'done'])
    expect(open.comments.map((comment) => comment.body)).toEqual(['deployed'])
    expect(open.omitted).toBe(0)

    const all = (await call('/7/feedback?taskId=task-1&includeResolved=true')).body as { threads: unknown[] }
    expect(all.threads).toHaveLength(2)
  })

  it('calls out the failing checks and treats a check with no status as still running', async () => {
    await testDb.db.insert(checks).values([
      { userId: USER, repoId: 1, number: 7, name: 'lint', status: 'success', url: null, runId: null, position: 0 },
      {
        userId: USER,
        repoId: 1,
        number: 7,
        name: 'test',
        status: 'failure',
        url: 'https://example.com/run',
        runId: 42,
        position: 1,
      },
      { userId: USER, repoId: 1, number: 7, name: 'deploy', status: null, url: null, runId: null, position: 2 },
      // How the mirror stores a check run that has not finished: its status, since it has no conclusion.
      { userId: USER, repoId: 1, number: 7, name: 'e2e', status: 'QUEUED', url: null, runId: null, position: 3 },
      { userId: USER, repoId: 1, number: 7, name: 'build', status: 'IN_PROGRESS', url: null, runId: null, position: 4 },
    ])

    const result = (await call('/7/checks?taskId=task-1')).body as {
      number: number
      checks: { name: string }[]
      failing: string[]
      pending: string[]
    }
    expect(result.number).toBe(7)
    expect(result.checks.map((check) => check.name)).toEqual(['build', 'deploy', 'e2e', 'lint', 'test'])
    expect(result.failing).toEqual(['test'])
    expect(result.pending).toEqual(['build', 'deploy', 'e2e'])
  })

  // An unmirrored PR is not a PR with no feedback and not a green one, so both answer 404.
  it('answers 404 for a pull request the mirror lacks, or a task the caller may not act on', async () => {
    expect((await call('/8?taskId=task-1')).status).toBe(404)
    expect((await call('/7/checks?taskId=task-1')).status).toBe(404)
    expect((await call('/7?taskId=task-2')).status).toBe(404)
    expect((await call('/7')).status).toBe(404)
  })

  it('opens a pull request from the head core sends', async () => {
    vi.mocked(createPullRequest).mockResolvedValue({ ok: true, number: 73 })
    const body = { taskId: 'task-1', title: 'Ship it', body: 'Details', base: 'main', head: 'feat/task', draft: true }
    const service: Principal = { kind: 'internal', scope: 'service', userId: USER }
    const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    expect(await call('', init, service)).toEqual({ status: 200, body: { number: 73 } })
    expect(createPullRequest).toHaveBeenCalledWith(
      'token',
      expect.anything(),
      USER,
      'acme',
      'widget',
      { title: 'Ship it', body: 'Details', base: 'main', head: 'feat/task', draft: true },
      expect.any(Function),
    )
    expect((await call('', { ...init, body: JSON.stringify({ ...body, title: ' ' }) }, service)).status).toBe(400)
  })
})
