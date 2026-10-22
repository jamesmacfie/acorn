import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { accountPaths, registerNodeResponseSchema, ticketResponseSchema } from '@acorn/protocol/account.ts'
import { RELAY_REVOKED, relayControlMessageSchema, relayUrls } from '@acorn/protocol/relay.ts'
import { startAccountStub, type AccountStub } from '@acorn/node-core/testkit'
import { accountAuth } from './auth'
import { startRelay, type Relay } from './relay'

// A relay that checks an account service, against the stand-in: who gets a route, who gets a stream,
// and what removing a Node on the website does (docs/relay/accounts.md § Who may connect).

let account: AccountStub
let relay: Relay
const sockets: WebSocket[] = []

beforeEach(async () => {
  account = await startAccountStub()
  const auth = await accountAuth({ url: account.url, revocationPollMs: 50 })
  relay = await startRelay({ auth, acceptTimeoutMs: 300 })
  account.setRelayUrl(`ws://127.0.0.1:${relay.port}`)
})

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate()
  await relay.close()
  await account.close()
})

const url = (): string => `ws://127.0.0.1:${relay.port}`

function open(address: string, bearer: string): WebSocket {
  const ws = new WebSocket(address, { headers: { authorization: `Bearer ${bearer}` } })
  ws.on('error', () => {})
  sockets.push(ws)
  return ws
}

// 101 once the upgrade completes, or the status the relay answered instead.
const upgradeStatus = (ws: WebSocket): Promise<number> =>
  new Promise((resolve) => {
    ws.once('open', () => resolve(101))
    ws.once('unexpected-response', (request, response) => {
      request.destroy()
      resolve(response.statusCode ?? 0)
    })
  })

const api = async (token: string, method: string, path: string, body?: unknown) =>
  (
    await fetch(`${account.url}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  ).json()

// A signed-in account with one registered Node whose control connection is open at the relay.
async function connectedNode(login: string) {
  const { accessToken } = await account.signIn(login)
  const nodeId = randomUUID()
  const { relay: registered } = registerNodeResponseSchema.parse(
    await api(accessToken, 'PUT', accountPaths.node(nodeId), { label: 'Laptop', fingerprint: 'ab'.repeat(32) }),
  )
  const control = open(relayUrls.node(url(), nodeId), registered.credential)
  expect(await upgradeStatus(control)).toBe(101)
  // The Node opens its end of each stream the relay offers, with its credential.
  control.on('message', (data) => {
    const offer = relayControlMessageSchema.parse(JSON.parse(data.toString()))
    if (offer.type === 'stream') open(relayUrls.accept(url(), nodeId, offer.id), registered.credential)
  })
  const ticket = async () =>
    ticketResponseSchema.parse(await api(accessToken, 'POST', accountPaths.tickets, { nodeId })).ticket
  return { accessToken, nodeId, credential: registered.credential, control, ticket }
}

describe('a relay that checks an account service', () => {
  it('lets the account that owns a Node open a stream to it', async () => {
    const owner = await connectedNode('owner')
    const stream = open(relayUrls.connect(url(), owner.nodeId, 'tls'), await owner.ticket())
    expect(await upgradeStatus(stream)).toBe(101)
  })

  it('refuses a ticket issued to another account for the same Node', async () => {
    const owner = await connectedNode('owner')
    const stranger = await account.signIn('stranger')
    const forged = await account.forgeTicket(stranger.account.id, owner.nodeId)
    expect(await upgradeStatus(open(relayUrls.connect(url(), owner.nodeId, 'tls'), forged))).toBe(401)
  })

  it('refuses a ticket for a different Node', async () => {
    const owner = await connectedNode('owner')
    const other = await connectedNode('other')
    const ticket = await other.ticket()
    expect(await upgradeStatus(open(relayUrls.connect(url(), owner.nodeId, 'tls'), ticket))).toBe(401)
  })

  it('refuses text that is not a ticket, a Node credential in a ticket’s place, and the reverse', async () => {
    const owner = await connectedNode('owner')
    const connect = (bearer: string) => upgradeStatus(open(relayUrls.connect(url(), owner.nodeId, 'tls'), bearer))
    expect(await connect('not-a-ticket')).toBe(401)
    expect(await connect(owner.credential)).toBe(401)
    expect(await upgradeStatus(open(relayUrls.node(url(), owner.nodeId), await owner.ticket()))).toBe(401)
  })

  it('refuses a Node credential on a route that is not the Node’s', async () => {
    const owner = await connectedNode('owner')
    expect(await upgradeStatus(open(relayUrls.node(url(), randomUUID()), owner.credential))).toBe(401)
  })

  it('drops a Node whose credential the account service revoked, and refuses it back', async () => {
    const owner = await connectedNode('owner')
    const closed = new Promise<number>((resolve) => owner.control.once('close', resolve))
    account.remove(owner.nodeId)
    expect(await closed).toBe(RELAY_REVOKED)
    expect(await upgradeStatus(open(relayUrls.node(url(), owner.nodeId), owner.credential))).toBe(401)
  })
})
