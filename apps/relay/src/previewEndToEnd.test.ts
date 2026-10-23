import { createServer, type IncomingMessage, type Server } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { LookupFunction } from 'node:net'
import { createConnection, createServer as createTcpServer, type AddressInfo, type Socket } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import { startAccountStub, startFakeAcme, type AccountStub, type FakeAcme } from '@acorn/node-core/testkit'
import { previewNodeLabel } from '@acorn/protocol/relay.ts'
import { accountAuth } from './auth'
import { startRelay, type Relay } from './relay'
import { nodeHarness, waitFor, type RunningNode } from './testkit/nodes'

// A task's app in a browser, through a real Node, a relay, and an account service (docs/relay/phone-channel.md
// § Previews). The browser is a TLS client that trusts only the certificate authority the Node asked, so the
// Node's wildcard certificate is checked as a browser would. A recording proxy sits where the network is.

let account: AccountStub
let acme: FakeAcme
let relay: Relay
let wire: { port: number; recorded: Buffer[] }
let dev: { server: Server; port: number; seen: IncomingMessage[]; hmrOrigins: (string | undefined)[] }
let home: RunningNode
const { startNode, request, ask, signIn, stopAll } = nodeHarness(() => account)
const cleanup: (() => unknown)[] = []

const OPEN = '/v1/p/preview/tasks/t1/proxy/__acorn/open'
const DEV_PAGE = 'hello from the dev server, secret-page-marker'

