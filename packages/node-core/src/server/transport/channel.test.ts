import { describe, expect, it } from 'vitest'
import { openChannel, type SecureChannel } from '@acorn/channel/secure.ts'
import { channelIdentity, socketPair } from '@acorn/channel/testkit.ts'
import {
  channelNodeMessageSchema,
  decodeChannelMessage,
  encodeChannelMessage,
  type ChannelClientMessage,
} from '@acorn/protocol/channel.ts'
import { serveChannel } from './channel'
import type { HubSocket, WsHub } from './wsHub'

// The Node's end of a phone's channel, with the router and the hub stood in for. The handshake and the
// messages are the real ones.

const HOST = 'node-1.relay.acorn'
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

// A hub that admits the token `good` and keeps the socket it was given.
function fakeHub() {
  const joined: { socket: HubSocket; host: string; token: string }[] = []
  const hub: WsHub = {
    async join(socket, host, token) {
      if (token !== 'good') return false
      joined.push({ socket, host, token })
      return true
    },
  }
  return { hub, joined }
}

async function connect(dispatch: (request: Request) => Promise<Response>) {
  const { identity, publicKey } = await channelIdentity()
  const { hub, joined } = fakeHub()
  const [phoneSocket, nodeSocket] = socketPair()
  const served = serveChannel(nodeSocket, { identity, host: HOST, dispatch, hub })
  const phone = await openChannel(phoneSocket, publicKey)
  const send = (message: ChannelClientMessage, body?: Uint8Array) => phone.write(encodeChannelMessage(message, body))
  const next = async () => {
    const envelope = decodeChannelMessage((await phone.read())!, channelNodeMessageSchema)
    return envelope!
  }
  return { phone, send, next, joined, served }
}

describe('the Node end of a phone channel', () => {
  it('answers a request through the router, as a peer with no address', async () => {
    let seen: Request | undefined
    const { send, next } = await connect(async (request) => {
      seen = request
      return new Response('{"projects":[]}', { status: 200, headers: { 'content-type': 'application/json' } })
    })
    await send({
      type: 'request',
      id: 'r1',
      method: 'GET',
      path: '/v1/core/projects?limit=5',
      headers: {
        authorization: 'Bearer token',
        cookie: 'a=b',
        'x-acorn-internal': 'secret',
        'x-ok': '1',
        host: 'evil',
      },
    })
    const answer = await next()
    expect(answer.message).toMatchObject({ type: 'response', id: 'r1', status: 200 })
    expect(text(answer.body)).toBe('{"projects":[]}')
    expect(seen!.url).toBe(`https://${HOST}/v1/core/projects?limit=5`)
    expect(seen!.headers.get('host')).toBe(HOST)
    expect(seen!.headers.get('authorization')).toBe('Bearer token')
    expect(seen!.headers.get('x-ok')).toBe('1')
    expect(seen!.headers.get('cookie')).toBeNull()
    expect(seen!.headers.get('x-acorn-internal')).toBeNull()
  })

  it('passes a request body to the router', async () => {
    const { send, next } = await connect(async (request) => new Response(await request.text(), { status: 201 }))
    await send(
      { type: 'request', id: 'r1', method: 'POST', path: '/v1/core/tasks', headers: {} },
      new TextEncoder().encode('{"name":"x"}'),
    )
    const answer = await next()
    expect(answer.message).toMatchObject({ status: 201 })
    expect(text(answer.body)).toBe('{"name":"x"}')
  })

  it('stops a request the phone abandons, and says nothing more about it', async () => {
    let aborted = false
    const { send, next } = await connect(
      (request) =>
        new Promise((_resolve, reject) =>
          request.signal.addEventListener('abort', () => {
            aborted = true
            reject(new Error('aborted'))
          }),
        ),
    )
    await send({ type: 'request', id: 'slow', method: 'GET', path: '/v1/slow', headers: {} })
    await send({ type: 'abort', id: 'slow' })
    await send({ type: 'ping' })
    // The pong is the first thing to come back, so no failure was sent for the abandoned request.
    expect((await next()).message.type).toBe('pong')
    expect(aborted).toBe(true)
  })

  it('refuses a request whose answer is too large, rather than breaking the channel', async () => {
    const { send, next } = await connect(async () => new Response(new Uint8Array(20 * 1024 * 1024)))
    await send({ type: 'request', id: 'big', method: 'GET', path: '/v1/big', headers: {} })
    expect((await next()).message).toMatchObject({ type: 'failure', id: 'big', code: 'response_too_large' })
  })

  it('refuses a request that cannot be made into one', async () => {
    const { send, next } = await connect(async () => new Response('never'))
    await send({ type: 'request', id: 'odd', method: 'NOT A METHOD', path: '/v1/x', headers: {} })
    expect((await next()).message).toMatchObject({ type: 'failure', id: 'odd', code: 'bad_request' })
  })

  it('joins the event hub for a live token and carries frames both ways', async () => {
    const { send, next, joined } = await connect(async () => new Response())
    await send({ type: 'events', token: 'good' })
    expect((await next()).message.type).toBe('events-open')
    expect(joined).toHaveLength(1)
    expect(joined[0]).toMatchObject({ host: HOST, token: 'good' })
    const feed = joined[0]!.socket

    const heard: string[] = []
    feed.on('message', (raw) => heard.push(raw.toString()))
    await send({ type: 'frame' }, new TextEncoder().encode('{"channel":"term:attach","id":"t1"}'))
    await send({ type: 'ping' })
    await next()
    expect(heard).toEqual(['{"channel":"term:attach","id":"t1"}'])

    feed.send('{"channel":"agent:status","seq":1}')
    const frame = await next()
    expect(frame.message.type).toBe('frame')
    expect(text(frame.body)).toBe('{"channel":"agent:status","seq":1}')
    feed.send(new Uint8Array([1, 2, 3]), { binary: true })
    const bytes = await next()
    expect(bytes.message.type).toBe('bytes')
    expect([...bytes.body]).toEqual([1, 2, 3])
  })

  it('tells the phone when the hub refuses its token', async () => {
    const { send, next, joined } = await connect(async () => new Response())
    await send({ type: 'events', token: 'revoked' })
    expect((await next()).message.type).toBe('events-refused')
    expect(joined).toHaveLength(0)
  })

  it('hears a pong from the phone as the feed answering the hub’s ping', async () => {
    const { send, next, joined } = await connect(async () => new Response())
    await send({ type: 'events', token: 'good' })
    await next()
    const feed = joined[0]!.socket
    let ponged = false
    feed.on('pong', () => (ponged = true))
    feed.ping()
    expect((await next()).message.type).toBe('ping')
    await send({ type: 'pong' })
    await send({ type: 'ping' })
    await next()
    expect(ponged).toBe(true)
  })

  it('closes the feed when the phone goes away, and when the hub closes it', async () => {
    const { phone, send, next, joined, served } = await connect(async () => new Response())
    await send({ type: 'events', token: 'good' })
    await next()
    const feed = joined[0]!.socket
    let closed = 0
    feed.on('close', () => closed++)
    feed.terminate()
    await served
    expect(closed).toBe(1)
    expect(feed.readyState).not.toBe(feed.OPEN)
    expect(await phone.read()).toBeNull()
  })

  it('closes on a message that is not of this protocol', async () => {
    const { phone, served } = await connect(async () => new Response())
    await (phone as SecureChannel).write(new TextEncoder().encode('GET / HTTP/1.1'))
    await served
    expect(await phone.read()).toBeNull()
  })
})
