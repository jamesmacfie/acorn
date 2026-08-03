import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '../../src/server/providers'
import '../../src/server/routes'
import type { ApiError } from '@acorn/protocol/api.ts'
import type { PairingWindow } from '@acorn/protocol/node.ts'
import { createApp } from '@acorn/node-core/server/index.ts'
import { deviceService } from '@acorn/node-core/server/auth/deviceTokens.ts'
import { pairingCodes } from '@acorn/node-core/server/auth/pairingCodes.ts'
import { idempotencyStore, type IdempotencyStore } from '@acorn/node-core/server/auth/idempotency.ts'
import { idempotency } from '@acorn/node-core/server/middleware/idempotency.ts'
import type { AppEnv, Principal } from '@acorn/node-core/server/middleware/auth.ts'
import { requireUser } from '@acorn/node-core/server/middleware/requireUser.ts'
import { makeTestDb, type TestDb } from '@acorn/node-core/server/routes/testDb.ts'
import type { Env } from '@acorn/node-core/main/bindings.ts'

// Idempotency-Key semantics (docs/vNext/protocol.md § HTTP conventions) over a counting stub route,
// mounted in the same order createApp() uses: seed the principal → requireUser → idempotency → route.
// A stub rather than a real route because the property under test is "how many times did the handler
// run", which no product route exposes.

const DEVICE_ID = 'device-1'
const ORIGIN = 'http://127.0.0.1:4317'

let harness: TestDb
let store: IdempotencyStore
let clock: number
let executions: number
let app: Hono<AppEnv>
let env: Env

// Executions are counted, and each response is distinguishable, so a replay can be told apart from a
// second execution that happened to return the same shape.
const makeApp = (principal: Principal, gate = idempotency) =>
  new Hono<AppEnv>()
    .use('/v2/*', async (c, next) => {
      c.set('principal', principal)
      c.set('requestId', 'fixed-id')
      await next()
    })
    .use('/v2/*', requireUser)
    .use('/v2/*', gate)
    .post('/v2/core/things', async (c) => {
      executions += 1
      // Read the body AFTER the middleware already read it — the route must still see it, or every
      // mutation under this middleware would silently lose its payload.
      const body = (await c.req.json().catch(() => ({}))) as { name?: string }
      return c.json({ execution: executions, name: body.name ?? null })
    })
    .post('/v2/core/boom', (c) => {
      executions += 1
      return c.json({ error: { code: 'internal' } }, 500)
    })
    .post('/v2/core/throw', () => {
      executions += 1
      throw new Error('handler exploded')
    })
    .delete('/v2/core/things/:id', (c) => {
      executions += 1
      return c.body(null, 204)
    })

const device: Principal = { kind: 'device', user: { token: '', login: 'james', name: '', avatar: '', scopes: [] }, deviceId: DEVICE_ID }
const cookie: Principal = { kind: 'user', user: { token: 't', login: 'james', name: '', avatar: '', scopes: [] } }

beforeEach(() => {
  harness = makeTestDb()
  clock = 1_700_000_000_000
  store = idempotencyStore(harness.db, () => clock)
  executions = 0
  env = { DB: harness.db, IDEMPOTENCY: store } as unknown as Env
  app = makeApp(device)
})

afterEach(() => harness.cleanup())

const post = (path: string, key: string | undefined, body: unknown, target = app) =>
  target.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
      body: JSON.stringify(body),
    }),
    env,
  )

