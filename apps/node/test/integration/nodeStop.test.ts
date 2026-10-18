import { setImmediate as nextTurn } from 'node:timers/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '@acorn/node-core/server/index.ts'
import { deviceService, idempotencyStore, mintInternalToken, pairingCodes } from '@acorn/node-core/server/auth'
import { makeTestDb, testSecretEnv, type TestDb } from '@acorn/node-core/testkit'
import { schema } from '@acorn/node-core/server/db/index.ts'
import type { Env } from '@acorn/node-core/server/bindings.ts'

// POST /v1/core/node/stop over the assembled app (docs/cli/local-service.md § Stop and restart). The
// drain itself is the standalone host's, so here `REQUEST_STOP` stands in for it.

const INTERNAL = 'internal-secret'

describe('the stop route', () => {
  let core: TestDb
  let env: Env
  let ownerToken = ''
  const requestStop = vi.fn<(restart: boolean) => void>()

  const peer = (remoteAddress: string, overrides: Partial<Env> = {}) =>
    ({ ...env, incoming: { socket: { remoteAddress } }, ...overrides }) as Env
  const stop = (headers: Record<string, string>, at: Env, body?: unknown) =>
    createApp().fetch(
      new Request('http://127.0.0.1/v1/core/node/stop', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      at,
    )
  const asOwner = () => ({ authorization: `Bearer ${ownerToken}` })

  beforeEach(async () => {
    core = makeTestDb()
    const devices = deviceService(core.db)
    ownerToken = (await devices.issue('test client')).token
    requestStop.mockReset()
    env = {
      DB: core.db,
      NODE_ID: 'node-1',
      NODE_FINGERPRINT: 'ff'.repeat(32),
      ...testSecretEnv('0'.repeat(64)),
      INTERNAL_TOKEN: INTERNAL,
      ACTIVE_IDENTITY: { get: () => 'owner', set: () => {}, clear: () => {} },
      DEVICES: devices,
      IDEMPOTENCY: idempotencyStore(core.db),
      PAIRING_CODES: pairingCodes(),
      BLOBS: { get: async () => null, put: async () => {} },
      REQUEST_STOP: requestStop,
    } as unknown as Env
  })

  afterEach(() => core.cleanup())

  it('lets a device on this computer stop or restart the Node, and records it', async () => {
    expect((await stop(asOwner(), peer('127.0.0.1'))).status).toBe(202)
    expect((await stop(asOwner(), peer('::1'), { restart: true })).status).toBe(202)
    await nextTurn()
    expect(requestStop.mock.calls).toEqual([[false], [true]])
    const trail = await core.db.select().from(schema.audit)
    expect(trail.filter((row) => row.action === 'node.stop.requested').map((row) => row.details)).toEqual([
      JSON.stringify({ restart: false }),
      JSON.stringify({ restart: true }),
    ])
  })

  it('refuses a device on another machine', async () => {
    const response = await stop(asOwner(), peer('192.168.1.20'))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'stop_local_only' } })
  })

  it('refuses a task token and a service token, even from this computer', async () => {
    for (const scope of [{ scope: 'task' as const, taskId: 'task-1' }, { scope: 'service' as const }]) {
      const response = await stop({ 'x-acorn-internal': mintInternalToken(INTERNAL, scope) }, peer('127.0.0.1'))
      expect(response.status).toBe(403)
    }
  })

  it('refuses a body that asks for more than a restart, and a Node the desktop runs', async () => {
    expect((await stop(asOwner(), peer('127.0.0.1'), { restart: true, now: true })).status).toBe(400)
    const desktop = await stop(asOwner(), peer('127.0.0.1', { REQUEST_STOP: undefined }))
    expect(desktop.status).toBe(409)
    expect(await desktop.json()).toMatchObject({ error: { code: 'stop_unavailable' } })
    await nextTurn()
    expect(requestStop).not.toHaveBeenCalled()
  })
})
