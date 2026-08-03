import { execFileSync } from 'node:child_process'
import { createServer as createHttpServer, type Server } from 'node:http'
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { X509Certificate } from 'node:crypto'
import { WebSocketServer } from 'ws'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { NodeStatus } from '@acorn/protocol/broker.ts'
import { NodeBroker } from './nodeBroker'

// Drives the real broker against a real http/https server. The pin in particular cannot be
// meaningfully faked: the whole failure mode worth testing is that it fails CLOSED.

type Received = { method: string; path: string; headers: Record<string, string | string[] | undefined>; body: Buffer }

let certDir: string
let certPem: string
let keyPem: string
let fingerprint: string

// One self-signed cert for the whole file. Generated the same way the node generates its own, so this
// also proves the openssl invocation produces something Node can pin against.
beforeAll(() => {
  certDir = mkdtempSync(join(tmpdir(), 'acorn-broker-cert-'))
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3',
    '-keyout', join(certDir, 'key.pem'),
    '-out', join(certDir, 'cert.pem'),
    '-subj', '/CN=acorn-node',
    '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
    '-addext', 'basicConstraints=critical,CA:TRUE',
  ])
  certPem = readFileSync(join(certDir, 'cert.pem'), 'utf8')
  keyPem = readFileSync(join(certDir, 'key.pem'), 'utf8')
  fingerprint = new X509Certificate(certPem).fingerprint256
})

const brokers: NodeBroker[] = []
const servers: (Server | HttpsServer)[] = []
const received: Received[] = []
let statuses: NodeStatus[] = []
let respond: (path: string) => { status: number; body: string; headers?: Record<string, string> }

beforeEach(() => {
  received.length = 0
  statuses = []
  respond = () => ({ status: 200, body: '{"ok":true}', headers: { 'content-type': 'application/json' } })
})

afterEach(() => {
  for (const broker of brokers.splice(0)) broker.dispose()
  for (const server of servers.splice(0)) server.close()
})

const handler = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
  const chunks: Buffer[] = []
  req.on('data', (c: Buffer) => chunks.push(c))
  req.on('end', () => {
    received.push({ method: req.method ?? '', path: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks) })
    const reply = respond(req.url ?? '')
    res.writeHead(reply.status, reply.headers ?? {})
    res.end(reply.body)
  })
}

async function listen(secure: boolean): Promise<{ origin: string; server: Server | HttpsServer }> {
  const server = secure ? createHttpsServer({ key: keyPem, cert: certPem }, handler) : createHttpServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { origin: `${secure ? 'https' : 'http'}://127.0.0.1:${port}`, server }
}

function makeBroker(): NodeBroker {
  const broker = new NodeBroker({ frame: () => {}, status: (s) => statuses.push(s) })
  brokers.push(broker)
  return broker
}