describe('Idempotency-Key on /v2', () => {
  it('replays the stored status and body, and executes the handler once', async () => {
    const key = randomUUID()
    const first = await post('/v2/core/things', key, { name: 'widget' })
    const second = await post('/v2/core/things', key, { name: 'widget' })
    expect(executions).toBe(1)
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    // The body is the stored one, not a re-render: `execution` would be 2 if the handler had run again.
    expect(await second.json()).toEqual({ execution: 1, name: 'widget' })
    expect(second.headers.get('content-type')).toContain('application/json')
  })

  it('409s the same key with a different request', async () => {
    const key = randomUUID()
    await post('/v2/core/things', key, { name: 'widget' })
    const conflict = await post('/v2/core/things', key, { name: 'gadget' })
    expect(conflict.status).toBe(409)
    expect(((await conflict.json()) as ApiError).error.code).toBe('idempotency_conflict')
    expect(executions).toBe(1) // the conflicting request never reached the handler
  })

  it('does not store a 5xx, so a genuine retry re-executes', async () => {
    const key = randomUUID()
    expect((await post('/v2/core/boom', key, {})).status).toBe(500)
    expect(await store.lookup(DEVICE_ID, key)).toBeNull()
    expect((await post('/v2/core/boom', key, {})).status).toBe(500)
    expect(executions).toBe(2)
  })

  // The realistic 5xx is a throw (a failed statement, a dead child process). It must leave the same
  // nothing behind, and it must not leave the in-flight entry wedged — a retry has to get through.
  it('stores nothing when the handler throws, and the retry still runs', async () => {
    const key = randomUUID()
    // Hono's own error handler renders the 500 here; createApp() swaps in the ApiError envelope.
    expect((await post('/v2/core/throw', key, {})).status).toBe(500)
    expect(await store.lookup(DEVICE_ID, key)).toBeNull()
    expect((await post('/v2/core/throw', key, {})).status).toBe(500)
    expect(executions).toBe(2)
  })

  it('makes a concurrent duplicate wait for the first execution and share its response', async () => {
    const key = randomUUID()
    // Both are in flight before either resolves, which is the window the in-process map exists for:
    // the store has nothing yet, so a second execution is the only other possible outcome.
    const [a, b] = await Promise.all([post('/v2/core/things', key, { name: 'once' }), post('/v2/core/things', key, { name: 'once' })])
    expect(executions).toBe(1)
    expect(await a.json()).toEqual({ execution: 1, name: 'once' })
    expect(await b.json()).toEqual({ execution: 1, name: 'once' })
  })

  it('re-executes once the stored row has expired', async () => {
    const key = randomUUID()
    await post('/v2/core/things', key, { name: 'widget' })
    clock += 24 * 60 * 60_000 + 1 // past the 24h TTL
    const again = await post('/v2/core/things', key, { name: 'widget' })
    expect(executions).toBe(2)
    expect(await again.json()).toEqual({ execution: 2, name: 'widget' })
  })

  it('rejects a malformed key before the handler runs', async () => {
    const res = await post('/v2/core/things', 'not-a-uuid', { name: 'widget' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as ApiError).error.code).toBe('bad_request')
    expect(executions).toBe(0)
  })

  it('leaves a request without the header alone', async () => {
    await post('/v2/core/things', undefined, { name: 'widget' })
    await post('/v2/core/things', undefined, { name: 'widget' })
    expect(executions).toBe(2)
    expect(await harness.db.select().from((await import('@acorn/node-core/server/db/index.ts')).schema.idempotency)).toEqual([])
  })

  // A cookie or internal-token principal has no device identity to scope a key to, so the header is
  // ignored rather than keyed on something shared.
  it('passes a principal with no deviceId straight through', async () => {
    const cookieApp = makeApp(cookie)
    const key = randomUUID()
    await post('/v2/core/things', key, { name: 'widget' }, cookieApp)
    await post('/v2/core/things', key, { name: 'widget' }, cookieApp)
    expect(executions).toBe(2)
  })

  // Everything above mounts the middleware itself, which proves the semantics but not the wiring. This
  // one goes through the assembled app with a real paired device: POST /v2/core/pair/start mints a new
  // code every call, so a replayed one can only have come from the middleware being mounted.
  it('is mounted in createApp() — a retried mutation does not run twice', async () => {
    const app = createApp()
    const devices = deviceService(harness.db)
    const assembledEnv = {
      DB: harness.db,
      NODE_ID: 'node-1',
      APP_VERSION: 'test',
      DEVICES: devices,
      PAIRING_CODES: pairingCodes(),
      IDEMPOTENCY: store,
      ACTIVE_IDENTITY: { get: (): string | null => 'james', set: () => {}, clear: () => {} },
    } as unknown as Env
    const { token } = await devices.issue('laptop')
    const key = randomUUID()
    const start = () =>
      app.fetch(
        new Request(`${ORIGIN}/v2/core/pair/start`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': key },
        }),
        assembledEnv,
      )
    const first = (await (await start()).json()) as PairingWindow
    const second = (await (await start()).json()) as PairingWindow
    expect(second.code).toBe(first.code)
  })

  it('replays a 204 as a 204 with no body', async () => {
    const key = randomUUID()
    const del = (target = app) =>
      target.fetch(
        new Request(`${ORIGIN}/v2/core/things/t1`, { method: 'DELETE', headers: { 'content-type': 'application/json', 'idempotency-key': key } }),
        env,
      )
    expect((await del()).status).toBe(204)
    const replayed = await del()
    // A stored 204 must come back bodiless: constructing a 204 Response with an empty-string body
    // throws, which would turn a harmless retry into a 500.
    expect(replayed.status).toBe(204)
    expect(await replayed.text()).toBe('')
    expect(executions).toBe(1)
  })
})
