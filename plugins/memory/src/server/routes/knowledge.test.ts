import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppEnv } from '@acorn/plugin-api/testkit'
import { requireUser } from '@acorn/plugin-api/testkit'
import type { Env } from '@acorn/plugin-api/testkit'
import { knowledge, setKnowledgeBridge, type KnowledgeBridge } from './knowledge'

const req = (path: string, method = 'GET', body?: unknown) => new Request(`http://acorn.test/api${path}`, {
  method,
  headers: body === undefined ? undefined : { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

const as = (principal: unknown) => new Hono<AppEnv>()
  .use('/api/*', async (c, next) => { c.set('principal', principal as never); await next() })
  .route('/api', knowledge)
const device = () => as({ kind: 'device', userId: 'james', deviceId: 'device-1' })
const task = () => as({ kind: 'internal', userId: 'james', scope: 'task', taskId: 'task1' })
const service = () => as({ kind: 'internal', userId: 'james', scope: 'service' })

const bridge = (over: Partial<KnowledgeBridge> = {}): KnowledgeBridge => ({
  taskMemoryScope: async (taskId) => taskId === 'task1' ? { projectId: 'project-widget' } : null,
  memoryList: async () => [],
  memorySearch: async () => [],
  memoryAdd: async () => ({ path: '/x' }),
  ...over,
})

describe('memory routes', () => {
  afterEach(() => setKnowledgeBridge(null))

  it('routes memory list and add through its bridge', async () => {
    const calls: string[] = []
    setKnowledgeBridge(bridge({
      memoryList: async (projectId) => { calls.push(`list:${projectId}`); return [] },
      memoryAdd: async (taskId, input) => { calls.push(`add:${taskId}:${input.scope}`); return { path: '/x' } },
    }))
    const app = device()
    expect((await app.fetch(req('/memory?projectId=project-widget'), {} as Env)).status).toBe(200)
    expect((await app.fetch(req('/tasks/task1/memory', 'POST', { scope: 'private', name: 'n', description: 'd', type: 'reference', body: 'b' }), {} as Env)).status).toBe(200)
    expect(calls).toEqual(['list:project-widget', 'add:task1:private'])
  })

  it('rejects malformed memory input and a search with no query', async () => {
    setKnowledgeBridge(bridge())
    const app = device()
    expect((await app.fetch(req('/tasks/task1/memory', 'POST', { scope: 'nope' }), {} as Env)).status).toBe(400)
    expect((await app.fetch(req('/memory/search'), {} as Env)).status).toBe(400)
  })

  it('requires a principal and an available bridge', async () => {
    const gated = new Hono<AppEnv>().use('/api/*', requireUser).route('/api', knowledge)
    expect((await gated.fetch(req('/memory'), {} as Env)).status).toBe(401)
    expect((await device().fetch(req('/memory'), {} as Env)).status).toBe(503)
  })

  it('keeps Undo and manual writes behind device authority', async () => {
    const undo = vi.fn(async () => ({ ok: true }))
    const add = vi.fn(async () => ({ path: '/memory' }))
    setKnowledgeBridge(bridge({ memoryUndo: undo, memoryAdd: add, memoryProjectAdd: add }))
    for (const app of [task(), service()]) {
      expect((await app.fetch(req('/memory/changes/change-1/undo', 'POST'), {} as Env)).status).toBe(403)
      expect((await app.fetch(req('/tasks/task1/memory', 'POST', { scope: 'private', name: 'n', description: 'd', type: 'user', body: 'b' }), {} as Env)).status).toBe(403)
      expect((await app.fetch(req('/projects/project-widget/memory', 'POST', { scope: 'project', name: 'n', description: 'd', type: 'project', body: 'b' }), {} as Env)).status).toBe(403)
    }
    expect(undo).not.toHaveBeenCalled()
    expect(add).not.toHaveBeenCalled()
    expect((await device().fetch(req('/memory/changes/change-1/undo', 'POST'), {} as Env)).status).toBe(200)
    expect(undo).toHaveBeenCalledWith('change-1')
  })

  it('requires device authority and validates library operations before dispatch', async () => {
    const library = vi.fn(async () => ({ ok: true }))
    setKnowledgeBridge(bridge({ memoryLibrary: library }))
    for (const app of [task(), service()]) {
      expect((await app.fetch(req('/library/changes?projectId=project-widget', 'POST', {}), {} as Env)).status).toBe(403)
    }
    expect((await device().fetch(req('/library/caps', 'POST', { caps: { project: 199, private: 4000 } }), {} as Env)).status).toBe(400)
    expect(library).not.toHaveBeenCalled()
    expect((await device().fetch(req('/library/changes?projectId=project-widget', 'POST', {}), {} as Env)).status).toBe(200)
    expect(library).toHaveBeenCalledWith('changes', 'project-widget', {})
  })

  it('has no Notes routes', async () => {
    setKnowledgeBridge(bridge())
    for (const path of ['/workspaces/global/notes', '/workspaces/ws1/notes/slug', '/tasks/task1/notes']) {
      expect((await device().fetch(req(path), {} as Env)).status).toBe(404)
    }
  })

  it.each(['/memory', '/memory/search?q=reference'])('%s denies foreign and unknown projects before file reads', async (path) => {
    const scope = vi.fn<KnowledgeBridge['taskMemoryScope']>().mockResolvedValue({ projectId: 'project-widget' })
    const memoryList = vi.fn(async () => [])
    const memorySearch = vi.fn(async () => [])
    setKnowledgeBridge(bridge({ taskMemoryScope: scope, memoryList, memorySearch }))
    const denied = []
    for (const projectId of ['project-foreign', 'project-unknown']) {
      const response = await task().fetch(req(`${path}${path.includes('?') ? '&' : '?'}projectId=${projectId}`), {} as Env)
      expect(response.status).toBe(404)
      denied.push(await response.json())
    }
    expect(denied[0]).toEqual(denied[1])
    expect(scope.mock.calls).toEqual([['task1'], ['task1']])
    expect(memoryList).not.toHaveBeenCalled()
    expect(memorySearch).not.toHaveBeenCalled()
  })

  it.each(['/memory', '/memory/search?q=reference'])('%s permits own project/private scope and unconfined readers', async (path) => {
    const scope = vi.fn<KnowledgeBridge['taskMemoryScope']>().mockResolvedValue({ projectId: 'project-widget' })
    const memoryList = vi.fn(async () => [])
    const memorySearch = vi.fn(async () => [])
    setKnowledgeBridge(bridge({ taskMemoryScope: scope, memoryList, memorySearch }))
    const withProject = (projectId: string) => `${path}${path.includes('?') ? '&' : '?'}projectId=${projectId}`
    for (const request of [req(path), req(withProject('project-widget'))]) expect((await task().fetch(request, {} as Env)).status).toBe(200)
    expect(scope).toHaveBeenCalledTimes(2)
    scope.mockClear()
    for (const app of [device(), service()]) {
      expect((await app.fetch(req(withProject('project-foreign')), {} as Env)).status).toBe(200)
      expect((await app.fetch(req(path), {} as Env)).status).toBe(200)
    }
    expect(scope).not.toHaveBeenCalled()
    const reads = path.includes('search') ? memorySearch.mock.calls : memoryList.mock.calls
    expect(reads).toHaveLength(6)
    if (path.includes('search')) expect(reads).toEqual([['reference', undefined, undefined], ['reference', 'project-widget', undefined], ['reference', 'project-foreign', undefined], ['reference', undefined, undefined], ['reference', 'project-foreign', undefined], ['reference', undefined, undefined]])
    else expect(reads).toEqual([[undefined], ['project-widget'], ['project-foreign'], [undefined], ['project-foreign'], [undefined]])
  })

  it.each(['/memory', '/memory/search?q=reference'])('%s fails closed for missing tasks, missing task claims, and scope failures', async (path) => {
    const memoryList = vi.fn(async () => [])
    const memorySearch = vi.fn(async () => [])
    const taskMemoryScope = vi.fn<KnowledgeBridge['taskMemoryScope']>().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('synthetic internal detail'))
    setKnowledgeBridge(bridge({ taskMemoryScope, memoryList, memorySearch }))
    const denied = []
    for (const app of [task(), task(), as({ kind: 'internal', scope: 'task', userId: 'james' })]) {
      const response = await app.fetch(req(path), {} as Env)
      expect(response.status).toBe(404)
      denied.push(await response.json())
    }
    expect(denied[0]).toEqual(denied[1])
    expect(denied[1]).toEqual(denied[2])
    expect(JSON.stringify(denied)).not.toContain('synthetic internal detail')
    expect(taskMemoryScope).toHaveBeenCalledTimes(2)
    expect(memoryList).not.toHaveBeenCalled()
    expect(memorySearch).not.toHaveBeenCalled()
  })

  it('allows an existing task without a project to read only private memories', async () => {
    const memoryList = vi.fn(async () => [])
    setKnowledgeBridge(bridge({ taskMemoryScope: async () => ({ projectId: null }), memoryList }))
    expect((await task().fetch(req('/memory'), {} as Env)).status).toBe(200)
    expect((await task().fetch(req('/memory?projectId=project-widget'), {} as Env)).status).toBe(404)
    expect(memoryList).toHaveBeenCalledExactlyOnceWith(undefined)
  })
})
