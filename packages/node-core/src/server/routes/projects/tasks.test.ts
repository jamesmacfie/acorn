import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '@acorn/protocol/api.ts'
import { getDb, schema } from '../../db'
import type { AppEnv } from '../../middleware/auth'
import { tasks } from './tasks'
import { makeTestDb, type TestDb } from '../../../testkit/db'
import { clearHooks, registerHookHandler } from '../../pluginHost/hooks'
import { unclaimedWorktrees } from '../../worktrees/taskWorktree'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('../../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db')>()
  return { ...actual, getDb: vi.fn() }
})

const { broadcasts } = vi.hoisted(() => ({ broadcasts: [] as Record<string, unknown>[] }))
vi.mock('../../transport/wsHub', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  wsBroadcast: (frame: Record<string, unknown>) => void broadcasts.push(frame),
}))

// What the active-task list costs to answer.
//
// It used to `await getProject` inside a loop over rows, so a hundred tasks in one project was a
// hundred identical `SELECT`s, on the node's single event loop, on every `tasks:changed` — and the
// list is what every client refetches when one arrives.

const makeApp = () => {
  const app = new Hono<AppEnv>()
  app.use('/api/*', async (c, next) => {
    c.set('principal', { kind: 'device', userId: 'james' })
    await next()
  })
  app.route('/api/tasks', tasks)
  return app
}

