import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '../registerProviders'
import type { ApiError } from '@acorn/protocol/api.ts'
import { NODE_PROTOCOL_VERSION, type DevicesResponse, type NodeInfo, type PairResult, type PairingWindow } from '@acorn/protocol/node.ts'
import { createApp } from '@acorn/node-core/server/index.ts'
import { deviceService } from '@acorn/node-core/server/auth/deviceTokens.ts'
import { pairingCodes } from '@acorn/node-core/server/auth/pairingCodes.ts'
import { makeTestDb, type TestDb } from '@acorn/node-core/testkit/db.ts'
import type { Env } from '@acorn/node-core/main/bindings.ts'

// The pairing surface end to end over the assembled app (docs/api-reference.md § Pairing): what the
// two pre-auth routes may leak, that every pairing failure is byte-identical, and that a paired token
// then works everywhere a session does — and stops working the instant the device is revoked.

const NODE_ID = '11111111-2222-3333-4444-555555555555'
const FINGERPRINT = 'a'.repeat(64)
const ORIGIN = 'http://127.0.0.1:4317'

let harness: TestDb
let app: ReturnType<typeof createApp>
let env: Env

beforeEach(() => {
  harness = makeTestDb()
  app = createApp()
  // A real device service and a real pairing window over a real DB — the uniformity being asserted
  // below is a property of those two working together, so stubbing either would prove nothing.
  env = {
    DB: harness.db,
    NODE_ID,
    APP_VERSION: '9.9.9-test',
    NODE_FINGERPRINT: FINGERPRINT,
    DEVICES: deviceService(harness.db),
    PAIRING_CODES: pairingCodes(),
    ACTIVE_IDENTITY: { get: (): string | null => 'james', set: () => {}, clear: () => {} },
    // Only the bindings these routes read — the double cast is this suite's existing idiom for a
    // partial env (linear.test.ts, rollbar.test.ts).
  } as unknown as Env
})

afterEach(() => harness.cleanup())

