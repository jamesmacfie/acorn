import { testSecretEnv } from '@acorn/node-core/server/routes/testDb.ts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '@acorn/node-core/server/index.ts'
import { makeTestDb, type TestDb } from '@acorn/node-core/server/routes/testDb.ts'
import { deviceService } from '@acorn/node-core/server/auth/deviceTokens.ts'
import { idempotencyStore } from '@acorn/node-core/server/auth/idempotency.ts'
import { pairingCodes } from '@acorn/node-core/server/auth/pairingCodes.ts'
import { encryptSecret } from '@acorn/node-core/server/secretBox.ts'
import { mintInternalToken } from '@acorn/node-core/server/auth/internalTokens.ts'
import { schema } from '@acorn/node-core/server/db/index.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
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
//
// Phase 2 changed the trust model, and this file changed with it. There is no longer ONE internal
// token: a credential carries a scope, so 'the service calling itself' and 'a child an agent spawned'
// are finally distinguishable (server/auth/internalTokens.ts). The GitHub case below therefore flipped
// from "pinned divergence" to "denied", which is the whole point of the change.

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

  // Phase 4's node-administration surface, gated by the same `requireDevice` mount and belonging in the same
  // list. It was NOT here, and the omission mattered: `routes/plugins.test.ts` asserts the middleware's
  // verdict while MOUNTING `requireDevice` itself, so deleting the real mount from server/index.ts left the
  // whole 26-package suite green — measured. This is the case that exercises `createApp()`.
  //
  // Reading the list enumerates the node's surface (which plugins, therefore which routes and databases);
  // writing it lets an agent disable the plugin whose gate it is standing behind and get a different node at
  // the next restart. Both are exactly what security.md forbids an agent-spawned child.
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

  // Phase 5's addition to the same list, and it is here rather than in a focused route test for exactly
  // the reason above: a gate asserted against a test-mounted middleware proves nothing about the real
  // app. The audit trail names every device that has ever paired with this node and every credential
  // that has been connected to it — the enumeration security.md § Threat model puts furthest out of an
  // agent's reach.
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

  // THE trust-model change. V1 made this impossible (its internal principal carried token: ''); Phase 1
  // dropped that property when the credential moved to an integrations row keyed by owner, and pinned
  // the regression deliberately. Scoping restores it: a 'task' credential — everything in a PTY, an
  // agent session, a workflow step or an MCP server — gets '', which gh()/ghGraphQL() already turn into
  // the same `reauth` outcome as "never connected", so no call site needed new error plumbing.
  //
  // Residual risk, stated rather than hidden: an agent has a shell in the task worktree with the owner's
  // git credentials, so it can still push and open pull requests that way. This closes the node handing
  // it a token, not every path to GitHub.
  it('denies a task-scoped agent credential', async () => {
    const app = await probe()
    const agent = await app.fetch(new Request('http://127.0.0.1/v2/probe', { headers: asAgent }), env)
    expect((await agent.json()) as { token: string }).toEqual({ token: '' })
  })

  // The Phase 1 objection that made gating-on-kind wrong: seedTaskNotes runs INSIDE the service and uses
  // a loopback internal call to reuse pullDetail's serve-then-revalidate, so a blanket gate silently
  // stopped seeding PR notes whenever the mirror was cold. Scope answers it — the service keeps reach.
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
    // Own task: 503 (no tool registry wired in this harness) proves it got PAST the scope check.
    expect(own.status).toBe(503)
    expect(other.status).toBe(404)
  })

  it('lets the service scope reach any task, since its calls are not task-specific', async () => {
    expect((await call('/v2/core/tasks/task-2/tools', { headers: asService })).status).toBe(503)
  })
})

// The gate over the PLUGIN namespace, which Phase 2 left open: `requireTaskScope` was mounted only over
// /v2/core/tasks/:id*, and zero of the sixteen plugin route files that read a taskId checked ownership.
//
// Asserted through a SYNTHETIC plugin rather than by walking the real ones, because the invariant is the
// mount, not the plugin list: "any task-addressed path under /v2/p is gated". A per-plugin test would
// pass while the next plugin to add a task route forgot the gate — which is exactly how this hole was
// created at the core door and missed at the plugin one. Each plugin's own suite covers its handlers.
describe('the task-scope gate covers the plugin namespace', () => {
  const probeRoutes = async (prefix: string, path: string) => {
    const { Hono } = await import('hono')
    const { registerRoute, removePluginRoutes } = await import('@acorn/node-core/server/routeRegistry.ts')
    removePluginRoutes('probe')
    const router = new Hono<AppEnv>().get(path, (c) => c.json({ reached: c.req.param('id') }))
    registerRoute({ plugin: 'probe', prefix, router })
    return () => removePluginRoutes('probe')
  }

  // The two mount shapes real plugins use: `prefix: '/tasks'` with `/:id/...` (changes, database,
  // editor) and `prefix: ''` with `/tasks/:id/...` (memory, workflows, docker).
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
        // A device is the owner and the service scope is unbound — both reach either task.
        const { token } = await devices.issue('laptop')
        for (const headers of [asService, { authorization: `Bearer ${token}` }]) {
          expect((await call('/v2/p/probe/tasks/task-2/thing', { headers })).status).toBe(200)
        }
      } finally {
        cleanup()
      }
    })
  }

  // What the mount deliberately does NOT reach, so the limit is recorded rather than assumed: a route
  // addressed by an opaque id carries no `:id`, so the middleware never matches and the router itself
  // has to resolve the owning task (terminal's /sessions/:sid, agents' /sessions/:sessionId, workflows'
  // /runs/:runId). If this ever starts returning 404, a mount has begun covering these by accident and
  // the in-router checks are no longer the thing being relied on.
  it('does not reach an opaque-id route, which is why those resolve their own owner', async () => {
    const cleanup = await probeRoutes('', '/widgets/:wid/act')
    try {
      expect((await call('/v2/p/probe/widgets/w1/act', { headers: asAgent })).status).toBe(200)
    } finally {
      cleanup()
    }
  })
})