describe('the active-task list route', () => {
  let t: TestDb
  let app: Hono<AppEnv>

  const seed = async (projectCount: number, tasksPerProject: number) => {
    const now = Date.now()
    await t.db.insert(schema.workspaces).values({ id: 'w1', name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    for (let p = 0; p < projectCount; p++) {
      await t.db.insert(schema.projects).values({
        id: `project-${p}`, name: `p${p}`, path: `/tmp/p${p}`, workspaceId: 'w1', sort: p, hidden: false,
        vcs: 'git', defaultBranch: 'main', remoteUrl: null, githubOwner: 'acme', githubName: `p${p}`, githubRepoId: null,
        createdAt: now, updatedAt: now,
      })
      for (let i = 0; i < tasksPerProject; i++) {
        await t.db.insert(schema.tasks).values({
          id: `task-${p}-${i}`, title: `T${p}${i}`, origin: 'local', projectId: `project-${p}`,
          branch: `feat-${p}-${i}`, status: 'active', sort: p * 100 + i, createdAt: now, updatedAt: now,
        })
      }
    }
  }

  beforeEach(() => {
    t = makeTestDb()
    broadcasts.length = 0
    vi.mocked(getDb).mockReturnValue(t.db)
    app = makeApp()
  })

  afterEach(() => {
    t.cleanup()
    vi.restoreAllMocks()
  })

  const listWithQueryCount = async (): Promise<{ body: Task[]; queries: number }> => {
    const select = vi.spyOn(t.db, 'select')
    const response = await app.request('http://acorn.test/api/tasks')
    const text = await response.text()
    if (response.status !== 200) throw new Error(`${response.status}: ${text}`)
    const body = JSON.parse(text) as Task[]
    const queries = select.mock.calls.length
    select.mockRestore()
    return { body, queries }
  }

  // Three: the tasks, their links, and every project they mention. The number is the point, not the
  // three: what must not happen is that it grows with the number of tasks.
  it('issues one project query however many tasks there are', async () => {
    await seed(1, 2)
    const few = await listWithQueryCount()
    expect(few.body).toHaveLength(2)
    expect(few.queries).toBe(3)

    t.cleanup()
    t = makeTestDb()
    vi.mocked(getDb).mockReturnValue(t.db)
    await seed(3, 8)
    const many = await listWithQueryCount()
    expect(many.body).toHaveLength(24)
    expect(many.queries).toBe(3)
  })

  it('still resolves the project onto each task row', async () => {
    await seed(2, 1)
    const { body } = await listWithQueryCount()
    expect(body.map((task) => [task.id, task.github?.name])).toEqual([
      ['task-0-0', 'p0'],
      ['task-1-0', 'p1'],
    ])
  })

  it('asks nothing about projects when there are no active tasks', async () => {
    const { body, queries } = await listWithQueryCount()
    expect(body).toEqual([])
    expect(queries).toBe(1)
  })

  it('announces the affected task id and suppresses unchanged patches', async () => {
    await seed(1, 0)
    const created = await app.request('http://acorn.test/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin: 'local', projectId: 'project-0', title: 'New task' }),
    })
    expect(created.status).toBe(200)
    const task = (await created.json()) as Task
    expect(broadcasts).toEqual([{ channel: 'tasks:changed', taskId: task.id }])
    broadcasts.length = 0

    const patch = (title: string) => app.request(`http://acorn.test/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    expect((await patch('New task')).status).toBe(200)
    expect((await patch('Renamed task')).status).toBe(200)

    expect(broadcasts).toEqual([{ channel: 'tasks:changed', taskId: task.id }])
  })

  it('runs the archiving hook once when a status change archives the task', async () => {
    await seed(1, 1)
    const archiving: string[] = []
    registerHookHandler({
      id: 'probe:archiving',
      pluginId: 'probe',
      point: 'core:task-archiving',
      mode: 'transform',
      priority: 500,
      call: async (payload) => {
        const [row] = await t.db.select().from(schema.tasks).where(eq(schema.tasks.id, payload.taskId as string))
        archiving.push(`${payload.taskId as string}:${row?.status}`)
        return { payload }
      },
    })
    try {
      const patch = (status: 'active' | 'archived') => app.request('http://acorn.test/api/tasks/task-0-0', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      expect((await patch('archived')).status).toBe(200)
      expect((await patch('archived')).status).toBe(200)
      expect((await patch('active')).status).toBe(200)
      // After the write, so nothing can start new work on the task while its plugins stop theirs.
      expect(archiving).toEqual(['task-0-0:archived'])
    } finally {
      clearHooks('probe')
    }
  })

  it('stores setup opt-out per task and defaults other task seeds to setup enabled', async () => {
    await seed(1, 0)
    const create = (body: Record<string, unknown>) => app.request('http://acorn.test/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin: 'local', projectId: 'project-0', branch: 'feature', ...body }),
    })

    const skipped = await create({ title: 'Skip setup', skipSetup: true })
    const ordinary = await create({ title: 'Run setup' })
    expect(skipped.status).toBe(200)
    expect(ordinary.status).toBe(200)
    const skippedId = ((await skipped.json()) as Task).id
    const ordinaryId = ((await ordinary.json()) as Task).id
    const rows = await t.db.select({ id: schema.tasks.id, skipSetup: schema.tasks.skipSetup }).from(schema.tasks)
      .where(eq(schema.tasks.projectId, 'project-0'))
    expect(rows).toContainEqual({ id: skippedId, skipSetup: true })
    expect(rows).toContainEqual({ id: ordinaryId, skipSetup: false })
    expect((await create({ skipSetup: 'yes' })).status).toBe(400)
  })
})

describe('creating a task on an existing worktree', () => {
  let t: TestDb
  let app: Hono<AppEnv>
  let dir: string
  let worktree: string

  beforeEach(async () => {
    t = makeTestDb()
    vi.mocked(getDb).mockReturnValue(t.db)
    app = makeApp()
    dir = mkdtempSync(join(tmpdir(), 'acorn-attach-'))
    const checkout = join(dir, 'checkout')
    worktree = join(dir, 'wt')
    const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'ignore' })
    execFileSync('git', ['init', '-q', '-b', 'main', checkout])
    git(checkout, '-c', 'user.email=t@t.test', '-c', 'user.name=T', 'commit', '-q', '--allow-empty', '-m', 'init')
    git(checkout, 'worktree', 'add', '-q', '-b', 'feat/elsewhere', worktree)
    git(checkout, 'worktree', 'add', '-q', '--detach', join(dir, 'detached'))
    const now = Date.now()
    await t.db.insert(schema.workspaces).values({ id: 'w1', name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await t.db.insert(schema.projects).values({
      id: 'p', name: 'p', path: checkout, workspaceId: 'w1', sort: 0, hidden: false,
      vcs: 'git', defaultBranch: 'main', remoteUrl: null, githubOwner: null, githubName: null, githubRepoId: null,
      createdAt: now, updatedAt: now,
    })
  })

  afterEach(() => {
    t.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  const create = (worktreePath: string) => app.request('http://acorn.test/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origin: 'local', projectId: 'p', title: 'Adopted', worktreePath, branch: 'ignored' }),
  })

  it('lists only branch worktrees, takes the branch from git, and refuses one already in use', async () => {
    const project = (await t.db.select().from(schema.projects))[0]!
    const free = await unclaimedWorktrees(t.db, project)
    expect(free.map((wt) => wt.branch)).toEqual(['feat/elsewhere'])

    const res = await create(free[0]!.path)
    expect(res.status).toBe(200)
    const task = await res.json() as Task
    expect(task.branch).toBe('feat/elsewhere')
    expect(task.worktreePath).toBe(free[0]!.path)

    expect(await unclaimedWorktrees(t.db, project)).toEqual([])
    expect((await create(free[0]!.path)).status).toBe(409)
    expect((await create(join(dir, 'detached'))).status).toBe(409)
  })
})