// Declares JSON like the client does. `contentType: null` drops the header entirely, which is what a
// bodyless mutation actually looks like on the wire (see the no-content-type test below).
const send = (path: string, init: { method?: string; body?: unknown; token?: string; requestId?: string; contentType?: string | null } = {}) =>
  app.fetch(
    new Request(`${ORIGIN}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.contentType === null ? {} : { 'content-type': init.contentType ?? 'application/json' }),
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
        ...(init.requestId ? { 'x-request-id': init.requestId } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    }),
    env,
  )

const openWindow = async (token: string): Promise<string> => {
  const res = await send('/v2/core/pair/start', { method: 'POST', token })
  expect(res.status).toBe(200)
  const { code, expiresInMs } = (await res.json()) as PairingWindow
  expect(expiresInMs).toBe(10 * 60_000)
  return code
}

// Pair a first device the only way an unpaired client can: open a window with an already-trusted
// credential. The seed device stands in for "the local node handed its parent a token at boot".
const pairDevice = async (name = 'laptop'): Promise<PairResult> => {
  const { token: seed } = await env.DEVICES.issue('seed')
  const code = await openWindow(seed)
  const res = await send('/v2/pair', { method: 'POST', body: { code, deviceName: name } })
  expect(res.status).toBe(200)
  return (await res.json()) as PairResult
}

describe('GET /v2/node', () => {
  it('exposes nothing but the protocol version and fingerprint when unauthenticated', async () => {
    const res = await send('/v2/node')
    expect(res.status).toBe(200)
    const info = (await res.json()) as NodeInfo
    // Key-exact, not a subset match: the point of this route is what it does NOT say to anything that
    // can reach the port.
    expect(Object.keys(info).sort()).toEqual(['fingerprint', 'protocolVersion'])
    expect(info).toEqual({ protocolVersion: NODE_PROTOCOL_VERSION, fingerprint: FINGERPRINT })
  })

  it('adds the node identity once authenticated, and nothing else', async () => {
    const { deviceToken } = await pairDevice()
    const info = (await (await send('/v2/node', { token: deviceToken })).json()) as NodeInfo
    // `toEqual`, not `toMatchObject`, and that is the assertion: this response must stay readable by
    // every client forever (docs/api-reference.md § Versioning), so the bar for a field on it is a
    // consumer. `appVersion` used to ride along here with no reader anywhere and was dropped.
    expect(info).toEqual({ protocolVersion: NODE_PROTOCOL_VERSION, fingerprint: FINGERPRINT, nodeId: NODE_ID })
  })
})

describe('POST /v2/pair', () => {
  it('trades a live code for a device token that authenticates', async () => {
    const paired = await pairDevice('James’s laptop')
    expect(paired.nodeId).toBe(NODE_ID)
    expect(paired.device.name).toBe('James’s laptop')
    expect(paired.deviceToken).toMatch(/^acorn_dt_/)
    expect(await env.DEVICES.authenticate(paired.deviceToken)).toEqual({ deviceId: paired.device.id })
  })

  // The no-oracle rule: a caller must not be able to tell "wrong code" from "no window open" — that
  // difference is what tells an attacker whether guessing is worth continuing.
  it('fails identically for a wrong code and for a code whose window is gone', async () => {
    const { token: seed } = await env.DEVICES.issue('seed')
    const code = await openWindow(seed)
    const body = { code, deviceName: 'attacker' }

    // Same X-Request-Id on both, since requestIdMiddleware echoes a valid one — so the envelopes are
    // comparable in full rather than after deleting the one field that is meant to differ.
    const wrong = await send('/v2/pair', { method: 'POST', body: { code: 'not-the-code', deviceName: 'attacker' }, requestId: 'fixed-id' })
    await send('/v2/pair', { method: 'POST', body }) // consumes the window (single use)
    const consumed = await send('/v2/pair', { method: 'POST', body, requestId: 'fixed-id' })

    const expected = await consumed.text()
    expect(wrong.status).toBe(consumed.status)
    expect(await wrong.text()).toBe(expected)
    // ...and a malformed body is the same answer again, down to the byte.
    const malformed = await send('/v2/pair', { method: 'POST', body: { code, deviceName: '', extra: true }, requestId: 'fixed-id' })
    expect(malformed.status).toBe(consumed.status)
    expect(await malformed.text()).toBe(expected)
  })

  it('burns the window after five attempts, so the sixth fails even with the right code', async () => {
    const { token: seed } = await env.DEVICES.issue('seed')
    const code = await openWindow(seed)
    for (let i = 0; i < 5; i += 1) {
      expect((await send('/v2/pair', { method: 'POST', body: { code: `wrong-${i}`, deviceName: 'attacker' } })).status).toBe(401)
    }
    const sixth = await send('/v2/pair', { method: 'POST', body: { code, deviceName: 'attacker' } })
    expect(sixth.status).toBe(401)
    expect(((await sixth.json()) as ApiError).error.code).toBe('pairing_failed')
  })
})

describe('device administration', () => {
  it('lists devices and authenticates a /v2/core read with the paired token', async () => {
    const paired = await pairDevice('laptop')
    const res = await send('/v2/core/devices', { token: paired.deviceToken })
    expect(res.status).toBe(200)
    const { devices } = (await res.json()) as DevicesResponse
    expect(devices.map((d) => d.name).sort()).toEqual(['laptop', 'seed'])
    // The list is owner-facing, so it must never carry token material.
    expect(JSON.stringify(devices)).not.toContain(paired.deviceToken.split('_').at(-1))
  })

  it('stays gated: the pairing admin routes 401 without a credential', async () => {
    expect((await send('/v2/core/devices')).status).toBe(401)
    expect((await send('/v2/core/pair/start', { method: 'POST' })).status).toBe(401)
    expect((await send('/v2/core/pair', { method: 'DELETE' })).status).toBe(401)
    expect((await send('/v2/core/devices/whatever', { method: 'DELETE' })).status).toBe(401)
  })

  it('revokes a device — including itself — and the very next request is unauthenticated', async () => {
    const paired = await pairDevice('laptop')
    const revoke = await send(`/v2/core/devices/${paired.device.id}`, { method: 'DELETE', token: paired.deviceToken })
    expect(revoke.status).toBe(204)
    const after = await send('/v2/core/devices', { token: paired.deviceToken })
    expect(after.status).toBe(401)
    expect(((await after.json()) as ApiError).error.code).toBe('unauthenticated')
  })

  // Regression guard for the csrf() removal on /v2 (server/index.ts). hono/csrf treats a MISSING
  // content-type as form-submittable, so while it was mounted here this exact request — the one the
  // renderer sends to revoke a device, bodyless and therefore header-less — came back 403 instead of
  // 204. /v2 is bearer-only, so the Origin check was protecting a credential no browser can attach.
  it('accepts a bearer DELETE that carries no content-type at all', async () => {
    const paired = await pairDevice('laptop')
    const revoke = await send(`/v2/core/devices/${paired.device.id}`, { method: 'DELETE', token: paired.deviceToken, contentType: null })
    expect(revoke.status).toBe(204)
  })

  it('404s a device that never existed, and closes a pairing window idempotently', async () => {
    const paired = await pairDevice('laptop')
    const missing = await send('/v2/core/devices/nope', { method: 'DELETE', token: paired.deviceToken })
    expect(missing.status).toBe(404)
    expect(((await missing.json()) as ApiError).error.code).toBe('not_found')

    await openWindow(paired.deviceToken)
    expect((await send('/v2/core/pair', { method: 'DELETE', token: paired.deviceToken })).status).toBe(204)
    expect(env.PAIRING_CODES.isOpen()).toBe(false)
    expect((await send('/v2/core/pair', { method: 'DELETE', token: paired.deviceToken })).status).toBe(204)
  })
})
