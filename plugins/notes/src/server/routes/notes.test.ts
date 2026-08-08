import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { NoteKind } from '@acorn/protocol/notes.ts'
import type { Env } from '@acorn/node-core/main/bindings.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { requireUser } from '@acorn/node-core/server/middleware/requireUser.ts'
import { setRouteTestCapability } from '@acorn/node-core/server/bridge.ts'
import { NOTES_STORE, type NotesStoreCapability } from '../../contract/store'
import { notes } from './notes'

const request = (url: string, method = 'GET', body?: unknown) =>
  new Request(`http://acorn.test${url}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const appFor = (principal?: unknown) => {
  const app = new Hono<AppEnv>()
  if (principal) {
    app.use('/api/*', async (c, next) => {
      c.set('principal', principal as never)
      await next()
    })
  }
  return app.route('/api', notes)
}

const fakeStore = (overrides: Partial<NotesStoreCapability> = {}): NotesStoreCapability => ({
  list: async () => [],
  read: async () => ({
    slug: 'plan',
    title: 'Plan',
    author: 'user',
    kind: 'plan',
    originSessionId: null,
    included: true,
    originTaskId: null,
    createdAt: 1,
    body: 'body',
  }),
  create: async (_location, _title, _options) => ({ slug: 'plan' }),
  write: async () => {},
  append: async () => {},
  setIncluded: async () => {},
  setTitle: async () => {},
  remove: async () => {},
  ...overrides,
})

describe('notes-owned routes', () => {
  afterEach(() => setRouteTestCapability(NOTES_STORE, null))

  it('serves task and workspace CRUD under the notes namespace', async () => {
    const calls: string[] = []
    setRouteTestCapability(NOTES_STORE, fakeStore({
      create: async (location, title, options) => {
        calls.push(`create:${location.scope}:${title}:${options?.kind ?? ''}`)
        return { slug: 'plan' }
      },
      setTitle: async (location, slug, title) => {
        calls.push(`title:${location.scope}:${slug}:${title}`)
      },
    }))
    const app = appFor({ kind: 'device', userId: 'james' })

    expect((await app.fetch(request('/api/tasks/task1/notes', 'POST', { title: 'Plan', kind: 'plan' }), {} as Env)).status).toBe(200)
    expect((await app.fetch(request('/api/workspaces/ws1/notes/plan/title', 'POST', { title: 'Renamed' }), {} as Env)).status).toBe(200)
    expect(calls).toEqual(['create:task:Plan:plan', 'title:workspace:plan:Renamed'])
  })

  it('validates note kinds at the route boundary', async () => {
    setRouteTestCapability(NOTES_STORE, fakeStore())
    const response = await appFor({ kind: 'device', userId: 'james' }).fetch(
      request('/api/tasks/task1/notes', 'POST', { title: 'Plan', kind: 'unknown' as NoteKind }),
      {} as Env,
    )
    expect(response.status).toBe(400)
  })

  it('requires a device principal for workspace routes and reports an unavailable store', async () => {
    const gated = new Hono<AppEnv>().use('/api/*', requireUser).route('/api', notes)
    expect((await gated.fetch(request('/api/workspaces/ws1/notes'), {} as Env)).status).toBe(401)
    expect((await appFor({ kind: 'device', userId: 'james' }).fetch(request('/api/tasks/task1/notes'), {} as Env)).status).toBe(503)
  })
})
