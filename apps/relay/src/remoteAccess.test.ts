import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pairedNode, toBrokerNode } from '@acorn/custody/broker'
import { pairWithNode, probeNode } from '@acorn/custody/broker/nodePairing.ts'
import { startAccountStub, type AccountStub } from '@acorn/node-core/testkit'
import { accountAuth } from './auth'
import { nodeHarness, waitFor, type RunningNode } from './testkit/nodes'
import { startRelay, type Relay } from './relay'

// Remote access end to end, with real Nodes (docs/relay/accounts.md § Remote access): a Node signs in to
// the stand-in account service and turns remote access on, and a second Node, signed in to the same
// account on another "computer", pairs with it and reaches it through a relay that checks tickets.

let account: AccountStub
let relay: Relay
let relayLog: string[]
const { startNode, request, ask, signIn, stopAll } = nodeHarness(() => account)

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
  await stopAll()
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
    // A client listing the Nodes its providers know about doesn't make a signed-out Node call out either.
    expect((await request(home, 'GET', '/v1/core/nodes')).json).toMatchObject({ nodes: [], failures: [] })
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
    const probe = await probeNode(address, { relayTicket: (relay) => away.broker.relayTicket(relay) })
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
