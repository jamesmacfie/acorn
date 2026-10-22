import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  connectionProviderRegistry,
  makeTestDb,
  startAccountStub,
  testGate,
  testSecretEnv,
  type AccountStub,
  type AppEnv,
  type Env,
  type Principal,
  type TestDb,
} from '@acorn/plugin-api/testkit'
import { channelPublicKey, readNodeRelay } from '@acorn/plugin-api/node'
import { accountProvider } from './provider'
import { accountRoutes } from './routes'

// The account plugin's routes against the stand-in account service: sign in, turn remote access on and
// off, and ask for a ticket.

const PRINCIPAL: Principal = { kind: 'device', deviceId: 'd1', userId: 'james' }
const NODE_ID = '7f3c9c1e-5b2a-4d1e-9f77-2a5c8d0b1e44'

let harness: TestDb
let account: AccountStub
let dataDir: string
// What the listener's relay control would be told, in order.
let applied: ({ url: string; credential: string } | undefined)[]

beforeEach(async () => {
  harness = makeTestDb()
  account = await startAccountStub()
  dataDir = mkdtempSync(join(tmpdir(), 'acorn-account-'))
  applied = []
  vi.stubEnv('ACORN_ACCOUNT_URL', account.url)
  vi.stubEnv('ACORN_RELAY_URL', '')
  vi.stubEnv('ACORN_RELAY_CREDENTIAL', '')
  if (!connectionProviderRegistry.get('account')) connectionProviderRegistry.register(accountProvider())
  // The Node's identity file, which remote access adds the relay and owner to.
  writeFileSync(join(dataDir, 'node.json'), JSON.stringify({ baseline: 'acorn-1', nodeId: NODE_ID, createdAt: 1 }))
})

afterEach(async () => {
  vi.unstubAllEnvs()
  harness.cleanup()
  await account.close()
  rmSync(dataDir, { recursive: true, force: true })
})

const env = () =>
  ({
    DB: harness.db,
    DATA_DIR: dataDir,
    NODE_ID,
    NODE_FINGERPRINT: 'ab'.repeat(32),
    RELAY: { apply: async (settings: never) => void applied.push(settings), state: () => undefined },
    ...testSecretEnv('0'.repeat(64)),
  }) as unknown as Env

