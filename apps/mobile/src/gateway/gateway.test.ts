import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pairingCodes } from '@acorn/node-core/server/auth/pairingCodes.ts'
import type { NodeFetchRequest, NodeFetchResponse, NodeStatus } from '@acorn/protocol/broker.ts'
import { SIGNED_OUT_CLOSE_CODE, startGateway, type Gateway, type GatewayBroker } from './gateway'
import { sessionStore } from './sessions'

const ORIGIN = 'https://phone.example'
const HOST = 'phone.example'
const NODE_ID = 'node-1'

let dir: string
let now: number
let code: string
let broker: { [K in keyof GatewayBroker]: ReturnType<typeof vi.fn> }
let gateway: Gateway

type Reply = { status: number; headers: Record<string, string | string[] | undefined>; body: string }

function send(
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Reply> {
  return new Promise((done, fail) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: gateway.port,
        path,
        method: options.method ?? 'GET',
        headers: { host: HOST, ...options.headers },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () =>
          done({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks).toString() }),
        )
      },
    )
    req.on('error', fail)
    req.end(options.body)
  })
}

const signIn = (attempt: string, headers: Record<string, string> = {}): Promise<Reply> =>
  send('/session', { method: 'POST', headers: { origin: ORIGIN, ...headers }, body: JSON.stringify({ code: attempt }) })

async function cookie(): Promise<string> {
  const reply = await signIn(code)
  expect(reply.status).toBe(204)
  return String(reply.headers['set-cookie']).split(';')[0]!
}

type Message = { data: unknown; isBinary: boolean }

// Messages are queued from the start, because the first can arrive in the same packet as the opening.
function openSocket(headers: Record<string, string>): Promise<{ ws: WebSocket; next(): Promise<Message> }> {
  const ws = new WebSocket(`ws://127.0.0.1:${gateway.port}/events`, { headers: { host: HOST, ...headers } })
  const queued: Message[] = []
  const waiting: ((message: Message) => void)[] = []
  ws.on('message', (data, isBinary) => {
    const message = { data, isBinary }
    const waiter = waiting.shift()
    if (waiter) waiter(message)
    else queued.push(message)
  })
  const next = (): Promise<Message> =>
    queued.length ? Promise.resolve(queued.shift()!) : new Promise((done) => waiting.push(done))
  return new Promise((done, fail) => {
    ws.once('open', () => done({ ws, next }))
    ws.once('error', fail)
  })
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'acorn-gateway-'))
  mkdirSync(join(dir, 'app'))
  writeFileSync(join(dir, 'app', 'index.html'), '<!doctype html><title>Acorn</title>')
  now = 0
  const codes = pairingCodes(() => now)
  code = codes.issue()
  broker = {
    fetch: vi.fn(async (): Promise<NodeFetchResponse> => ({
      status: 200,
      headers: { 'content-type': 'application/json', 'set-cookie': 'node=1', 'transfer-encoding': 'chunked' },
      body: new TextEncoder().encode('{"tasks":[]}'),
    })),
    abort: vi.fn(),
    send: vi.fn(() => true),
    openViewer: vi.fn(() => true),
    closeViewer: vi.fn(),
  }
  gateway = await startGateway({
    broker: broker as unknown as GatewayBroker,
    nodeId: NODE_ID,
    label: 'Studio Mac',
    sessions: sessionStore(join(dir, 'sessions')),
    codes,
    origin: ORIGIN,
    appDir: join(dir, 'app'),
    port: 0,
  })
})

afterEach(async () => {
  await gateway.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('signing in', () => {
  it('sets a session cookie the page cannot read, for this site only', async () => {
    const reply = await signIn(code)
    expect(reply.status).toBe(204)
    const flags = String(reply.headers['set-cookie']).split('; ')
    expect(flags[0]).toMatch(/^acorn_session=[A-Za-z0-9_-]{43}$/)
    expect(flags).toEqual(expect.arrayContaining(['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']))
  })

  it('takes a code once', async () => {
    expect((await signIn(code)).status).toBe(204)
    expect((await signIn(code)).status).toBe(401)
  })

  it('spends the code after five wrong attempts', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) expect((await signIn('AAAAAAAAAAAAAAAAAAAAAA')).status).toBe(401)
    expect((await signIn(code)).status).toBe(401)
  })

  it('refuses the code after ten minutes', async () => {
    now = 10 * 60_000
    expect((await signIn(code)).status).toBe(401)
  })

  it('answers every failure the same way', async () => {
    const wrong = await signIn('AAAAAAAAAAAAAAAAAAAAAA')
    const malformed = await send('/session', { method: 'POST', headers: { origin: ORIGIN }, body: 'not json' })
    const oversized = await send('/session', { method: 'POST', headers: { origin: ORIGIN }, body: 'x'.repeat(5000) })
    for (const reply of [malformed, oversized]) expect([reply.status, reply.body]).toEqual([wrong.status, wrong.body])
    // Neither the malformed nor the oversized request spent an attempt.
    expect((await signIn(code)).status).toBe(204)
  })
})

