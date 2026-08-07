import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApiError } from '@acorn/protocol/api.ts'
import type { AppEnv, Principal } from '../middleware/auth'
import { harness, HarnessError, type RunBridge, setRunBridge } from './harness'
import { testGate } from './testAuth'
import type { Env } from '../../main/bindings'

const INTERNAL: Principal = { kind: 'internal', userId: 'local' }

// The run bridge exposes task run targets. This proves its shared auth gate and error envelope.
const app = (principal: Principal | null) => new Hono<AppEnv>().use('/api/*', ...testGate(principal)).route('/api/tasks', harness)

const req = (principal: Principal | null, method: string, path: string) =>
  app(principal).fetch(new Request(`http://acorn.test${path}`, { method }), {} as Env)

describe('harness run surface (auth + error envelope)', () => {
  afterEach(() => setRunBridge(null))

  it('401s (ApiError) when logged out — internal-token surface still gated', async () => {
    const res = await req(null, 'GET', '/api/tasks/t1/run')
    expect(res.status).toBe(401)
    expect(((await res.json()) as ApiError).error).toMatchObject({ code: 'unauthenticated' })
  })

  it('503 bridge-unavailable (no kind) when the main-process bridge is absent (dev:node)', async () => {
    const res = await req(INTERNAL, 'GET', '/api/tasks/t1/run')
    expect(res.status).toBe(503)
    expect(((await res.json()) as ApiError).error).toMatchObject({ code: 'bridge-unavailable' })
  })

  it('maps a thrown HarnessError kind → machine code + prose in detail', async () => {
    setRunBridge({
      status: async () => {
        throw new HarnessError('not_found', 'no such target')
      },
    } as unknown as RunBridge)
    const res = await req(INTERNAL, 'GET', '/api/tasks/t1/run/dev/status')
    expect(res.status).toBe(404)
    expect(((await res.json()) as ApiError).error).toMatchObject({ code: 'not_found', message: 'no such target' })
  })

  it('returns the bridge payload on success', async () => {
    setRunBridge({ targets: async () => ({ targets: [{ id: 'dev' }] }) } as unknown as RunBridge)
    const res = await req(INTERNAL, 'GET', '/api/tasks/t1/run')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ targets: [{ id: 'dev' }] })
  })
})