// A TCP proxy in front of the relay's preview port that keeps every byte, both ways.
async function recordingProxy(target: number) {
  const recorded: Buffer[] = []
  const sockets = new Set<Socket>()
  const server = createTcpServer((inbound) => {
    const outbound = createConnection(target, '127.0.0.1')
    for (const socket of [inbound, outbound]) {
      sockets.add(socket)
      socket.on('data', (chunk: Buffer) => recorded.push(chunk))
      socket.on('error', () => {})
      socket.on('close', () => {
        sockets.delete(socket)
        inbound.destroy()
        outbound.destroy()
      })
    }
    inbound.pipe(outbound).pipe(inbound)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => {
    for (const socket of sockets) socket.destroy()
    server.close()
  })
  return { port: (server.address() as AddressInfo).port, recorded }
}

async function startDevServer() {
  const seen: IncomingMessage[] = []
  const hmrOrigins: (string | undefined)[] = []
  const server = createServer((req, res) => {
    seen.push(req)
    if (req.url === '/redirect') return void res.writeHead(302, { location: `http://localhost:${port}/landed` }).end()
    res.writeHead(200, { 'content-type': 'text/html', 'x-frame-options': 'DENY' })
    res.end(`<html>${DEV_PAGE}</html>`)
  })
  const sockets = new WebSocketServer({ server })
  sockets.on('connection', (ws, req) => {
    hmrOrigins.push(req.headers.origin)
    ws.on('message', (data) => ws.send(`reloaded ${data}`))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  cleanup.push(() => server.close())
  return { server, port, seen, hmrOrigins }
}

// The address the browser would load, on the host and port the relay listens on. The name doesn't resolve,
// so the connection goes to the recording proxy and the name rides in the SNI and the Host header.
function target(address: string) {
  const url = new URL(address)
  return {
    url,
    options: {
      hostname: url.hostname,
      port: wire.port,
      path: `${url.pathname}${url.search}`,
      ca: acme.caPem,
      lookup: ((_host, lookup, done) =>
        lookup.all
          ? done(null, [{ address: '127.0.0.1', family: 4 }] as never)
          : done(null, '127.0.0.1', 4)) as LookupFunction,
      headers: { host: url.host } as Record<string, string>,
    },
  }
}

type Answer = { status: number; headers: IncomingMessage['headers']; text: string }
function browse(address: string, headers: Record<string, string> = {}): Promise<Answer> {
  const { options } = target(address)
  return new Promise((resolve, reject) => {
    const req = httpsRequest({ ...options, headers: { ...options.headers, ...headers }, agent: false }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () =>
        resolve({ status: res.statusCode!, headers: res.headers, text: Buffer.concat(chunks).toString() }),
      )
    })
    req.on('error', reject)
    req.end()
  })
}

async function openPreview(body: object = {}) {
  const opened = await request(home, 'POST', OPEN, body)
  return { status: opened.status, address: opened.json?.url as string, json: opened.json }
}

const cookieFrom = (answer: Answer): string => answer.headers['set-cookie']![0]!.split(';')[0]!

beforeAll(async () => {
  account = await startAccountStub()
  acme = await startFakeAcme({ lookupTxt: (name) => account.challenges().get(name) })
  relay = await startRelay({
    auth: await accountAuth({ url: account.url, revocationPollMs: 100 }),
    preview: { domain: 'preview.test', port: 0 },
  })
  account.setRelayUrl(`ws://127.0.0.1:${relay.port}`)
  account.setPreview({ domain: `preview.test:${relay.previewPort}`, acmeDirectory: acme.directoryUrl })
  wire = await recordingProxy(relay.previewPort!)
  dev = await startDevServer()
  home = await startNode()
  await signIn(home)
  expect((await ask(home, 'PUT', '/remote-access', { enabled: true })).status).toBe(200)
  await waitFor(async () => (await ask(home, 'GET', '/state')).json?.remoteAccess.connected === true, 'the relay')
  // The task's preview address, by the route a person's recipe pick uses. It needs no task behind it.
  const recipe = await request(home, 'POST', '/v1/p/preview/tasks/t1/recipe-url', {
    url: `http://localhost:${dev.port}`,
  })
  expect(recipe.status).toBe(200)
}, 180_000)

afterAll(async () => {
  await stopAll()
  for (const undo of cleanup.splice(0)) await undo()
  await relay.close()
  await acme.close()
  await account.close()
})

describe('a preview through the relay', () => {
  it('waits for the Node’s certificate, then hands a paired device an address', async () => {
    await waitFor(async () => (await openPreview()).status !== 503, 'the certificate')
    const { status, address } = await openPreview({ ancestor: 'https://app.example' })
    const label = await previewNodeLabel(home.handshake.nodeId)
    expect(status).toBe(200)
    expect(address).toMatch(
      new RegExp(`^https://[0-9a-f]{32}\\.${label}\\.preview\\.test:${relay.previewPort}/__acorn/preview\\?key=\\S+$`),
    )
    expect(acme.issued()).toBe(1)
  }, 60_000)

  it('trades the address for a cookie, then shows the app through a certificate a browser accepts', async () => {
    const { address } = await openPreview({ ancestor: 'https://app.example' })
    const entry = await browse(address)
    expect(entry.status).toBe(302)
    expect(entry.headers.location).toBe('/')
    expect(entry.headers['set-cookie']![0]).toMatch(
      /^__Host-acorn-preview=.+; Path=\/; Secure; HttpOnly; SameSite=None; Partitioned/,
    )

    const page = await browse(new URL('/', address).href, { cookie: cookieFrom(entry), authorization: 'Bearer stolen' })
    expect(page.status).toBe(200)
    expect(page.text).toContain(DEV_PAGE)
    const policy = page.headers['content-security-policy'] as string
    expect(policy).toContain("connect-src 'self'")
    expect(policy).toContain('frame-ancestors https://app.example')
    expect(page.headers['x-frame-options']).toBeUndefined()
    const seen = dev.seen.at(-1)!
    expect(seen.headers.authorization).toBeUndefined()
    expect(seen.headers.cookie).toBeUndefined()
    expect(seen.headers.host).toBe(`localhost:${dev.port}`)
    // A redirect to the dev server's own address stays on the preview's name.
    const redirected = await browse(new URL('/redirect', address).href, { cookie: cookieFrom(entry) })
    expect([redirected.status, redirected.headers.location]).toEqual([302, '/landed'])
  })

  it('answers 403 to another browser, a spent address, and a name nobody opened', async () => {
    const { address } = await openPreview()
    const entry = await browse(address)
    expect((await browse(address)).status).toBe(403)
    const bare = await browse(new URL('/', address).href)
    expect(bare.status).toBe(403)
    expect(bare.text).toContain('acorn-preview:cookie-blocked')
    expect(bare.text).not.toContain(DEV_PAGE)
    const wrong = await browse(new URL('/', address).href, { cookie: '__Host-acorn-preview=guess' })
    expect(wrong.status).toBe(403)

    const stranger = new URL(address)
    stranger.hostname = stranger.hostname.replace(/^[0-9a-f]{32}/, '0'.repeat(32))
    const unknown = await browse(new URL('/', stranger).href, { cookie: cookieFrom(entry) })
    expect(unknown.status).toBe(403)
    expect(unknown.text).toBe('Forbidden')
  })

  it('carries a hot-reload socket for the page’s own origin, and for no one else', async () => {
    const { address } = await openPreview()
    const cookie = cookieFrom(await browse(address))
    const { url, options } = target(address)
    const connect = (headers: Record<string, string>) => {
      const ws = new WebSocket(`wss://${url.host}/hmr`, {
        ca: acme.caPem,
        lookup: options.lookup,
        port: wire.port,
        headers,
      } as never)
      ws.on('error', () => {})
      cleanup.push(() => ws.terminate())
      return ws
    }
    const ws = connect({ cookie, origin: `https://${url.host}` })
    const reply = new Promise<string>((resolve) => ws.once('message', (data) => resolve(String(data))))
    await new Promise((resolve) => ws.once('open', resolve))
    ws.send('now')
    expect(await reply).toBe('reloaded now')
    expect(dev.hmrOrigins.at(-1)).toBe(`http://localhost:${dev.port}`)

    for (const headers of [{ cookie, origin: 'https://evil.example' }, { origin: `https://${url.host}` }]) {
      const refused = connect(headers as Record<string, string>)
      expect(
        await new Promise((resolve) => refused.once('unexpected-response', (_req, res) => resolve(res.statusCode))),
      ).toBe(403)
    }
  })

  it('shows the relay nothing but TLS', async () => {
    const seen = Buffer.concat(wire.recorded).toString('latin1')
    expect(wire.recorded[0]![0]).toBe(0x16)
    for (const readable of [
      DEV_PAGE,
      'GET /',
      'HTTP/1.1',
      '/__acorn/preview',
      'set-cookie',
      'hello from',
      'acorn-preview',
    ]) {
      expect(seen.toLowerCase()).not.toContain(readable.toLowerCase())
    }
  })

  it('stops with Remote access: no address, and no names answered', async () => {
    expect((await ask(home, 'PUT', '/remote-access', { enabled: false })).status).toBe(200)
    const closed = await openPreview()
    expect(closed.status).toBe(503)
    expect(closed.json).toMatchObject({ error: { code: 'preview_unavailable', details: { reason: 'off' } } })
  })
})
