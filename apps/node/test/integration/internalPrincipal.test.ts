import { testSecretEnv } from '@acorn/node-core/testkit/db.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '@acorn/node-core/server/index.ts'
import { makeTestDb, type TestDb } from '@acorn/node-core/testkit/db.ts'
import { deviceService } from '@acorn/node-core/server/auth/deviceTokens.ts'
import { idempotencyStore } from '@acorn/node-core/server/auth/idempotency.ts'
import { pairingCodes } from '@acorn/node-core/server/auth/pairingCodes.ts'
import { encryptSecret } from '@acorn/node-core/server/secretBox.ts'
import { mintInternalToken } from '@acorn/node-core/server/auth/internalTokens.ts'
import { schema } from '@acorn/node-core/server/db/index.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import type { Env } from '@acorn/node-core/main/bindings.ts'

const INTERNAL = 'internal-secret'
const ENC_KEY = '0'.repeat(64)

let harness: TestDb
let env: Env
let devices: ReturnType<typeof deviceService>

beforeEach(() => {
  harness = makeTestDb()
  devices = deviceService(harness.db)
  env = {
    DB: harness.db,
    NODE_ID: 'node-1',
    APP_VERSION: 'test',
    NODE_FINGERPRINT: 'ff'.repeat(32),
    ...testSecretEnv(ENC_KEY),
    GITHUB_CLIENT_ID: 'client-id',
    GITHUB_CLIENT_SECRET: '',
    INTERNAL_TOKEN: INTERNAL,
    ACTIVE_IDENTITY: { get: () => 'james', set: () => {}, clear: () => {} },
    DEVICES: devices,
    IDEMPOTENCY: idempotencyStore(harness.db),
    PAIRING_CODES: pairingCodes(),
    BLOBS: { get: async () => null, put: async () => {} },
  } as unknown as Env
})

afterEach(() => harness.cleanup())

// A child an agent spawned: 'task'-scoped, bound to one task. This is what goes into a PTY env.
const asAgent = {
  'x-acorn-internal': mintInternalToken(INTERNAL, { scope: 'task', taskId: 'task-1' }),
  'content-type': 'application/json',
}
// The node calling its own HTTP surface (seedTaskNotes, workflow context assembly). Never placed in a
// child's environment.
const asService = {
  'x-acorn-internal': mintInternalToken(INTERNAL, { scope: 'service' }),
  'content-type': 'application/json',
}

const call = (path: string, init: RequestInit = {}) =>
  createApp().fetch(new Request(`http://127.0.0.1${path}`, init), env)

