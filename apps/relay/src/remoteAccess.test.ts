import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { NodeStatus } from '@acorn/protocol/broker.ts'
import { NodeBroker, pairedNode, toBrokerNode } from '@acorn/custody/broker'
import { pairWithNode, probeNode } from '@acorn/custody/broker/nodePairing.ts'
import { startAccountStub, type AccountStub } from '@acorn/node-core/testkit'
import { accountAuth } from './auth'
import { startRelay, type Relay } from './relay'

// Remote access end to end, with real Nodes (docs/relay/accounts.md § Remote access): a Node signs in to
// the stand-in account service and turns remote access on, and a second Node, signed in to the same
// account on another "computer", pairs with it and reaches it through a relay that checks tickets.
// Both Nodes are the standalone entry, started as the lifecycle tests in apps/node start it.

const NODE_APP = resolve(dirname(fileURLToPath(import.meta.url)), '../../node')
const ROUTE = '/v1/p/account'
const READY_BUDGET_MS = 90_000

type Handshake = { nodeId: string; endpoint: string; fingerprint: string; certPem: string; deviceToken: string }
type RunningNode = {
  child: ChildProcess
  handshake: Handshake
  dir: string
  broker: NodeBroker
  statuses: NodeStatus[]
}

let account: AccountStub
let relay: Relay
let relayLog: string[]
const nodes: RunningNode[] = []

async function startNode(): Promise<RunningNode> {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-remote-access-'))
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/entries/standalone.ts'], {
    cwd: NODE_APP,
    env: {
      ...process.env,
      ACORN_DATA_DIR: dir,
      SESSION_ENC_KEY: '0'.repeat(64),
      GITHUB_CLIENT_ID: 'test-client',
      ACORN_PORT: '',
      ACORN_RELAY_URL: '',
      ACORN_RELAY_CREDENTIAL: '',
      ACORN_ACCOUNT_URL: account.url,
      ACORN_LAUNCHER_PIPES: '1',
    },
    stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
  })
  ;(child.stdio[4] as Writable).end('\n')
  const handshake = await new Promise<Handshake>((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('the Node wrote no handshake')), READY_BUDGET_MS)
    createInterface({ input: child.stdio[3] as Readable }).once('line', (line) => {
      clearTimeout(timer)
      resolveReady(JSON.parse(line) as Handshake)
    })
    child.once('exit', (code) => reject(new Error(`the Node exited (${code}) before it was listening`)))
  })
  const statuses: NodeStatus[] = []
  const broker = new NodeBroker(
    { frame: () => {}, bytes: () => {}, status: (status) => statuses.push(status) },
    { relayTicketRoute: `${ROUTE}/tickets` },
  )
  broker.upsert({
    nodeId: handshake.nodeId,
    label: 'This computer',
    endpoint: handshake.endpoint,
    local: true,
    fingerprint: handshake.fingerprint,
    certPem: handshake.certPem,
    token: handshake.deviceToken,
  })
  const running = { child, handshake, dir, broker, statuses }
  nodes.push(running)
  return running
}

// A request to a Node's own account plugin, as the Settings page makes it.
async function ask(node: RunningNode, method: string, path: string, body?: unknown) {
  const response = await node.broker.fetch(node.handshake.nodeId, {
    requestId: `${method}${path}${Math.random()}`,
    method,
    path: `${ROUTE}${path}`,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined
      ? {}
      : { body: { kind: 'bytes' as const, bytes: new TextEncoder().encode(JSON.stringify(body)) } }),
  })
  const text = new TextDecoder().decode(response.body)
  return { status: response.status, json: text ? (JSON.parse(text) as Record<string, any>) : undefined }
}

async function signIn(node: RunningNode): Promise<void> {
  const started = (await ask(node, 'POST', '/auth/device/start')).json!
  const poll = await ask(node, 'POST', '/auth/device/poll', { deviceCode: started.deviceCode })
  expect(poll.json).toMatchObject({ status: 'connected' })
}

