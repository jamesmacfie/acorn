import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '@acorn/protocol/api.ts'
import { getDb, schema } from '../../db'
import type { AppEnv } from '../../middleware/auth'
import { tasks } from './tasks'
import { makeTestDb, type TestDb } from '../../../testkit/db'

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
// list is what every client refetches when one arrives
// (docs/performance.md § 2026-09-03 — phase 5).

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
})
