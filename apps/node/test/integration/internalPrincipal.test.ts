import { testSecretEnv } from '@acorn/node-core/server/routes/testDb.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '@acorn/node-core/server/index.ts'
import { makeTestDb, type TestDb } from '@acorn/node-core/server/routes/testDb.ts'
import { deviceService } from '@acorn/node-core/server/auth/deviceTokens.ts'
import { idempotencyStore } from '@acorn/node-core/server/auth/idempotency.ts'
import { pairingCodes } from '@acorn/node-core/server/auth/pairingCodes.ts'
import { encryptSecret } from '@acorn/node-core/server/secretBox.ts'
import { schema } from '@acorn/node-core/server/db/index.ts'
import type { Env } from '@acorn/node-core/main/bindings.ts'

// What an agent-spawned child may NOT do.
//
// The internal token (ACORN_API_TOKEN) is injected into every PTY and agent session env, so anything
// running in a task terminal holds it. docs/vNext/security.md § Threat model is explicit that this
// principal is LESS trusted than the owner and "can never read secrets back, mint tokens, pair, or
// touch device management".
//
// Every case below was VERIFIED to succeed before the gates existed: an agent could open a pairing
// window, read the code out of the response body, mint itself a permanent owner-authority device
// token, revoke the owner's own devices, and act on GitHub as the owner. requireUser could not catch
// any of it, because requireUser only asserts that SOME principal resolved — which is the right rule
// for product routes and the wrong one for these.

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

const asAgent = { 'x-acorn-internal': INTERNAL, 'content-type': 'application/json' }

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

  // The whole escalation in one test: window → code → token. If this ever returns 200 at the first
  // step, the rest follows and the internal token becomes owner-permanent.
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

describe('the internal principal CAN reach a provider credential (a documented divergence)', () => {
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

  // Pinned deliberately, as the counterpart to the gates above. V1 made this impossible (the internal
  // principal carried token: ''), and gating it here was tried and reverted: it contains nothing an
  // agent cannot already do with a shell in the worktree, and it silently breaks seedTaskNotes, which
  // runs in the service and uses the internal token over loopback. The real fix is task-scoped internal
  // tokens (protocol.md § Transport), which is Phase 2.
  //
  // This test exists so the divergence cannot change by accident: if it starts failing, someone has
  // altered the trust model and should say so.
  it('resolves the owner GitHub token for BOTH principal kinds', async () => {
    const { Hono } = await import('hono')
    const { authMiddleware } = await import('@acorn/node-core/server/middleware/auth.ts')
    const { requireUser } = await import('@acorn/node-core/server/middleware/requireUser.ts')
    const { githubToken } = await import('@acorn/plugin-github/server/githubToken.ts')

    const app = new Hono()
      .use('/v2/*', authMiddleware)
      .use('/v2/*', requireUser)
      .get('/v2/probe', async (c) => c.json({ token: await githubToken(c as never) }))

    const agent = await app.fetch(new Request('http://127.0.0.1/v2/probe', { headers: asAgent }), env)
    expect((await agent.json()) as { token: string }).toEqual({ token: 'gho_OWNER_SECRET' })

    const { token } = await devices.issue('laptop')
    const owner = await app.fetch(
      new Request('http://127.0.0.1/v2/probe', { headers: { authorization: `Bearer ${token}` } }),
      env,
    )
    expect((await owner.json()) as { token: string }).toEqual({ token: 'gho_OWNER_SECRET' })
  })
})