const call = (method: string, path: string, body?: unknown, principal: Principal = PRINCIPAL) =>
  new Hono<AppEnv>()
    .use('/api/*', ...testGate(principal))
    .route('/api/account', accountRoutes())
    .fetch(
      new Request(`http://acorn.test/api/account${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env(),
    )

async function signIn(): Promise<void> {
  const started = (await (await call('POST', '/auth/device/start')).json()) as { deviceCode: string }
  const poll = await call('POST', '/auth/device/poll', { deviceCode: started.deviceCode })
  expect(await poll.json()).toMatchObject({ status: 'connected' })
}

const state = async () => (await (await call('GET', '/state')).json()) as import('../shared/state').AccountState

describe('signing in', () => {
  it('starts signed out, with remote access off', async () => {
    expect(await state()).toEqual({
      configured: true,
      account: null,
      remoteAccess: { enabled: false, connected: false },
    })
  })

  it('reports that a build with no account service has nothing to sign in to', async () => {
    vi.stubEnv('ACORN_ACCOUNT_URL', '')
    expect((await state()).configured).toBe(false)
    expect((await call('POST', '/auth/device/start')).status).toBe(503)
  })

  it('signs in through the device flow and shows the account', async () => {
    await signIn()
    expect((await state()).account).toMatchObject({ name: 'test-account' })
  })

  it('reports a flow nobody has approved yet as pending, then connects', async () => {
    await account.close()
    account = await startAccountStub({ approveAs: false })
    vi.stubEnv('ACORN_ACCOUNT_URL', account.url)
    const started = (await (await call('POST', '/auth/device/start')).json()) as {
      deviceCode: string
      userCode: string
    }
    expect(await (await call('POST', '/auth/device/poll', { deviceCode: started.deviceCode })).json()).toEqual({
      status: 'pending',
    })
    account.approve(started.userCode, 'late-login')
    expect(await (await call('POST', '/auth/device/poll', { deviceCode: started.deviceCode })).json()).toMatchObject({
      status: 'connected',
    })
  })

  it('answers a request that is not from a paired device with a refusal', async () => {
    const task: Principal = { kind: 'internal', userId: 'james', scope: 'task', taskId: 't1' }
    for (const [method, path] of [
      ['GET', '/state'],
      ['POST', '/auth/device/start'],
      ['PUT', '/remote-access'],
      ['POST', '/tickets'],
    ] as const)
      expect((await call(method, path, method === 'GET' ? undefined : {}, task)).status).toBe(403)
  })
})

describe('remote access', () => {
  it('needs a signed-in account to turn on', async () => {
    expect((await call('PUT', '/remote-access', { enabled: true })).status).toBe(401)
  })

  it('registers the Node, records its relay and owner, and starts the tunnel', async () => {
    await signIn()
    account.setRelayUrl('wss://relay.example.test')
    const on = await call('PUT', '/remote-access', { enabled: true })
    expect(on.status).toBe(200)

    const { relay, owner } = readNodeRelay(dataDir)
    expect(relay?.url).toBe('wss://relay.example.test')
    expect(relay?.credential).toBeTruthy()
    expect(owner?.accountId).toBe((await state()).account?.id)
    expect(applied).toEqual([relay])
    expect(account.nodes()).toMatchObject([
      { nodeId: NODE_ID, fingerprint: 'ab'.repeat(32), channelKey: channelPublicKey(dataDir) },
    ])
    expect((await state()).remoteAccess).toMatchObject({ enabled: true, relayUrl: 'wss://relay.example.test' })
  })

  it('turns off at once, forgets the relay and owner, and removes the Node from the account', async () => {
    await signIn()
    await call('PUT', '/remote-access', { enabled: true })
    const off = await call('PUT', '/remote-access', { enabled: false })
    expect(await off.json()).toEqual({ accountNotified: true })
    expect(readNodeRelay(dataDir)).toEqual({})
    expect(applied.at(-1)).toBeUndefined()
    expect(account.nodes()).toEqual([])
  })

  it('still turns off when the account service is gone', async () => {
    await signIn()
    await call('PUT', '/remote-access', { enabled: true })
    await account.close()
    const off = await call('PUT', '/remote-access', { enabled: false })
    expect(await off.json()).toEqual({ accountNotified: false })
    expect(readNodeRelay(dataDir)).toEqual({})
  })

  it('refuses to take the place of a relay somebody set up another way', async () => {
    await signIn()
    vi.stubEnv('ACORN_RELAY_URL', 'wss://elsewhere.example.test')
    const on = await call('PUT', '/remote-access', { enabled: true })
    expect(on.status).toBe(409)
    expect(account.nodes()).toEqual([])
    expect((await state()).remoteAccess.blocked).toBeTruthy()
  })

  it('signs out by turning remote access off first', async () => {
    await signIn()
    await call('PUT', '/remote-access', { enabled: true })
    expect((await call('POST', '/sign-out')).status).toBe(200)
    expect(readNodeRelay(dataDir)).toEqual({})
    expect(account.nodes()).toEqual([])
    expect((await state()).account).toBeNull()
  })
})

describe('tickets', () => {
  it('gets a ticket for a Node the account owns, and refuses the rest', async () => {
    await signIn()
    await call('PUT', '/remote-access', { enabled: true })
    const ticket = await call('POST', '/tickets', { nodeId: NODE_ID })
    expect(await ticket.json()).toMatchObject({ ticket: expect.any(String), relayUrl: expect.any(String) })
    expect((await call('POST', '/tickets', { nodeId: '11111111-2222-4333-8444-555555555555' })).status).toBe(404)
  })

  it('asks for a sign-in when nobody is signed in', async () => {
    expect((await call('POST', '/tickets', { nodeId: NODE_ID })).status).toBe(401)
  })
})
