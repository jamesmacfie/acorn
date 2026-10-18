import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NodeReach } from '@acorn/protocol/api.ts'
import { createApp } from '@acorn/node-core/server/index.ts'
import { deviceService, idempotencyStore, mintInternalToken, pairingCodes } from '@acorn/node-core/server/auth'
import { openDataRoot, readNodeReach, type DataRoot } from '@acorn/node-core/server/storage'
import { makeTestDb, testSecretEnv, type TestDb } from '@acorn/node-core/testkit'
import { schema } from '@acorn/node-core/server/db/index.ts'
import type { Env } from '@acorn/node-core/server/bindings.ts'

// GET and PUT /v1/core/node/reach over the assembled app (docs/node-distribution/reaching.md). The
// listener isn't running here, so ADVERTISED_HOSTS stands in for the hosts it bound at boot.

const INTERNAL = 'internal-secret'

describe('the reach route', () => {
  const original = process.env.ACORN_ADVERTISE_HOST
  let dir = ''
  let root: DataRoot | null = null
  let core: TestDb
  let env: Env
  let ownerToken = ''

  const peer = (remoteAddress: string, overrides: Partial<Env> = {}) =>
    ({ ...env, incoming: { socket: { remoteAddress } }, ...overrides }) as Env
  const call = (
    method: 'GET' | 'PUT',
    at: Env,
    body?: unknown,
    headers: Record<string, string> = { authorization: `Bearer ${ownerToken}` },
  ) =>
    createApp().fetch(
      new Request('http://127.0.0.1/v1/core/node/reach', {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      at,
    )
  const put = async (hosts: unknown, at = peer('127.0.0.1')) => call('PUT', at, { hosts })

  beforeEach(async () => {
    delete process.env.ACORN_ADVERTISE_HOST
    dir = mkdtempSync(join(tmpdir(), 'acorn-reach-'))
    root = openDataRoot(dir)
    root.recordPort(4317)
    core = makeTestDb()
    const devices = deviceService(core.db)
    ownerToken = (await devices.issue('test client')).token
    env = {
      DB: core.db,
      DATA_DIR: dir,
      NODE_ID: root.nodeId,
      NODE_FINGERPRINT: 'ff'.repeat(32),
      ADVERTISED_HOSTS: [],
      ...testSecretEnv('0'.repeat(64)),
      INTERNAL_TOKEN: INTERNAL,
      ACTIVE_IDENTITY: { get: () => 'owner', set: () => {}, clear: () => {} },
      DEVICES: devices,
      IDEMPOTENCY: idempotencyStore(core.db),
      PAIRING_CODES: pairingCodes(),
      BLOBS: { get: async () => null, put: async () => {} },
    } as unknown as Env
  })

  afterEach(() => {
    if (original === undefined) delete process.env.ACORN_ADVERTISE_HOST
    else process.env.ACORN_ADVERTISE_HOST = original
    root?.release()
    root = null
    core.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  it('records the hosts, says a restart is needed, and audits the change', async () => {
    const before = (await (await call('GET', peer('127.0.0.1'))).json()) as NodeReach
    expect(before).toMatchObject({ hosts: [], source: 'none', port: 4317, restartRequired: false })
    expect(Array.isArray(before.candidates)).toBe(true)

    const response = await put(['192.168.1.20', 'workshop.local'])
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      hosts: ['192.168.1.20', 'workshop.local'],
      source: 'node.json',
      restartRequired: true,
    })
    expect(readNodeReach(dir).advertiseHost).toBe('192.168.1.20,workshop.local')

    // Once the listener has bound the recorded list, nothing is waiting on a restart.
    const booted = peer('127.0.0.1', { ADVERTISED_HOSTS: ['192.168.1.20', 'workshop.local'] })
    expect(await (await call('GET', booted)).json()).toMatchObject({ restartRequired: false })

    // An empty list keeps the Node private, and is a change like any other.
    expect(await (await put([], booted)).json()).toMatchObject({ hosts: [], source: 'none', restartRequired: true })
    expect(readNodeReach(dir).advertiseHost).toBe('')

    const trail = await core.db.select().from(schema.audit)
    expect(trail.filter((row) => row.action === 'node.reach.changed').map((row) => row.details)).toEqual([
      JSON.stringify({ from: '', to: '192.168.1.20,workshop.local' }),
      JSON.stringify({ from: '192.168.1.20,workshop.local', to: '' }),
    ])
  })

  it('answers a read from another machine, and refuses a write from one', async () => {
    expect((await call('GET', peer('192.168.1.30'))).status).toBe(200)
    const response = await put(['192.168.1.20'], peer('192.168.1.30'))
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: { code: 'reach_local_only' } })
    expect(readNodeReach(dir).advertiseHost).toBeUndefined()
  })

  it('refuses a task token, even from this computer', async () => {
    const task = { 'x-acorn-internal': mintInternalToken(INTERNAL, { scope: 'task', taskId: 'task-1' }) }
    expect((await call('GET', peer('127.0.0.1'), undefined, task)).status).toBe(403)
    expect((await call('PUT', peer('127.0.0.1'), { hosts: ['192.168.1.20'] }, task)).status).toBe(403)
  })

  it('refuses the whole list over one bad entry', async () => {
    const refused = [
      ['https://workshop.local'],
      ['workshop.local:4317'],
      ['workshop.local/acorn'],
      ['*.local'],
      ['256.1.1.1'],
      ['1.2.3'],
      ['a..b'],
      ['bad host'],
      [`${'a'.repeat(250)}.com`],
      ['localhost'],
      ['acorn.localhost'],
      ['127.0.0.1'],
      ['127.1.2.3'],
      ['::1'],
      ['192.168.1.20', 'localhost'],
      Array.from({ length: 9 }, (_, index) => `10.0.0.${index + 1}`),
    ]
    for (const hosts of refused) {
      const response = await put(hosts)
      expect(response.status, hosts.join(',')).toBe(400)
    }
    expect((await call('PUT', peer('127.0.0.1'), { hosts: ['10.0.0.1'], port: 1 })).status).toBe(400)
    expect((await call('PUT', peer('127.0.0.1'), { hosts: '10.0.0.1' })).status).toBe(400)
    expect(readNodeReach(dir).advertiseHost).toBeUndefined()

    // The limits themselves are fine.
    const eight = Array.from({ length: 8 }, (_, index) => `10.0.0.${index + 1}`)
    expect((await put(eight)).status).toBe(200)
    expect((await put([`${'a'.repeat(249)}.com`, 'build-01.tail1234.ts.net', '100.64.0.1'])).status).toBe(200)
  })

  it('reports hosts the environment sets, and refuses to write over them', async () => {
    process.env.ACORN_ADVERTISE_HOST = '10.0.0.4'
    const at = peer('127.0.0.1', { ADVERTISED_HOSTS: ['10.0.0.4'] })
    expect(await (await call('GET', at)).json()).toMatchObject({
      hosts: ['10.0.0.4'],
      source: 'environment',
      restartRequired: false,
    })
    const response = await put(['192.168.1.20'], at)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'reach_set_by_environment' } })
    expect(readNodeReach(dir).advertiseHost).toBeUndefined()
  })
})
