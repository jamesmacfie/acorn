import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pairedNode, toBrokerNode } from '@acorn/custody/broker'
import { askToPair, collectPairing, probeNode } from '@acorn/custody/broker/nodePairing.ts'
import { askVouchedNode, VouchedIdentityError } from '@acorn/custody/broker/vouchedNode.ts'
import { nodeAdoptResultSchema, type NodeProvidersResponse } from '@acorn/protocol/nodeProviders.ts'
import { startAccountStub, type AccountStub } from '@acorn/node-core/testkit'
import { accountAuth, staticAuth } from './auth'
import { nodeHarness, waitFor, type RunningNode } from './testkit/nodes'
import { startRelay, type Relay } from './relay'

// Pairing from anywhere, with real Nodes (docs/api-reference/transport.md § Pairing by approval): the
// Node at "home" has remote access on, and the Node "away", signed in to the same account, lists it,
// asks to pair with an assertion, and is let in once a device already paired with home allows it.

let account: AccountStub
let relay: Relay
const { startNode, request, ask, signIn, stopAll } = nodeHarness(() => account)
let home: RunningNode
let away: RunningNode

beforeAll(async () => {
  account = await startAccountStub()
  relay = await startRelay({ auth: await accountAuth({ url: account.url, revocationPollMs: 100 }), log: () => {} })
  account.setRelayUrl(`ws://127.0.0.1:${relay.port}`)
  ;[home, away] = await Promise.all([startNode(), startNode()])
  await Promise.all([signIn(home), signIn(away)])
  expect((await ask(home, 'PUT', '/remote-access', { enabled: true })).status).toBe(200)
  await waitFor(async () => (await ask(home, 'GET', '/state')).json?.remoteAccess.connected === true, 'the relay')
}, 240_000)

afterAll(async () => {
  await stopAll()
  await relay.close()
  await account.close()
})

const listed = async () => {
  const { json } = await request(away, 'GET', '/v1/core/nodes')
  return (json as NodeProvidersResponse).nodes
}

const adopt = async () => {
  const { status, json } = await request(away, 'POST', '/v1/core/nodes/adopt', {
    providerId: 'account:nodes',
    providerNodeId: home.handshake.nodeId,
  })
  expect(status).toBe(200)
  const result = nodeAdoptResultSchema.parse(json)
  if (!('assertion' in result)) throw new Error('an account lists no device token')
  return result
}

const ticketFor = (relay: Parameters<Parameters<typeof askVouchedNode>[2]>[0]) => away.broker.relayTicket(relay)

describe('pairing with a Node the account lists', () => {
  it('lists the account’s Node with the fingerprint it registered', async () => {
    expect(await listed()).toMatchObject([
      {
        providerId: 'account:nodes',
        providerNodeId: home.handshake.nodeId,
        nodeId: home.handshake.nodeId,
        fingerprint: home.handshake.fingerprint,
        state: 'ready',
        endpoint: `ws://127.0.0.1:${relay.port}/${home.handshake.nodeId}`,
      },
    ])
  })

  it('refuses an ask from another computer that shows no assertion, or one that is not the owner’s', async () => {
    const probe = await probeNode(`ws://127.0.0.1:${relay.port}/${home.handshake.nodeId}`, { relayTicket: ticketFor })
    expect(await askToPair(probe, 'no assertion')).toBeNull()
    // A ticket is signed by the same service and names the same account, and is still not an assertion.
    const ticket = await ticketFor(probe.relay!)
    expect(await askToPair(probe, 'a ticket', ticket)).toBeNull()
    // The account service won't make an assertion for a Node another account owns.
    const stranger = await account.signIn('stranger')
    const refused = await fetch(`${account.url}/account/v1/assertions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${stranger.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: home.handshake.nodeId }),
    })
    expect(refused.status).toBe(404)
    expect((await request(home, 'GET', '/v1/core/pair/requests')).json).toEqual({ request: null })
  })

  it('pairs once a device already paired with it allows the ask, and audits the ask', async () => {
    const connected = performance.now()
    const vouched = await adopt()
    const { probe, ask: asked } = await askVouchedNode(vouched, 'the other computer', ticketFor)

    // What the dialog on a device paired with home shows: the same words, and where the ask came from.
    const waiting = (await request(home, 'GET', '/v1/core/pair/requests')).json!.request
    expect(waiting).toMatchObject({ deviceName: 'the other computer', phrase: asked.phrase, remote: true })
    expect(await collectPairing(probe, asked.secret)).toBeNull()
    expect((await request(home, 'POST', `/v1/core/pair/requests/${waiting.id}`, { decision: 'allow' })).status).toBe(
      204,
    )

    const result = (await collectPairing(probe, asked.secret))!
    console.info(`Connect to paired: ${Math.round(performance.now() - connected)} ms`)
    away.broker.upsert(toBrokerNode(pairedNode(probe, result, { label: 'Home', local: false }), result.deviceToken))
    await waitFor(() => away.statuses.some((s) => s.nodeId === home.handshake.nodeId && s.state === 'online'), 'home')
    const tasks = await away.broker.fetch(home.handshake.nodeId, { requestId: 'tasks', path: '/v1/core/tasks' })
    expect(tasks.status).toBe(200)

    // The row says whose ask it was, with the account and the assertion, and never the assertion itself.
    const audit = (await request(home, 'GET', '/v1/core/audit')).json!
    const raised = (audit.entries as { action: string; details?: Record<string, unknown> }[]).find(
      (entry) => entry.action === 'pairing.request.raised',
    )
    expect(raised?.details).toMatchObject({ accountId: expect.any(String), assertionId: expect.any(String) })
    expect(JSON.stringify(raised)).not.toContain(vouched.assertion)
  }, 60_000)

  it('pairs nothing when the account lists a fingerprint the Node does not present', async () => {
    account.setListedFingerprint(home.handshake.nodeId, 'ab'.repeat(32))
    const vouched = await adopt()
    expect(vouched.fingerprint).toBe('ab'.repeat(32))
    await expect(askVouchedNode(vouched, 'the other computer', ticketFor)).rejects.toBeInstanceOf(VouchedIdentityError)
    expect((await request(home, 'GET', '/v1/core/pair/requests')).json).toEqual({ request: null })
  })

  it('keeps the loopback-only ask on a relayed Node that has no owner account', async () => {
    // A Node on a self-hosted relay: another computer reaches it through the relay, and it has no account.
    const shared = await startRelay({ auth: staticAuth('shared-secret'), log: () => {} })
    try {
      const lonely = await startNode({
        ACORN_RELAY_URL: `ws://127.0.0.1:${shared.port}`,
        ACORN_RELAY_CREDENTIAL: 'shared-secret',
        ACORN_ACCOUNT_URL: '',
      })
      const probe = await probeNode(`ws://shared-secret@127.0.0.1:${shared.port}/${lonely.handshake.nodeId}`)
      const { assertion } = await (async () => {
        const { accessToken } = await account.signIn('test-account')
        const response = await fetch(`${account.url}/account/v1/assertions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({ nodeId: home.handshake.nodeId }),
        })
        return (await response.json()) as { assertion: string }
      })()
      expect(await askToPair(probe, 'from far away')).toBeNull()
      expect(await askToPair(probe, 'from far away', assertion)).toBeNull()
      expect((await request(lonely, 'GET', '/v1/core/pair/requests')).json).toEqual({ request: null })
    } finally {
      await shared.close()
    }
  }, 120_000)
})
