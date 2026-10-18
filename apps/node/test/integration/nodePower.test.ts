import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KEEP_AWAKE_PREF_KEY, NODE_KEEP_AWAKE, type NodePower } from '@acorn/protocol/api.ts'
import { createApp } from '@acorn/node-core/server/index.ts'
import { deviceService, idempotencyStore, mintInternalToken, pairingCodes } from '@acorn/node-core/server/auth'
import { CapabilityRegistry } from '@acorn/node-core/server/pluginHost/capabilities.ts'
import { createPrefService, writePreference } from '@acorn/node-core/server/core/prefs.ts'
import { createKeepAwake } from '@acorn/node-core/server/power.ts'
import { makeTestDb, testSecretEnv, type TestDb } from '@acorn/node-core/testkit'
import type { Env } from '@acorn/node-core/server/bindings.ts'

// GET /v1/core/node/power over the assembled app (docs/node-distribution/keep-awake.md), with a fake
// inhibitor in place of the operating system's.

const INTERNAL = 'internal-secret'

describe('the power route', () => {
  let core: TestDb
  let env: Env
  let ownerToken = ''
  let running = false
  let keepAwake: ReturnType<typeof createKeepAwake>

  const get = (headers: Record<string, string> = { authorization: `Bearer ${ownerToken}` }) =>
    createApp().fetch(new Request('http://127.0.0.1/v1/core/node/power', { headers }), env)

  beforeEach(async () => {
    core = makeTestDb()
    const devices = deviceService(core.db)
    ownerToken = (await devices.issue('test client')).token
    const prefs = createPrefService(core.db)
    keepAwake = createKeepAwake({
      inhibitor: () => {
        running = true
        return () => (running = false)
      },
      readSetting: () => prefs.read('owner', KEEP_AWAKE_PREF_KEY),
    })
    const capabilities = new CapabilityRegistry()
    capabilities.provide(NODE_KEEP_AWAKE, keepAwake)
    env = {
      DB: core.db,
      ...testSecretEnv('0'.repeat(64)),
      INTERNAL_TOKEN: INTERNAL,
      ACTIVE_IDENTITY: { get: () => 'owner', set: () => {}, clear: () => {} },
      DEVICES: devices,
      IDEMPOTENCY: idempotencyStore(core.db),
      PAIRING_CODES: pairingCodes(),
      CAPABILITIES: capabilities,
      BLOBS: { get: async () => null, put: async () => {} },
    } as unknown as Env
  })

  afterEach(() => {
    keepAwake.stop()
    core.cleanup()
  })

  it('reports the leases, and applies a change to the preference when read', async () => {
    keepAwake.hold()
    expect((await (await get()).json()) as NodePower).toEqual({ setting: 'while-busy', available: true, held: 1 })
    expect(running).toBe(true)

    writePreference(core.db, 'owner', KEEP_AWAKE_PREF_KEY, 'never')
    expect((await (await get()).json()) as NodePower).toEqual({ setting: 'never', available: true, held: 1 })
    expect(running).toBe(false)
  })

  it('answers only a device', async () => {
    expect((await get({})).status).toBe(401)
    const task = { 'x-acorn-internal': mintInternalToken(INTERNAL, { scope: 'task', taskId: 'task-1' }) }
    expect((await get(task)).status).toBe(403)
  })
})