describe('the checks on every request', () => {
  it('refuses a request from another origin', async () => {
    expect((await signIn(code, { origin: 'https://evil.example' })).status).toBe(403)
    const session = await cookie()
    const write = await send('/node/v1/core/tasks', {
      method: 'POST',
      headers: { cookie: session, origin: 'https://evil.example' },
      body: '{}',
    })
    expect(write.status).toBe(403)
    expect(broker.fetch).not.toHaveBeenCalled()
  })

  it('refuses a request without an origin when it has a body', async () => {
    const session = await cookie()
    expect(
      (await send('/node/v1/core/tasks', { method: 'POST', headers: { cookie: session }, body: '{}' })).status,
    ).toBe(403)
  })

  it('refuses a request for another host', async () => {
    const session = await cookie()
    const read = await send('/node/v1/core/tasks', { headers: { host: 'rebound.example', cookie: session } })
    expect(read.status).toBe(403)
    expect(JSON.parse(read.body)).toEqual({ error: { code: 'wrong_host', message: `This gateway serves ${ORIGIN}.` } })
    expect(broker.fetch).not.toHaveBeenCalled()
  })

  it('refuses a Node request without a live session', async () => {
    expect((await send('/node/v1/core/tasks')).status).toBe(401)
    expect((await send('/node/v1/core/tasks', { headers: { cookie: 'acorn_session=forged' } })).status).toBe(401)
    expect(broker.fetch).not.toHaveBeenCalled()
  })

  it('names its Node to a signed-in phone and says when a phone is signed out', async () => {
    const reply = await send('/session', { headers: { cookie: await cookie() } })
    expect(reply.status).toBe(200)
    expect(JSON.parse(reply.body)).toEqual({ nodeId: NODE_ID, label: 'Studio Mac' })
    const signedOut = await send('/session')
    expect(signedOut.status).toBe(401)
    expect(JSON.parse(signedOut.body).error.code).toBe('signed_out')
  })

  it('refuses a denied route and names the desktop', async () => {
    const session = await cookie()
    const reply = await send('/node/v1/core/devices', { headers: { cookie: session } })
    expect(reply.status).toBe(403)
    expect(JSON.parse(reply.body).error.message).toBe(
      "Pairing and devices isn't available from a phone. Use Acorn on your computer.",
    )
    expect(broker.fetch).not.toHaveBeenCalled()
  })
})

describe('forwarding to the Node', () => {
  it('forwards a read and answers with the Node’s status, headers, and body', async () => {
    const session = await cookie()
    const reply = await send('/node/v1/core/tasks?archived=1', {
      headers: { cookie: session, 'x-request-id': 'read-1', accept: 'application/json' },
    })
    expect(reply).toMatchObject({ status: 200, body: '{"tasks":[]}' })
    expect(reply.headers['content-type']).toBe('application/json')
    expect(reply.headers['set-cookie']).toBeUndefined()
    const [nodeId, request] = broker.fetch.mock.calls[0] as [string, NodeFetchRequest]
    expect(nodeId).toBe(NODE_ID)
    expect(request).toMatchObject({ path: '/v1/core/tasks?archived=1', method: 'GET' })
    expect(request.requestId).toMatch(/^[0-9a-f]{12}:read-1$/)
    expect(request.body).toBeUndefined()
    expect(request.headers).toEqual({ accept: 'application/json', 'x-request-id': 'read-1' })
  })

  it('sandboxes a Node answer over any policy the Node set', async () => {
    const session = await cookie()
    broker.fetch.mockResolvedValue({
      status: 200,
      headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "script-src 'unsafe-inline'" },
      body: new TextEncoder().encode('<script>fetch("/node/v1/core/terminals")</script>'),
    })
    const reply = await send('/node/v1/p/hostile/page', { headers: { cookie: session } })
    expect(reply.headers['content-type']).toBe('text/html')
    expect(reply.headers['content-security-policy']).toBe("sandbox; default-src 'none'")
    expect(reply.headers['x-content-type-options']).toBe('nosniff')
  })

  it('keeps a JSON answer’s type and sandboxes it too', async () => {
    const session = await cookie()
    const reply = await send('/node/v1/core/tasks', { headers: { cookie: session } })
    expect(reply.headers['content-type']).toBe('application/json')
    expect(reply.headers['content-security-policy']).toBe("sandbox; default-src 'none'")
    expect(reply.headers['x-content-type-options']).toBe('nosniff')
  })

  it('forwards a write with its body', async () => {
    const session = await cookie()
    await send('/node/v1/core/tasks', {
      method: 'POST',
      headers: { cookie: session, origin: ORIGIN, 'content-type': 'application/json', 'idempotency-key': 'key-1' },
      body: '{"title":"From my phone"}',
    })
    const [, request] = broker.fetch.mock.calls[0] as [string, NodeFetchRequest]
    expect(request.method).toBe('POST')
    expect(request.headers).toMatchObject({ 'content-type': 'application/json', 'idempotency-key': 'key-1' })
    expect(request.headers).not.toHaveProperty('cookie')
    expect(request.headers).not.toHaveProperty('origin')
    expect(request.body?.kind === 'bytes' && new TextDecoder().decode(request.body.bytes)).toBe(
      '{"title":"From my phone"}',
    )
  })

  it('aborts the Node request when the phone gives up on it', async () => {
    const session = await cookie()
    broker.fetch.mockImplementation(() => new Promise(() => {}))
    const req = httpRequest({
      host: '127.0.0.1',
      port: gateway.port,
      path: '/node/v1/core/tasks',
      headers: { host: HOST, cookie: session, 'x-request-id': 'slow-1' },
    })
    req.on('error', () => {})
    req.end()
    await vi.waitFor(() => expect(broker.fetch).toHaveBeenCalled())
    req.destroy()
    await vi.waitFor(() => expect(broker.abort).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{12}:slow-1$/)))
  })

  it('answers 502 when the Node cannot be reached', async () => {
    const session = await cookie()
    broker.fetch.mockRejectedValue(new Error('connect ECONNREFUSED'))
    const reply = await send('/node/v1/core/tasks', { headers: { cookie: session } })
    expect(reply.status).toBe(502)
    expect(JSON.parse(reply.body).error.code).toBe('node_unreachable')
  })
})