const waitFor = async (predicate: () => boolean, label: string, timeoutMs = 5_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

// Select by path, never by index. upsert() opens the WebSocket immediately, so the /ws upgrade is
// usually the FIRST request the server sees — indexing into `received` silently asserts against the
// upgrade instead of the call under test (and passes, because the upgrade carries the same bearer).
const requestTo = (path: string): Received => {
  const match = received.find((r) => r.path === path)
  if (!match) throw new Error(`no request to ${path}; saw ${received.map((r) => r.path).join(', ')}`)
  return match
}

const bytes = (text: string) => new TextEncoder().encode(text)
const text = (body: Uint8Array) => new TextDecoder().decode(body)

describe('broker HTTP', () => {
  it('round-trips JSON and attaches the bearer itself', async () => {
    const { origin } = await listen(false)
    const broker = makeBroker()
    broker.upsert({ nodeId: 'n1', label: 'local', endpoint: origin, local: true, token: 'acorn_dt_secret' })

    const res = await broker.fetch('n1', { requestId: 'r1', path: '/v2/core/tasks' })
    expect(res.status).toBe(200)
    expect(JSON.parse(text(res.body))).toEqual({ ok: true })
    // The renderer never supplies this — the broker exists so the token stays in main.
    expect(requestTo('/v2/core/tasks').headers.authorization).toBe('Bearer acorn_dt_secret')
  })

  it('sends a JSON body with the caller content-type intact', async () => {
    const { origin } = await listen(false)
    const broker = makeBroker()
    broker.upsert({ nodeId: 'n1', label: 'local', endpoint: origin, local: true, token: 't' })

    await broker.fetch('n1', {
      requestId: 'r1',
      path: '/v2/core/tasks',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { kind: 'bytes', bytes: bytes('{"title":"x"}') },
    })
    expect(requestTo('/v2/core/tasks').headers['content-type']).toBe('application/json')
    expect(requestTo('/v2/core/tasks').body.toString()).toBe('{"title":"x"}')
  })

  // The reason the renderer had raw-fetch escape hatches at all: readJson always parsed a body.
  it('represents an empty 204 body as zero bytes', async () => {
    const { origin } = await listen(false)
    respond = () => ({ status: 204, body: '' })
    const broker = makeBroker()
    broker.upsert({ nodeId: 'n1', label: 'local', endpoint: origin, local: true, token: 't' })

    const res = await broker.fetch('n1', { requestId: 'r1', path: '/x', method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(res.body.byteLength).toBe(0)
  })

  it('encodes a multipart upload the server can parse', async () => {
    const { origin } = await listen(false)
    const broker = makeBroker()
    broker.upsert({ nodeId: 'n1', label: 'local', endpoint: origin, local: true, token: 't' })

    await broker.fetch('n1', {
      requestId: 'r1',
      path: '/upload',
      method: 'POST',
      body: {
        kind: 'form',
        parts: [
          { name: 'sessionId', value: 's1' },
          { name: 'file', filename: 'a.txt', type: 'text/plain', bytes: bytes('hello') },
        ],
      },
    })
    const contentType = String(requestTo('/upload').headers['content-type'])
    expect(contentType).toMatch(/^multipart\/form-data; boundary=acorn[0-9a-f]{32}$/)
    const boundary = contentType.split('boundary=')[1]
    const body = requestTo('/upload').body.toString()
    expect(body).toContain(`--${boundary}\r\ncontent-disposition: form-data; name="sessionId"\r\n\r\ns1`)
    expect(body).toContain('name="file"; filename="a.txt"')
    expect(body).toContain('content-type: text/plain')
    expect(body).toContain('hello')
    expect(body.endsWith(`--${boundary}--\r\n`)).toBe(true)
  })

  // A quote in a field name would otherwise let a caller forge part headers.
  it('strips characters that would break out of a multipart header', async () => {
    const { origin } = await listen(false)
    const broker = makeBroker()
    broker.upsert({ nodeId: 'n1', label: 'local', endpoint: origin, local: true, token: 't' })
    await broker.fetch('n1', {
      requestId: 'r1',
      path: '/upload',
      method: 'POST',
      body: { kind: 'form', parts: [{ name: 'a"\r\nx-evil: 1', value: 'v' }] },
    })
    expect(requestTo('/upload').body.toString()).not.toContain('x-evil: 1\r\n\r\n')
    expect(requestTo('/upload').body.toString()).toContain('name="ax-evil: 1"')
  })

  it('aborts an in-flight request', async () => {
    const { origin } = await listen(false)
    respond = () => ({ status: 200, body: 'slow' })
    const broker = makeBroker()
    broker.upsert({ nodeId: 'n1', label: 'local', endpoint: origin, local: true, token: 't' })

    const pending = broker.fetch('n1', { requestId: 'r-abort', path: '/slow', timeoutMs: 5_000 })
    broker.abort('r-abort')
    await expect(pending).rejects.toThrow()
  })

  it('rejects a request for an unknown node', async () => {
    await expect(makeBroker().fetch('nope', { requestId: 'r1', path: '/x' })).rejects.toThrow(/Unknown node/)
  })

  it('marks a node revoked on a 401 so it stops being retried', async () => {
    const { origin } = await listen(false)
    respond = () => ({ status: 401, body: '{}' })
    const broker = makeBroker()
    broker.upsert({ nodeId: 'n1', label: 'local', endpoint: origin, local: true, token: 'stale' })

    await broker.fetch('n1', { requestId: 'r1', path: '/x' })
    await waitFor(() => statuses.some((s) => s.state === 'revoked'), 'the revoked transition')
    expect(statuses.at(-1)).toMatchObject({ state: 'revoked', error: { code: 'unauthorized' } })
  })

  it('never exposes the token in the fleet projection', async () => {
    const { origin } = await listen(false)
    const broker = makeBroker()
    broker.upsert({ nodeId: 'n1', label: 'local', endpoint: origin, local: true, token: 'acorn_dt_secret' })
    expect(JSON.stringify(broker.list())).not.toContain('acorn_dt_secret')
  })
})

describe('broker TLS pinning', () => {
  it('connects when the presented certificate matches the pin', async () => {
    const { origin } = await listen(true)
    const broker = makeBroker()
    broker.upsert({ nodeId: 'n1', label: 'local', endpoint: origin, local: true, token: 't', fingerprint, certPem })

    const res = await broker.fetch('n1', { requestId: 'r1', path: '/v2/node' })
    expect(res.status).toBe(200)
  })

  // The security assertion of the whole phase: a changed identity must fail closed. If pinning were
  // implemented with rejectUnauthorized:false, checkServerIdentity would never be consulted and this
  // request would succeed.
  it('refuses a certificate that does not match the pin, and reports identity_mismatch', async () => {
    const { origin } = await listen(true)
    const broker = makeBroker()
    const wrong = fingerprint.replace(/^../, fingerprint.startsWith('AA') ? 'BB' : 'AA')
    broker.upsert({ nodeId: 'n1', label: 'local', endpoint: origin, local: true, token: 't', fingerprint: wrong, certPem })

    await expect(broker.fetch('n1', { requestId: 'r1', path: '/v2/node' })).rejects.toThrow()
    expect(statuses.at(-1)).toMatchObject({ state: 'offline', error: { code: 'identity_mismatch' } })
  })

  it('refuses a certificate signed by an unrelated key even if the fingerprint is claimed', async () => {
    const { origin } = await listen(true)
    const other = mkdtempSync(join(tmpdir(), 'acorn-broker-other-'))
    try {
      execFileSync('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3',
        '-keyout', join(other, 'key.pem'), '-out', join(other, 'cert.pem'),
        '-subj', '/CN=impostor', '-addext', 'subjectAltName=IP:127.0.0.1',
      ])
      const broker = makeBroker()
      // Pinning the impostor's CA against the real server: the chain cannot validate.
      broker.upsert({
        nodeId: 'n1',
        label: 'local',
        endpoint: origin,
        local: true,
        token: 't',
        fingerprint,
        certPem: readFileSync(join(other, 'cert.pem'), 'utf8'),
      })
      await expect(broker.fetch('n1', { requestId: 'r1', path: '/v2/node' })).rejects.toThrow()
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })
})

describe('broker WebSocket', () => {
  it('authenticates the upgrade with the bearer and forwards frames verbatim', async () => {
    const { origin, server } = await listen(false)
    const upgrades: string[] = []
    const wss = new WebSocketServer({ server, path: '/ws' })
    wss.on('connection', (socket, req) => {
      upgrades.push(String(req.headers.authorization))
      socket.send(JSON.stringify({ channel: 'term:status', seq: 1 }))
    })

    const frames: unknown[] = []
    const broker = new NodeBroker({ frame: (_n, f) => frames.push(f), status: (s) => statuses.push(s) })
    brokers.push(broker)
    broker.upsert({ nodeId: 'n1', label: 'local', endpoint: origin, local: true, token: 'acorn_dt_ws' })

    await waitFor(() => frames.length > 0, 'a frame over the socket')
    expect(upgrades).toEqual(['Bearer acorn_dt_ws'])
    expect(frames[0]).toEqual({ channel: 'term:status', seq: 1 })
    await waitFor(() => statuses.some((s) => s.state === 'online'), 'the online transition')
  })

  it('queues frames sent before the socket opens and flushes them on open', async () => {
    const { origin, server } = await listen(false)
    const inbound: string[] = []
    const wss = new WebSocketServer({ server, path: '/ws' })
    wss.on('connection', (socket) => socket.on('message', (d) => inbound.push(d.toString())))

    const broker = makeBroker()
    broker.upsert({ nodeId: 'n1', label: 'local', endpoint: origin, local: true, token: 't' })
    broker.send('n1', { channel: 'term:attach', id: 's1' }) // before open

    await waitFor(() => inbound.length > 0, 'the queued frame to flush')
    expect(JSON.parse(inbound[0])).toEqual({ channel: 'term:attach', id: 's1' })
  })

  // docs/vNext/protocol.md § Events: a seq gap means loss, and the remedy is to reconnect, because
  // there is no cursor into history to replay from.
  it('treats a seq gap as loss and reconnects', async () => {
    const { origin, server } = await listen(false)
    let connections = 0
    const wss = new WebSocketServer({ server, path: '/ws' })
    wss.on('connection', (socket) => {
      connections += 1
      if (connections === 1) {
        socket.send(JSON.stringify({ channel: 'term:status', seq: 1 }))
        socket.send(JSON.stringify({ channel: 'term:status', seq: 5 })) // gap
      }
    })

    const frames: unknown[] = []
    const broker = new NodeBroker({ frame: (_n, f) => frames.push(f), status: () => {} })
    brokers.push(broker)
    broker.upsert({ nodeId: 'n1', label: 'local', endpoint: origin, local: true, token: 't' })

    await waitFor(() => connections >= 2, 'a reconnect after the gap', 8_000)
    // The gapped frame is dropped rather than delivered out of order.
    expect(frames).toEqual([{ channel: 'term:status', seq: 1 }])
  })

  it('stops reconnecting when the upgrade is refused as unauthorized', async () => {
    const { origin, server } = await listen(false)
    let attempts = 0
    server.on('upgrade', (_req, socket) => {
      attempts += 1
      socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n')
    })

    const broker = makeBroker()
    broker.upsert({ nodeId: 'n1', label: 'local', endpoint: origin, local: true, token: 'revoked' })

    await waitFor(() => statuses.some((s) => s.state === 'revoked'), 'the revoked transition')
    const seen = attempts
    await new Promise((r) => setTimeout(r, 300))
    expect(attempts).toBe(seen) // no further retries
  })
})
