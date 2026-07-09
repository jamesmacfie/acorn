import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApiError } from '../../shared/api'
import type { AppEnv, Principal, SessionUser } from '../middleware/auth'
import { harness, HarnessError, type NotesBridge, setNotesBridge } from './harness'
import { testGate } from './testAuth'

const USER: SessionUser = { token: '', login: 'local', name: '', avatar: '', scopes: [] }
const INTERNAL: Principal = { kind: 'internal', user: USER }

// Behind the real requireUser gate; pass `null` for a logged-out request.
const app = (principal: Principal | null) =>
  new Hono<AppEnv>().use('/api/*', ...testGate(principal)).route('/api/tasks', harness)

const req = (principal: Principal | null, method: string, path: string, body?: unknown) =>
  app(principal).fetch(
    new Request(`http://acorn.test${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    {} as Env,
  )

describe('harness feature-tool surface (auth + error envelope)', () => {
  afterEach(() => setNotesBridge(null))

  it('401s (ApiError) when logged out — internal-token surface still gated', async () => {
    const res = await req(null, 'GET', '/api/tasks/t1/notes')
    expect(res.status).toBe(401)
    expect((await res.json()) as ApiError).toEqual({ error: 'unauthenticated' })
  })

  it('503 bridge-unavailable (no kind) when the main-process bridge is absent (dev:node)', async () => {
    const res = await req(INTERNAL, 'GET', '/api/tasks/t1/notes')
    expect(res.status).toBe(503)
    expect((await res.json()) as ApiError).toEqual({ error: 'bridge-unavailable' })
  })

  it('maps a thrown HarnessError kind → machine code + prose in detail', async () => {
    const bridge = {
      read: async () => {
        throw new HarnessError('not_found', 'no note here')
      },
    } as unknown as NotesBridge
    setNotesBridge(bridge)
    const res = await req(INTERNAL, 'GET', '/api/tasks/t1/notes/missing')
    expect(res.status).toBe(404)
    expect((await res.json()) as ApiError).toEqual({ error: 'not_found', detail: ['no note here'] })
  })

  it('validates the body before touching the bridge (bad_request ApiError)', async () => {
    const res = await req(INTERNAL, 'PUT', '/api/tasks/t1/notes/slug', { body: 123 })
    expect(res.status).toBe(400)
    expect((await res.json()) as ApiError).toEqual({ error: 'bad_request' })
  })

  it('returns the bridge payload on success', async () => {
    setNotesBridge({ list: async () => [{ slug: 'a' }] } as unknown as NotesBridge)
    const res = await req(INTERNAL, 'GET', '/api/tasks/t1/notes')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ slug: 'a' }])
  })
})