describe('the internal principal cannot administer devices', () => {
  it('is refused a pairing window, so it cannot read a code', async () => {
    const res = await call('/v2/core/pair/start', { method: 'POST', headers: asAgent })
    expect(res.status).toBe(403)
    // Nothing shaped like a pairing window comes back. Asserted structurally rather than by pattern:
    // the envelope's own requestId is a UUID, so "does this body contain a base64url-ish string" is
    // always true and would have been a test that could not fail.
    const body = (await res.json()) as Record<string, unknown>
    expect(body).not.toHaveProperty('code')
    expect(body).not.toHaveProperty('expiresInMs')
    expect(body.error).toMatchObject({ code: 'interactive_user_required' })
  })

  it('is refused closing a pairing window', async () => {
    expect((await call('/v2/core/pair', { method: 'DELETE', headers: asAgent })).status).toBe(403)
  })

  it('cannot enumerate the owner devices', async () => {
    await devices.issue("owner's laptop")
    const res = await call('/v2/core/devices', { headers: asAgent })
    expect(res.status).toBe(403)
    expect(await res.text()).not.toContain("owner's laptop")
  })

  it('cannot revoke an owner device', async () => {
    const { device } = await devices.issue("owner's laptop")
    expect((await call(`/v2/core/devices/${device.id}`, { method: 'DELETE', headers: asAgent })).status).toBe(403)
    expect(await devices.isActive(device.id)).toBe(true)
  })

  it('can neither read nor write which plugins this node runs', async () => {
    const read = await call('/v2/core/plugins', { headers: asAgent })
    expect(read.status).toBe(403)
    // The 503 a bridge-less test app would answer must not be mistaken for a refusal: assert the code.
    expect(((await read.json()) as { error?: { code?: string } }).error?.code).toBe('interactive_user_required')
    const write = await call('/v2/core/plugins', {
      method: 'PUT',
      headers: { ...asAgent, 'content-type': 'application/json' },
      body: JSON.stringify({ disabled: ['docker'] }),
    })
    expect(write.status).toBe(403)
  })

  it('cannot read the audit trail', async () => {
    const res = await call('/v2/core/audit', { headers: asAgent })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error?: { code?: string } }).error?.code).toBe('interactive_user_required')
  })

  // The posture answer is smaller than the trail, and gated for the same class of reason: it describes
  // the machine, which is reconnaissance for anything running in a task.
  it("cannot read the node's security posture", async () => {
    const res = await call('/v2/core/security', { headers: asAgent })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error?: { code?: string } }).error?.code).toBe('interactive_user_required')
  })

  // The whole escalation in one test: window → code → token (docs/security.md § Transport and auth
  // covers why `requireDevice` exists). If this ever returns 200 at the first step, the rest follows
  // and the internal token becomes owner-permanent.
  it('cannot escalate to an owner-authority device token', async () => {
    const started = await call('/v2/core/pair/start', { method: 'POST', headers: asAgent })
    expect(started.status).toBe(403)
    // And with no window open, pairing is refused whatever code is guessed.
    const paired = await call('/v2/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'guessed-code-value-here', deviceName: 'exfiltrator' }),
    })
    expect(paired.status).not.toBe(200)
    expect(await harness.db.select().from(schema.devices)).toHaveLength(0)
  })
})

describe('a device principal still can', () => {
  const asDevice = async () => {
    const { token } = await devices.issue("owner's laptop")
    return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  }

  it('open a pairing window and list devices', async () => {
    const headers = await asDevice()
    const started = await call('/v2/core/pair/start', { method: 'POST', headers })
    expect(started.status).toBe(200)
    expect((await started.json()) as { code: string }).toHaveProperty('code')
    expect((await call('/v2/core/devices', { headers })).status).toBe(200)
  })
})

describe('scope decides who may spend the owner provider credential', () => {
  beforeEach(async () => {
    await harness.db.insert(schema.integrations).values({
      id: 'i1',
      userId: 'james',
      provider: 'github',
      label: 'james',
      authRef: await encryptSecret('gho_OWNER_SECRET', ENC_KEY),
      authKind: 'oauth',
      account: null,
      scopes: '[]',
      capabilities: '{}',
      config: '{}',
      status: 'connected',
      lastValidatedAt: 0,
      lastError: null,
      createdAt: 0,
      updatedAt: 0,
    })
  })

  const probe = async () => {
    const { Hono } = await import('hono')
    const { authMiddleware } = await import('@acorn/node-core/server/middleware/auth.ts')
    const { requireUser } = await import('@acorn/node-core/server/middleware/requireUser.ts')
    const { githubToken } = await import('@acorn/plugin-github/server/githubToken.ts')
    return new Hono()
      .use('/v2/*', authMiddleware)
      .use('/v2/*', requireUser)
      .get('/v2/probe', async (c) => c.json({ token: await githubToken(c as never) }))
  }

  it('denies a task-scoped agent credential', async () => {
    const app = await probe()
    const agent = await app.fetch(new Request('http://127.0.0.1/v2/probe', { headers: asAgent }), env)
    expect((await agent.json()) as { token: string }).toEqual({ token: '' })
  })

  it('allows the service scope, so loopback seeding still works on a cold mirror', async () => {
    const app = await probe()
    const service = await app.fetch(new Request('http://127.0.0.1/v2/probe', { headers: asService }), env)
    expect((await service.json()) as { token: string }).toEqual({ token: 'gho_OWNER_SECRET' })
  })

  it('allows a paired device, which is the owner', async () => {
    const app = await probe()
    const { token } = await devices.issue('laptop')
    const owner = await app.fetch(new Request('http://127.0.0.1/v2/probe', { headers: { authorization: `Bearer ${token}` } }), env)
    expect((await owner.json()) as { token: string }).toEqual({ token: 'gho_OWNER_SECRET' })
  })
})

