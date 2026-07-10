import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApiError } from '../../shared/api'
import type { AppEnv, Principal, SessionUser } from '../middleware/auth'
import { harness, HarnessError, type RunBridge, setRunBridge } from './harness'
import { testGate } from './testAuth'

const USER: SessionUser = { token: '', login: 'local', name: '', avatar: '', scopes: [] }
const INTERNAL: Principal = { kind: 'internal', user: USER }

// The run bridge is the last harness domain (notes/memory/browser moved to the agent-tool registry
// in the agent-tool registry). This proves the shared auth gate + error envelope over what remains.
const app = (principal: Principal | null) => new Hono<AppEnv>().use('/api/*', ...testGate(principal)).route('/api/tasks', harness)

const req = (principal: Principal | null, method: string, path: string) =>
  app(principal).fetch(new Request(`http://acorn.test${path}`, { method }), {} as Env)

describe('harness run surface (auth + error envelope)', () => {
  afterEach(() => setRunBridge(null))

  it('401s (ApiError) when logged out — internal-token surface still gated', async () => {
    const res = await req(null, 'GET', '/api/tasks/t1/run')
    expect(res.status).toBe(401)
    expect((await res.json()) as ApiError).toEqual({ error: 'unauthenticated' })
  })

  it('503 bridge-unavailable (no kind) when the main-process bridge is absent (dev:node)', async () => {
    const res = await req(INTERNAL, 'GET', '/api/tasks/t1/run')
    expect(res.status).toBe(503)
    expect((await res.json()) as ApiError).toEqual({ error: 'bridge-unavailable' })
  })

  it('maps a thrown HarnessError kind → machine code + prose in detail', async () => {
    setRunBridge({
      status: async () => {
        throw new HarnessError('not_found', 'no such target')
      },
    } as unknown as RunBridge)
    const res = await req(INTERNAL, 'GET', '/api/tasks/t1/run/dev/status')
    expect(res.status).toBe(404)
    expect((await res.json()) as ApiError).toEqual({ error: 'not_found', detail: ['no such target'] })
  })

  it('returns the bridge payload on success', async () => {
    setRunBridge({ targets: async () => ({ targets: [{ id: 'dev' }] }) } as unknown as RunBridge)
    const res = await req(INTERNAL, 'GET', '/api/tasks/t1/run')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ targets: [{ id: 'dev' }] })
  })
})
