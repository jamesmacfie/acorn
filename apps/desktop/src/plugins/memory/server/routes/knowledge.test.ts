import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppEnv } from '../../../../core/server/middleware/auth'
import { requireUser } from '../../../../core/server/middleware/requireUser'
import { knowledge, setKnowledgeBridge, type KnowledgeBridge } from './knowledge'

// Notes/memory write paths get validated bodies (the privileged-boundary contract); the store logic is covered by
// main/notes.test.ts, memory.test.ts, memoryProposals.test.ts. Here: routing + auth + validation.

const req = (url: string, method = 'GET', body?: unknown) =>
  new Request(`http://acorn.test${url}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const authed = () => {
  const app = new Hono<AppEnv>()
  app.use('/api/*', async (c, next) => {
    c.set('principal', { kind: 'user', user: { token: 't', login: 'james', name: '', avatar: '', scopes: [] } })
    await next()
  })
  return app.route('/api', knowledge)
}

const fake = (over: Partial<KnowledgeBridge> = {}): KnowledgeBridge => ({
  memoryList: async () => [],
  memorySearch: async () => [],
  memoryAdd: async () => ({ path: '/x' }),
  memoryProposals: async () => [],
  memoryResolveProposal: async () => ({ ok: true }),
  notesList: async () => [],
  notesRead: async () => ({}),
  notesCreate: async () => ({ slug: 's' }),
  notesWrite: async () => ({ ok: true }),
  notesSetIncluded: async () => ({ ok: true }),
  notesRemove: async () => ({ ok: true }),
  ...over,
})

describe('knowledge routes (memory + notes)', () => {
  afterEach(() => setKnowledgeBridge(null))

  it('routes memory list/search/add/proposals and note CRUD to the bridge', async () => {
    const calls: string[] = []
    setKnowledgeBridge(fake({
      memoryList: async (repo) => (calls.push(`list:${repo ?? ''}`), []),
      memoryAdd: async (taskId, p) => (calls.push(`add:${taskId}:${p.scope}`), { path: '/x' }),
      notesCreate: async (location, title) => (calls.push(`create:${location.scope}:${location.scope === 'workspace' ? location.workspaceId : ''}:${title}`), { slug: 's' }),
      notesRemove: async (location, slug) => (calls.push(`rm:${location.scope}:${location.scope === 'workspace' ? location.workspaceId : ''}:${slug}`), { ok: true }),
    }))
    const app = authed()
    await app.fetch(req('/api/memory?repo=acme/widget'), {} as Env)
    await app.fetch(req('/api/tasks/task1/memory', 'POST', { scope: 'private', name: 'n', description: 'd', type: 'reference', body: 'b' }), {} as Env)
    await app.fetch(req('/api/workspaces/ws1/notes', 'POST', { title: 'Hi' }), {} as Env)
    await app.fetch(req('/api/workspaces/ws1/notes/hi', 'DELETE'), {} as Env)
    await app.fetch(req('/api/tasks/task1/notes', 'POST', { title: 'Task note' }), {} as Env)
    expect(calls).toEqual(['list:acme/widget', 'add:task1:private', 'create:workspace:ws1:Hi', 'rm:workspace:ws1:hi', 'create:task::Task note'])
  })

  it('400s malformed add / resolve / note write bodies and a search with no q', async () => {
    setKnowledgeBridge(fake())
    const app = authed()
    expect((await app.fetch(req('/api/tasks/task1/memory', 'POST', { scope: 'nope' }), {} as Env)).status).toBe(400)
    expect((await app.fetch(req('/api/memory/proposals/p1/resolve', 'POST', {}), {} as Env)).status).toBe(400)
    expect((await app.fetch(req('/api/workspaces/ws1/notes/hi', 'PUT', {}), {} as Env)).status).toBe(400)
    expect((await app.fetch(req('/api/memory/search'), {} as Env)).status).toBe(400)
  })

  it('401s without a principal; 503s without a bridge', async () => {
    const gated = new Hono<AppEnv>().use('/api/*', requireUser).route('/api', knowledge)
    expect((await gated.fetch(req('/api/memory'), {} as Env)).status).toBe(401)
    expect((await authed().fetch(req('/api/memory'), {} as Env)).status).toBe(503)
  })
})