describe('the event socket', () => {
  it('needs a session and this origin', async () => {
    await expect(openSocket({ origin: ORIGIN })).rejects.toThrow()
    const session = await cookie()
    await expect(openSocket({ origin: 'https://evil.example', cookie: session })).rejects.toThrow()
    expect(broker.openViewer).not.toHaveBeenCalled()
  })

  it('carries frames both ways, and status and terminal bytes to the phone', async () => {
    const session = await cookie()
    const status: NodeStatus = { nodeId: NODE_ID, state: 'online' }
    gateway.status(status)
    const { ws, next } = await openSocket({ origin: ORIGIN, cookie: session })
    // A phone that connects late hears the status the Node already reported.
    expect(JSON.parse(String((await next()).data))).toEqual({ status })
    const [, viewerId] = broker.openViewer.mock.calls[0] as [string, string]

    ws.send(JSON.stringify({ frame: { channel: 'tasks:watch' }, intent: { key: 'tasks', state: 'attached' } }))
    await vi.waitFor(() =>
      expect(broker.send).toHaveBeenCalledWith(
        NODE_ID,
        { channel: 'tasks:watch' },
        {
          viewerId,
          intent: { key: 'tasks', state: 'attached' },
        },
      ),
    )

    const frame = next()
    gateway.frame({ channel: 'tasks:changed' }, 'another-viewer')
    gateway.frame({ channel: 'tasks:changed', seq: 1 }, viewerId)
    expect(JSON.parse(String((await frame).data))).toEqual({ frame: { channel: 'tasks:changed', seq: 1 } })

    const bytes = next()
    gateway.bytes(new Uint8Array([1, 2, 3]), viewerId)
    const received = await bytes
    expect(received.isBinary).toBe(true)
    expect([...(received.data as Buffer)]).toEqual([1, 2, 3])

    ws.close()
    await vi.waitFor(() => expect(broker.closeViewer).toHaveBeenCalledWith(NODE_ID, viewerId))
  })

  it('closes the socket within a second of a revoke', async () => {
    const session = await cookie()
    const { ws } = await openSocket({ origin: ORIGIN, cookie: session })
    const closed = new Promise<number>((done) => ws.once('close', (code) => done(code)))
    const elsewhere = sessionStore(join(dir, 'sessions'))
    const revokedAt = Date.now()
    elsewhere.revoke(elsewhere.list()[0]!.id)
    expect(await closed).toBe(SIGNED_OUT_CLOSE_CODE)
    expect(Date.now() - revokedAt).toBeLessThan(1000)
    expect((await send('/node/v1/core/tasks', { headers: { cookie: session } })).status).toBe(401)
  })
})

describe('the web app', () => {
  it('serves the page with its policy, for the app’s own routes too', async () => {
    for (const path of ['/', '/w/workspace-1', '/w/workspace-1/tasks', '/t/task-1']) {
      const reply = await send(path)
      expect(reply.status).toBe(200)
      expect(reply.body).toContain('<title>Acorn</title>')
      expect(reply.headers['content-security-policy']).toBe(
        "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      )
    }
  })

  it('sandboxes its error answers', async () => {
    const reply = await send('/missing.js')
    expect(reply.status).toBe(404)
    expect(reply.headers['content-security-policy']).toBe("sandbox; default-src 'none'")
    expect(reply.headers['x-content-type-options']).toBe('nosniff')
  })

  it('serves nothing outside the app', async () => {
    expect((await send('/../sessions/x.json')).status).toBe(404)
    expect((await send('/%2e%2e/%2e%2e/etc/passwd.txt')).status).toBe(404)
    expect((await send('/..%2f..%2fetc%2fpasswd.txt')).status).toBe(404)
  })
})
