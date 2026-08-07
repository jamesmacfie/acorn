import { mkdtempSync, rmSync } from 'node:fs'
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import { createConnection, type AddressInfo, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocketServer } from 'ws'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ensureCert } from '@acorn/node-core/main/tls.ts'
import { PreviewTunnels } from './previewTunnel'

// The credential on the tunnel's loopback hop — the risk Phase 4 accepted rather than closed
// (docs/vNext/phase4-notes.md § "Considered and NOT changed"). Until Phase 5 anything that could find
// the port got a byte pipe to another machine's dev server, using the owner's device token.
//
// Driven against a REAL node end: a TLS server with the node's own `ensureCert` certificate and a
// WebSocketServer on /v2/tunnel. That matters for the negative cases especially — "refused" has to mean
// "no upgrade was ever attempted against the node", not merely "the local socket closed", and only a
// real listener on the other end can tell those apart.

let certDir: string
let certPem: string
let keyPem: string
let fingerprint: string

beforeAll(() => {
  certDir = mkdtempSync(join(tmpdir(), 'acorn-tunnel-cert-'))
  const cert = ensureCert(certDir)
  certPem = cert.certPem
  keyPem = cert.keyPem
  fingerprint = cert.fingerprint
})
afterAll(() => rmSync(certDir, { recursive: true, force: true }))

let server: HttpsServer
let wss: WebSocketServer
let endpoint: string
// Every upgrade the node end saw, and every byte that arrived over it.
let upgrades: string[]
let delivered: string[]
let tunnels: PreviewTunnels
const clients: Socket[] = []

beforeEach(async () => {
  upgrades = []
  delivered = []
  server = createHttpsServer({ key: keyPem, cert: certPem, minVersion: 'TLSv1.3' })
  wss = new WebSocketServer({ server, path: '/v2/tunnel' })
  wss.on('connection', (socket, req) => {
    upgrades.push(req.url ?? '')
    socket.on('message', (data: Buffer) => delivered.push(data.toString()))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  endpoint = `https://127.0.0.1:${(server.address() as AddressInfo).port}`
  tunnels = new PreviewTunnels(() => ({ endpoint, token: 'acorn_dt_test', certPem, fingerprint }))
})

afterEach(() => {
  for (const socket of clients.splice(0)) socket.destroy()
  tunnels.dispose()
  wss.close()
  server.close()
})

const TARGET = { nodeId: 'n1', taskId: 'task-1', port: 3000 }

// Connect to the local listener and send `head`. Resolves with whether the socket was still open a beat
// later — a refused connection is destroyed, an authorised one is piped.
async function speak(port: number, head: string): Promise<{ alive: boolean }> {
  const socket = createConnection({ port, host: '127.0.0.1' })
  clients.push(socket)
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
  let destroyed = false
  socket.once('close', () => {
    destroyed = true
  })
  if (head) socket.write(head)
  await new Promise((resolve) => setTimeout(resolve, 250))
  return { alive: !destroyed }
}

const request = (extra = ''): string => `GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nAccept: */*\r\n${extra}\r\n`

const secretHeader = (port: number): string => {
  const headers = tunnels.headersFor(`http://127.0.0.1:${port}/`)
  if (!headers) throw new Error('no headers for our own tunnel')
  const [name, value] = Object.entries(headers)[0]
  return `${name}: ${value}\r\n`
}

describe('the tunnel listener demands its secret', () => {
  it('pipes a connection that presents it, head bytes and all', async () => {
    const port = await tunnels.open(TARGET)
    const { alive } = await speak(port, request(secretHeader(port)))

    expect(alive).toBe(true)
    // The node end was dialled with the task and port in the query, exactly as the route expects.
    expect(upgrades).toHaveLength(1)
    expect(upgrades[0]).toContain('task=task-1')
    expect(upgrades[0]).toContain('port=3000')
    // The bytes consumed by the credential check are replayed, not swallowed: the request line is what
    // the dev server needs, and dropping it would leave a connection that never answers.
    expect(delivered.join('')).toContain('GET / HTTP/1.1')
  })

  it('destroys a connection with no secret at all, without dialling the node', async () => {
    const port = await tunnels.open(TARGET)
    const { alive } = await speak(port, request())

    expect(alive).toBe(false)
    expect(upgrades).toEqual([])
  })

  it('destroys a connection presenting the wrong secret', async () => {
    const port = await tunnels.open(TARGET)
    const { alive } = await speak(port, request('x-acorn-tunnel: not-the-secret\r\n'))

    expect(alive).toBe(false)
    expect(upgrades).toEqual([])
  })

  it("refuses another tunnel's secret", async () => {
    const first = await tunnels.open(TARGET)
    const second = await tunnels.open({ ...TARGET, taskId: 'task-2' })
    expect(second).not.toBe(first)

    // Per LISTENER, so a pane that legitimately holds one task's secret cannot reach another task's dev
    // server through the tunnel opened for it.
    const { alive } = await speak(second, request(secretHeader(first)))
    expect(alive).toBe(false)
    expect(upgrades).toEqual([])
  })

  it('destroys a connection that says nothing, so a silent peer cannot hold the socket', async () => {
    const port = await tunnels.open(TARGET)
    const socket = createConnection({ port, host: '127.0.0.1' })
    clients.push(socket)
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })
    // HEAD_TIMEOUT_MS is 2s; waiting for the real timer rather than faking it keeps the assertion about
    // the socket dying rather than about a timer having been scheduled.
    await new Promise((resolve) => socket.once('close', resolve))
    expect(upgrades).toEqual([])
  }, 10_000)
})

describe('headersFor', () => {
  it('answers only for a loopback URL on one of our own listener ports', async () => {
    const port = await tunnels.open(TARGET)

    expect(tunnels.headersFor(`http://127.0.0.1:${port}/anything`)).toMatchObject({ 'x-acorn-tunnel': expect.any(String) })
    // A different port on loopback is somebody else's server — very often the OWNER's own dev server,
    // which is the case that would leak the secret to a process we know nothing about.
    expect(tunnels.headersFor(`http://127.0.0.1:${port + 1}/`)).toBeNull()
    // `localhost` is deliberately not accepted: it can resolve to ::1 or, with a hosts entry, anywhere.
    // The pane is handed a 127.0.0.1 URL by tunnelUrl.ts, so matching the exact host costs nothing.
    expect(tunnels.headersFor(`http://localhost:${port}/`)).toBeNull()
    expect(tunnels.headersFor('https://example.com/')).toBeNull()
    expect(tunnels.headersFor('not a url')).toBeNull()
  })

  it('stops answering once the tunnel is closed', async () => {
    const port = await tunnels.open(TARGET)
    expect(tunnels.headersFor(`http://127.0.0.1:${port}/`)).not.toBeNull()
    tunnels.closeFor({ taskId: 'task-1' })
    expect(tunnels.headersFor(`http://127.0.0.1:${port}/`)).toBeNull()
  })
})
