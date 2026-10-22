import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket, type ClientOptions } from 'ws'
import { RELAY_REPLACED, relayControlMessageSchema, relayUrls } from '@acorn/protocol/relay.ts'
import { startRelay, type Relay } from './relay'

// The relay against raw WebSocket clients, one rule of PROTOCOL.md at a time.

const CREDENTIAL = 'relay-test-credential'
const ROUTE = 'node-a'
const sockets: WebSocket[] = []
let relay: Relay

beforeEach(async () => {
  relay = await startRelay({ credential: CREDENTIAL, acceptTimeoutMs: 300 })
})

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate()
  await relay.close()
})

const url = (): string => `ws://127.0.0.1:${relay.port}`
const as = (credential = CREDENTIAL): ClientOptions => ({ headers: { authorization: `Bearer ${credential}` } })

function open(address: string, options: ClientOptions = as()): WebSocket {
  const ws = new WebSocket(address, options)
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

const next = <T>(ws: WebSocket, event: 'message' | 'close'): Promise<T> =>
  new Promise((resolve) => ws.once(event, (...args: unknown[]) => resolve(args as T)))

// A Node that answers each stream offer with `answer`, which by default opens its end.
async function registerNode(answer?: (offer: { id: string; kind: string }, control: WebSocket) => void) {
  const control = open(relayUrls.node(url(), ROUTE))
  expect(await upgradeStatus(control)).toBe(101)
  const offers: { id: string; kind: string }[] = []
  const legs: WebSocket[] = []
  control.on('message', (data) => {
    const message = relayControlMessageSchema.parse(JSON.parse(data.toString()))
    if (message.type !== 'stream') return
    offers.push(message)
    if (answer) return answer(message, control)
    legs.push(open(relayUrls.accept(url(), ROUTE, message.id)))
  })
  return { control, offers, legs }
}

describe('the relay', () => {
  it('refuses a missing or wrong credential before it says whether a route exists', async () => {
    await registerNode()
    expect(await upgradeStatus(open(relayUrls.node(url(), ROUTE), {}))).toBe(401)
    expect(await upgradeStatus(open(relayUrls.connect(url(), ROUTE, 'tls'), as('wrong')))).toBe(401)
  })

  it('answers 404 for a route no Node holds, and 400 for a malformed one', async () => {
    expect(await upgradeStatus(open(relayUrls.connect(url(), ROUTE, 'tls')))).toBe(404)
    expect(await upgradeStatus(open(relayUrls.connect(url(), 'Not_A_Route', 'tls')))).toBe(400)
    expect(await upgradeStatus(open(relayUrls.connect(url(), ROUTE, 'TLS!')))).toBe(400)
  })

  it('joins a client to the Node and carries bytes both ways, unchanged', async () => {
    const node = await registerNode()
    const client = open(relayUrls.connect(url(), ROUTE, 'tls'))
    expect(await upgradeStatus(client)).toBe(101)
    expect(node.offers).toEqual([{ type: 'stream', id: expect.stringMatching(/^[0-9a-f]{32}$/), kind: 'tls' }])
    const [leg] = node.legs
    const toNode = next<[Buffer, boolean]>(leg!, 'message')
    client.send(Buffer.from([0x16, 0x03, 0x01]))
    expect(await toNode).toEqual([Buffer.from([0x16, 0x03, 0x01]), true])
    const toClient = next<[Buffer, boolean]>(client, 'message')
    leg!.send(Buffer.from('reply'))
    expect(await toClient).toEqual([Buffer.from('reply'), true])
    // Either end closing closes the other.
    const closed = next<[number]>(leg!, 'close')
    client.close()
    await closed
  })

  it('answers 502 when the Node refuses, and 504 when it never opens its end', async () => {
    await registerNode((offer, control) =>
      offer.kind === 'browser' ? control.send(JSON.stringify({ type: 'refuse', id: offer.id, reason: 'no' })) : null,
    )
    expect(await upgradeStatus(open(relayUrls.connect(url(), ROUTE, 'browser')))).toBe(502)
    expect(await upgradeStatus(open(relayUrls.connect(url(), ROUTE, 'tls')))).toBe(504)
  })

  it('accepts a Node end only for a stream that is waiting', async () => {
    await registerNode()
    expect(await upgradeStatus(open(relayUrls.accept(url(), ROUTE, 'a'.repeat(32))))).toBe(404)
  })

  it('gives a route to the newest Node and tells the older one', async () => {
    const older = await registerNode()
    const replaced = next<[number]>(older.control, 'close')
    const newer = await registerNode()
    expect((await replaced)[0]).toBe(RELAY_REPLACED)
    expect(await upgradeStatus(open(relayUrls.connect(url(), ROUTE, 'tls')))).toBe(101)
    expect(newer.offers).toHaveLength(1)
  })

  it('closes both ends of a stream that carries text', async () => {
    const node = await registerNode()
    const client = open(relayUrls.connect(url(), ROUTE, 'tls'))
    await upgradeStatus(client)
    const closed = next<[number]>(node.legs[0]!, 'close')
    client.send('GET / HTTP/1.1')
    expect((await closed)[0]).toBe(1003)
  })
})
