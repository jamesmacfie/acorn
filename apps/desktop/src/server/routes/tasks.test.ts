import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task, TaskLink } from '../../shared/api'
import { getDb } from '../db'
import type { AppEnv } from '../middleware/auth'
import { tasks } from './tasks'
import { makeTestDb, type TestDb } from './testDb'

vi.mock('../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db')>()
  return { ...actual, getDb: vi.fn() }
})

const makeApp = () => {
  const app = new Hono<AppEnv>()
  app.use('/api/*', async (c, next) => {
    c.set('user', { token: 'token', login: 'james', name: '', avatar: '', scopes: [] })
    await next()
  })
  app.route('/api/tasks', tasks)
  return app
}

const jsonReq = (url: string, method: string, body: unknown) =>
  new Request(`http://acorn.test${url}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('task links grow/shrink', () => {
  let t: TestDb
  let app: Hono<AppEnv>

  beforeEach(() => {
    t = makeTestDb()
    vi.mocked(getDb).mockReturnValue(t.db)
    app = makeApp()
  })

  afterEach(() => t.cleanup())

  const createTask = async (): Promise<Task> => {
    const res = await app.fetch(
      jsonReq('/api/tasks', 'POST', { origin: 'local', repoOwner: 'acme', repoName: 'widget', branch: 'feat/x' }),
      {} as Env,
    )
    expect(res.status).toBe(200)
    return res.json()
  }

  const listLinks = async (id: string): Promise<TaskLink[]> => {
    const res = await app.fetch(new Request('http://acorn.test/api/tasks'), {} as Env)
    const all: Task[] = await res.json()
    return all.find((x) => x.id === id)?.links ?? []
  }

  it('add → link appears in the task GET payload', async () => {
    const task = await createTask()
    const res = await app.fetch(jsonReq(`/api/tasks/${task.id}/links`, 'POST', { integrationId: 'int-1', provider: 'linear', identifier: 'ENG-42' }), {} as Env)
    expect(res.status).toBe(200)
    expect(await listLinks(task.id)).toEqual([{ integrationId: 'int-1', provider: 'linear', identifier: 'ENG-42' }])
  })

  it('duplicate add is a no-op', async () => {
    const task = await createTask()
    const link = { integrationId: 'int-1', provider: 'linear', identifier: 'ENG-42' }
    await app.fetch(jsonReq(`/api/tasks/${task.id}/links`, 'POST', link), {} as Env)
    const res = await app.fetch(jsonReq(`/api/tasks/${task.id}/links`, 'POST', link), {} as Env)
    expect(res.status).toBe(200)
    expect(await listLinks(task.id)).toHaveLength(1)
  })

  it('delete removes exactly one link', async () => {
    const task = await createTask()
    await app.fetch(jsonReq(`/api/tasks/${task.id}/links`, 'POST', { integrationId: 'int-1', provider: 'linear', identifier: 'ENG-42' }), {} as Env)
    await app.fetch(jsonReq(`/api/tasks/${task.id}/links`, 'POST', { integrationId: 'int-2', provider: 'rollbar', identifier: '142' }), {} as Env)
    const res = await app.fetch(jsonReq(`/api/tasks/${task.id}/links`, 'DELETE', { integrationId: 'int-1', identifier: 'ENG-42' }), {} as Env)
    expect(res.status).toBe(200)
    expect(await listLinks(task.id)).toEqual([{ integrationId: 'int-2', provider: 'rollbar', identifier: '142' }])
  })

  it('unknown task → 404 on add', async () => {
    const res = await app.fetch(jsonReq('/api/tasks/nope/links', 'POST', { integrationId: 'int-1', provider: 'linear', identifier: 'ENG-42' }), {} as Env)
    expect(res.status).toBe(404)
  })

  it('missing fields → 400', async () => {
    const task = await createTask()
    const res = await app.fetch(jsonReq(`/api/tasks/${task.id}/links`, 'POST', { provider: 'linear' }), {} as Env)
    expect(res.status).toBe(400)
  })

  it('unknown task → 404 on PATCH', async () => {
    const res = await app.fetch(jsonReq('/api/tasks/nope', 'PATCH', { title: 'Ghost' }), {} as Env)
    expect(res.status).toBe(404)
  })

  it('PATCH renames an existing task', async () => {
    const task = await createTask()
    const res = await app.fetch(jsonReq(`/api/tasks/${task.id}`, 'PATCH', { title: 'Renamed' }), {} as Env)
    expect(res.status).toBe(200)
    const list = await app.fetch(new Request('http://acorn.test/api/tasks'), {} as Env)
    const all: Task[] = await list.json()
    expect(all.find((x) => x.id === task.id)?.title).toBe('Renamed')
  })
})
