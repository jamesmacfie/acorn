import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReviewNote } from '../../shared/api'
import { getDb, schema } from '../db'
import type { AppEnv } from '../middleware/auth'
import { reviewNotes } from './reviewNotes'
import { makeTestDb, type TestDb } from './testDb'

vi.mock('../db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db')>()
  return { ...actual, getDb: vi.fn() }
})

const jsonReq = (url: string, method: string, body?: unknown) =>
  new Request(`http://acorn.test${url}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

describe('review notes CRUD + sentAt lifecycle (docs/panes.md)', () => {
  let t: TestDb
  let app: Hono<AppEnv>

  beforeEach(async () => {
    t = makeTestDb()
    vi.mocked(getDb).mockReturnValue(t.db)
    app = new Hono<AppEnv>()
    app.use('/api/*', async (c, next) => {
      c.set('principal', { kind: 'user', user: { token: 'token', login: 'james', name: '', avatar: '', scopes: [] } })
      await next()
    })
    app.route('/api/tasks', reviewNotes)
    const now = Date.now()
    await t.db.insert(schema.tasks).values({
      id: 'task1',
      title: 'T',
      origin: 'local',
      repoOwner: 'acme',
      repoName: 'widget',
      branch: 'feat/x',
      worktreePath: null,
      pullNumber: null,
      status: 'active',
      sort: 0,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    })
  })

  afterEach(() => t.cleanup())

  const list = async (): Promise<ReviewNote[]> => (await app.fetch(jsonReq('/api/tasks/task1/review-notes', 'GET'), {} as Env)).json()

  const create = async (over: Record<string, unknown> = {}): Promise<ReviewNote> => {
    const res = await app.fetch(
      jsonReq('/api/tasks/task1/review-notes', 'POST', {
        path: 'src/auth/login.ts',
        side: 'additions',
        startLine: 42,
        endLine: 48,
        snippet: 'const token = null',
        body: 'Handle the null token case before the redirect.',
        ...over,
      }),
      {} as Env,
    )
    expect(res.status).toBe(200)
    return res.json()
  }

  it('create → list → delete', async () => {
    const note = await create()
    expect(note.sentAt).toBeNull()
    expect(await list()).toHaveLength(1)
    await app.fetch(jsonReq(`/api/tasks/task1/review-notes/${note.id}`, 'DELETE'), {} as Env)
    expect(await list()).toHaveLength(0)
  })

  it('send stamps sentAt; edit clears it', async () => {
    const a = await create()
    const b = await create({ startLine: 80, endLine: 80, body: 'This log line leaks the token — drop it.' })
    const res = await app.fetch(jsonReq('/api/tasks/task1/review-notes/sent', 'POST', { ids: [a.id, b.id] }), {} as Env)
    expect(res.status).toBe(200)
    let all = await list()
    expect(all.every((n) => n.sentAt != null)).toBe(true)

    await app.fetch(jsonReq(`/api/tasks/task1/review-notes/${a.id}`, 'PATCH', { body: 'Edited — resend me.' }), {} as Env)
    all = await list()
    expect(all.find((n) => n.id === a.id)?.sentAt).toBeNull()
    expect(all.find((n) => n.id === a.id)?.body).toBe('Edited — resend me.')
    expect(all.find((n) => n.id === b.id)?.sentAt).not.toBeNull()
  })

  it('validates the anchor + body; unknown task 404s', async () => {
    expect((await app.fetch(jsonReq('/api/tasks/task1/review-notes', 'POST', { path: 'a.ts', side: 'left', startLine: 1, body: 'x' }), {} as Env)).status).toBe(400)
    expect((await app.fetch(jsonReq('/api/tasks/task1/review-notes', 'POST', { path: 'a.ts', side: 'additions', startLine: 5, endLine: 3, body: 'x' }), {} as Env)).status).toBe(400)
    expect((await app.fetch(jsonReq('/api/tasks/nope/review-notes', 'POST', { path: 'a.ts', side: 'additions', startLine: 1, endLine: 1, body: 'x' }), {} as Env)).status).toBe(404)
  })
})
