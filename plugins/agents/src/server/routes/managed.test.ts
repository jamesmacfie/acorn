import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import type { Env } from '@acorn/node-core/main/bindings.ts'
import { managedAgents, setManagedAgentsBridge, type ManagedAgentsBridge } from './managed'

const req = (url: string, method = 'GET', body?: unknown) =>
  new Request(`http://acorn.test${url}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json', 'idempotency-key': 'k'.repeat(12) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const as = (principal: unknown) => {
  const app = new Hono<AppEnv>()
  app.use('/api/*', async (c, next) => {
    c.set('principal', principal as never)
    await next()
  })
  return app.route('/api', managedAgents)
}
const authed = () => as({ kind: 'device', userId: 'james' })
// The credential injected into every agent session's environment.
const asTask1 = () => as({ kind: 'internal', userId: 'james', scope: 'task', taskId: 'task1' })
const asService = () => as({ kind: 'internal', userId: 'james', scope: 'service' })

// s1/a1/f1 belong to task1; s2/a2/f2 to task2. Anything else does not exist, and the guard must not
// distinguish "not yours" from "no such id".
const OWNERS: Record<string, string> = { s1: 'task1', s2: 'task2' }
const ATTACHMENTS: Record<string, string> = { a1: 'task1', a2: 'task2' }
const ARTIFACTS: Record<string, string> = { f1: 's1', f2: 's2' }

// Every method not named by a test throws, so a route that slips past its guard fails loudly rather than
// returning an empty success that the assertion below would read as "denied".
const unreached = (name: string) => () => {
  throw new Error(`bridge.${name} should not have been reached`)
}
const METHODS = [
  'providers', 'uploadAttachment', 'attachment', 'removeAttachment', 'artifacts', 'artifact',
  'artifactContent', 'createSession', 'importTranscript', 'verifyImportedResume', 'listSessions',
  'snapshot', 'events', 'enqueueTurn', 'patchQueuedTurn', 'cancelTurn', 'resolveRequest',
  'patchSession', 'fork', 'compact', 'deleteSession', 'handoffToTerminal', 'resumeManaged',
  'exportSession', 'wait', 'search',
] as const

const fake = (over: Partial<ManagedAgentsBridge> = {}): ManagedAgentsBridge =>
  ({
    ...Object.fromEntries(METHODS.map((name) => [name, unreached(name)])),
    taskIdForSession: async (id: string) => OWNERS[id] ?? null,
    taskIdForAttachment: async (id: string) => ATTACHMENTS[id] ?? null,
    taskIdForArtifact: async (id: string) => OWNERS[ARTIFACTS[id] ?? ''] ?? null,
    ...over,
  }) as ManagedAgentsBridge

describe('a task-scoped credential is confined to its own agent sessions', () => {
  afterEach(() => setManagedAgentsBridge(null))

  it('cannot read, drive or fork another task session, and cannot probe session ids', async () => {
    setManagedAgentsBridge(fake())
    const app = asTask1()
    for (const sessionId of ['s2', 'nope']) {
      // A read is the transcript of another task's agent; the writes are worse.
      expect((await app.fetch(req(`/api/sessions/${sessionId}`), {} as Env)).status).toBe(404)
      expect((await app.fetch(req(`/api/sessions/${sessionId}/events`), {} as Env)).status).toBe(404)
      expect((await app.fetch(req(`/api/sessions/${sessionId}/export`), {} as Env)).status).toBe(404)
      expect((await app.fetch(req(`/api/sessions/${sessionId}/artifacts`), {} as Env)).status).toBe(404)
      expect((await app.fetch(req(`/api/sessions/${sessionId}/cancel`, 'POST', {}), {} as Env)).status).toBe(404)
      expect((await app.fetch(req(`/api/sessions/${sessionId}/fork`, 'POST', {}), {} as Env)).status).toBe(404)
      expect((await app.fetch(req(`/api/sessions/${sessionId}/compact`, 'POST'), {} as Env)).status).toBe(404)
      expect((await app.fetch(req(`/api/sessions/${sessionId}/handoff-terminal`, 'POST'), {} as Env)).status).toBe(404)
      expect((await app.fetch(req(`/api/sessions/${sessionId}/turns`, 'POST', { input: [{ type: 'text', text: 'x' }] }), {} as Env)).status).toBe(404)
      expect((await app.fetch(req(`/api/sessions/${sessionId}`, 'PATCH', { title: 'stolen' }), {} as Env)).status).toBe(404)
      expect((await app.fetch(req(`/api/sessions/${sessionId}`, 'DELETE'), {} as Env)).status).toBe(404)
    }
  })

  it('reaches its own session, so the guard confines rather than breaks the agent', async () => {
    const seen: string[] = []
    setManagedAgentsBridge(fake({ snapshot: async (id) => (seen.push(id), { session: null } as never) }))
    expect((await asTask1().fetch(req('/api/sessions/s1'), {} as Env)).status).toBe(200)
    expect(seen).toEqual(['s1'])
  })

  it('cannot start or import a session into another task', async () => {
    const started: string[] = []
    setManagedAgentsBridge(fake({
      createSession: async (input) => (started.push(input.taskId), {} as never),
      importTranscript: async (input) => (started.push(input.taskId), {} as never),
    }))
    const app = asTask1()
    const create = { taskId: '00000000-0000-4000-8000-000000000002', providerId: 'claude', profileId: 'p' }
    expect((await app.fetch(req('/api/sessions', 'POST', create), {} as Env)).status).toBe(404)
    expect((await app.fetch(req('/api/transcript-imports', 'POST', { ...create, content: 'hi' }), {} as Env)).status).toBe(404)
    expect(started).toEqual([])
  })

  it('cannot read or delete another task attachment, nor another task artifact', async () => {
    setManagedAgentsBridge(fake())
    const app = asTask1()
    for (const id of ['a2', 'nope']) {
      expect((await app.fetch(req(`/api/attachments/${id}`), {} as Env)).status).toBe(404)
      expect((await app.fetch(req(`/api/attachments/${id}`, 'DELETE'), {} as Env)).status).toBe(404)
    }
    // An artifact resolves through its session, so this is the two-hop path.
    for (const id of ['f2', 'nope']) {
      expect((await app.fetch(req(`/api/artifacts/${id}`), {} as Env)).status).toBe(404)
      expect((await app.fetch(req(`/api/artifacts/${id}/content`), {} as Env)).status).toBe(404)
    }
  })

  it('cannot upload an attachment against another task', async () => {
    const uploaded: string[] = []
    setManagedAgentsBridge(fake({ uploadAttachment: async (taskId) => (uploaded.push(taskId), {} as never) }))
    const other = '00000000-0000-4000-8000-000000000002'
    const form = new FormData()
    form.set('file', new File(['x'], 'x.txt', { type: 'text/plain' }))
    const res = await asTask1().fetch(
      new Request(`http://acorn.test/api/attachments?taskId=${other}`, { method: 'POST', body: form }),
      {} as Env,
    )
    expect(res.status).toBe(404)
    expect(uploaded).toEqual([])
  })

  it('has its list and search pinned to its own task', async () => {
    const filters: unknown[] = []
    setManagedAgentsBridge(fake({
      listSessions: async (filter) => (filters.push(filter), { sessions: [], nextCursor: null }),
      search: async (_q, filter) => (filters.push(filter), []),
    }))
    const app = asTask1()
    // No taskId given: the filter is injected, so an omitted filter cannot span the node.
    expect((await app.fetch(req('/api/sessions'), {} as Env)).status).toBe(200)
    expect((await app.fetch(req('/api/sessions/search?q=hi'), {} as Env)).status).toBe(200)
    expect(filters).toEqual([{ taskId: 'task1' }, { taskId: 'task1' }])
    // Another task named explicitly: refused rather than silently rewritten.
    const other = '00000000-0000-4000-8000-000000000002'
    expect((await app.fetch(req(`/api/sessions?taskId=${other}`), {} as Env)).status).toBe(404)
    expect((await app.fetch(req(`/api/sessions/search?q=hi&taskId=${other}`), {} as Env)).status).toBe(404)
    expect(filters).toHaveLength(2)
  })

  it('leaves /sessions/search reachable, despite colliding with /sessions/:sessionId', async () => {
    // Hono applies `.use()` by path regardless of registration order, so the ownership middleware also
    // matches the static sibling. Without the explicit skip this 404s for every confined caller, a
    // working feature broken by a guard, which is the failure mode worth pinning.
    setManagedAgentsBridge(fake({ search: async () => [] }))
    expect((await asTask1().fetch(req('/api/sessions/search?q=hi'), {} as Env)).status).toBe(200)
  })

  it('leaves a device and the service scope unconfined', async () => {
    const seen: string[] = []
    setManagedAgentsBridge(fake({
      snapshot: async (id) => (seen.push(id), { session: null } as never),
      listSessions: async (filter) => (seen.push(JSON.stringify(filter)), { sessions: [], nextCursor: null }),
    }))
    for (const app of [authed(), asService()]) {
      expect((await app.fetch(req('/api/sessions/s2'), {} as Env)).status).toBe(200)
      expect((await app.fetch(req('/api/sessions'), {} as Env)).status).toBe(200)
    }
    expect(seen).toEqual(['s2', '{}', 's2', '{}'])
  })

  it('still answers 503 rather than 404 when the runtime is not wired', async () => {
    // dev:node's degraded mode. "No runtime" and "not yours" are different answers.
    expect((await asTask1().fetch(req('/api/sessions/s2'), {} as Env)).status).toBe(503)
    expect((await asTask1().fetch(req('/api/sessions/s1'), {} as Env)).status).toBe(503)
  })
})