describe('a task-scoped credential is confined to its own task', () => {
  // The concrete escalation scoping closes. routes/agentTools.ts takes the taskId from the URL, so
  // before the credential carried one, a token handed to task A's agent could drive task B's tools.
  // 404 rather than 403, matching every other denial on that surface, so it reveals nothing about which
  // tasks exist.
  it('is refused another task tool surface', async () => {
    const own = await call('/v2/core/tasks/task-1/tools', { headers: asAgent })
    const other = await call('/v2/core/tasks/task-2/tools', { headers: asAgent })
    // Own task: 503 (no tool registry wired in this harness) proves it got past the scope check.
    expect(own.status).toBe(503)
    expect(other.status).toBe(404)
  })

  it('lets the service scope reach any task, since its calls are not task-specific', async () => {
    expect((await call('/v2/core/tasks/task-2/tools', { headers: asService })).status).toBe(503)
  })
})

describe('the task-scope gate covers the plugin namespace', () => {
  const probeRoutes = async (prefix: string, path: string) => {
    const { Hono } = await import('hono')
    const { registerRoute, removePluginRoutes } = await import('@acorn/node-core/server/routeRegistry.ts')
    removePluginRoutes('probe')
    const router = new Hono<AppEnv>().get(path, (c) => c.json({ reached: c.req.param('id') }))
    registerRoute({ plugin: 'probe', prefix, router })
    return () => removePluginRoutes('probe')
  }

  // The two mount shapes real plugins use: docs/security.md § Transport and auth covers why (the
  // task-scope gate matches a `:id` out of the URL).
  for (const [label, prefix, path] of [
    ["a '/tasks' prefix router", '/tasks', '/:id/thing'],
    ['a root router with task paths', '', '/tasks/:id/thing'],
  ] as const) {
    it(`confines a task-scoped credential on ${label}`, async () => {
      const cleanup = await probeRoutes(prefix, path)
      try {
        const own = await call('/v2/p/probe/tasks/task-1/thing', { headers: asAgent })
        expect(own.status).toBe(200)
        expect((await own.json()) as { reached: string }).toEqual({ reached: 'task-1' })
        // The hole: before the mount this was a 200 into another task's resource.
        expect((await call('/v2/p/probe/tasks/task-2/thing', { headers: asAgent })).status).toBe(404)
        // A device is the owner and the service scope is unbound, both reach either task.
        const { token } = await devices.issue('laptop')
        for (const headers of [asService, { authorization: `Bearer ${token}` }]) {
          expect((await call('/v2/p/probe/tasks/task-2/thing', { headers })).status).toBe(200)
        }
      } finally {
        cleanup()
      }
    })
  }

  // What the mount does not reach, so the limit is recorded rather than assumed: docs/security.md §
  // Transport and auth covers why these opaque-id routes resolve their own owning task. If this ever
  // starts returning 404, a mount has begun covering them by accident and the in-router checks are
  // no longer what's being relied on.
  it('does not reach an opaque-id route, which is why those resolve their own owner', async () => {
    const cleanup = await probeRoutes('', '/widgets/:wid/act')
    try {
      expect((await call('/v2/p/probe/widgets/w1/act', { headers: asAgent })).status).toBe(200)
    } finally {
      cleanup()
    }
  })
})