const waitFor = async (predicate: () => boolean | Promise<boolean>, label: string): Promise<void> => {
  const deadline = Date.now() + 20_000
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

beforeAll(async () => {
  account = await startAccountStub()
  relayLog = []
  relay = await startRelay({
    auth: await accountAuth({ url: account.url, revocationPollMs: 100 }),
    log: (line) => relayLog.push(line),
  })
  account.setRelayUrl(`ws://127.0.0.1:${relay.port}`)
}, 30_000)

afterAll(async () => {
  for (const node of nodes) {
    node.broker.dispose()
    node.child.kill('SIGKILL')
    rmSync(node.dir, { recursive: true, force: true })
  }
  await relay.close()
  await account.close()
})

describe('remote access between two Nodes on one account', () => {
  let home: RunningNode
  let away: RunningNode

  it('makes no outbound connection until someone signs in', async () => {
    ;[home, away] = await Promise.all([startNode(), startNode()])
    // Both Nodes have booted, with an account service to sign in to, and neither has called it.
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    // The relay reads the keys and the revocation list itself, which isn't a Node's doing.
    expect(account.requests().filter((request) => !/\/(keys|relay\/revoked)$/.test(request))).toEqual([])
    expect(relayLog).toEqual([])
    expect((await ask(home, 'GET', '/state')).json).toMatchObject({
      configured: true,
      account: null,
      remoteAccess: { enabled: false },
    })
  }, 180_000)

  it('turns remote access on, and the Node reaches the relay', async () => {
    await signIn(home)
    const on = await ask(home, 'PUT', '/remote-access', { enabled: true })
    expect(on.status).toBe(200)
    await waitFor(async () => (await ask(home, 'GET', '/state')).json?.remoteAccess.connected === true, 'the relay')
    expect(relayLog).toContain(`route ${home.handshake.nodeId} connected`)
    expect(account.nodes()).toMatchObject([{ nodeId: home.handshake.nodeId }])
    const identity = JSON.parse(readFileSync(join(home.dir, 'node.json'), 'utf8'))
    expect(identity.owner.accountId).toBeTruthy()
    expect(identity.relay.url).toBe(`ws://127.0.0.1:${relay.port}`)
  }, 60_000)

  let paired: ReturnType<typeof toBrokerNode>

  it('lets the same account, on another Node, pair with it and reach it through the relay', async () => {
    await signIn(away)
    const started = await home.broker.fetch(home.handshake.nodeId, {
      requestId: 'pair',
      method: 'POST',
      path: '/v1/core/pair/start',
    })
    const { code: pairingCode } = JSON.parse(new TextDecoder().decode(started.body)) as { code: string }

    const address = `ws://127.0.0.1:${relay.port}/${home.handshake.nodeId}`
    const probe = await probeNode(address, { relayTicket: (nodeId) => away.broker.relayTicket(nodeId) })
    expect(probe.fingerprint).toBe(home.handshake.fingerprint)
    const result = await pairWithNode(probe, { code: pairingCode, deviceName: 'the other computer' })
    const record = pairedNode(probe, result, { label: 'Home', local: false })
    // No credential is kept: every stream presents a ticket from the account.
    expect(record.relayCredential).toBeUndefined()

    paired = toBrokerNode(record, result.deviceToken)
    away.broker.upsert(paired)
    await waitFor(() => away.statuses.some((s) => s.nodeId === paired.nodeId && s.state === 'online'), 'the Node')
    const tasks = await away.broker.fetch(paired.nodeId, { requestId: 'tasks', path: '/v1/core/tasks' })
    expect(tasks.status).toBe(200)
  }, 120_000)

  it('does not let another account have a ticket for the Node', async () => {
    const stranger = await account.signIn('stranger')
    const response = await fetch(`${account.url}/account/v1/tickets`, {
      method: 'POST',
      headers: { authorization: `Bearer ${stranger.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: home.handshake.nodeId }),
    })
    expect(response.status).toBe(404)
  })

  it('turns off at once: the other Node loses it, and it forgets the account', async () => {
    const off = await ask(home, 'PUT', '/remote-access', { enabled: false })
    expect(off.json).toEqual({ accountNotified: true })
    await waitFor(() => relayLog.includes(`route ${home.handshake.nodeId} disconnected`), 'the relay to notice')
    await waitFor(() => away.statuses.at(-1)?.state !== 'online', 'the other Node to lose it')
    expect(account.nodes()).toEqual([])
    const identity = JSON.parse(readFileSync(join(home.dir, 'node.json'), 'utf8'))
    expect(identity.relay).toBeUndefined()
    expect(identity.owner).toBeUndefined()
    // The Node still works locally.
    expect(
      (await home.broker.fetch(home.handshake.nodeId, { requestId: 'local', path: '/v1/core/tasks' })).status,
    ).toBe(200)
  }, 60_000)
})
