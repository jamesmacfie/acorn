import { createServer, request, type IncomingMessage, type Server } from 'node:http'
import { connect, type AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import type { PreviewTransport } from './nodeBroker'
import { openPreviewListener, PREVIEW_POLICY, type PreviewListener } from './previewProxy'

// One preview's listener in front of a stand-in Node, both real sockets on this computer.

const ROUTE = '/v1/p/preview/tasks/t1/proxy'
const servers: Server[] = []
const listeners: PreviewListener[] = []
afterEach(async () => {
  for (const listener of listeners.splice(0)) await listener.close()
  for (const server of servers.splice(0)) (server.closeAllConnections(), server.close())
})

// What the Node saw of each request.
const seen: IncomingMessage[] = []

async function node(handler: (req: IncomingMessage, res: import('node:http').ServerResponse) => void) {
  seen.length = 0
  const server = createServer((req, res) => {
    seen.push(req)
    handler(req, res)
  })
  servers.push(server)
  const sockets = new WebSocketServer({ server })
  sockets.on('connection', (socket, req) => socket.send(`node saw ${req.url}`))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  let live = true
  const transport: PreviewTransport = {
    request: (path, { method, headers }) =>
      live
        ? request({ host: '127.0.0.1', port, path, method, headers: { ...headers, authorization: 'Bearer device' } })
        : null,
    close: () => {},
  }
  return { transport, forget: () => void (live = false) }
}

async function open(transport: PreviewTransport): Promise<PreviewListener> {
  const listener = await openPreviewListener(transport, ROUTE)
  listeners.push(listener)
  return listener
}

type Answer = { status: number; headers: IncomingMessage['headers']; text: string }
function get(url: string, headers: Record<string, string> = {}, path?: string): Promise<Answer> {
  const target = new URL(url)
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: target.hostname,
        port: target.port,
        path: path ?? `${target.pathname}${target.search}`,
        headers,
        agent: false,
      },
      (res) => {
        let text = ''
        res.on('data', (chunk) => (text += chunk))
        res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, text }))
      },
    )
    req.on('error', reject)
    req.end()
  })
}

// The cookie the entry sets, as a page in the webview would then send it.
async function signIn(listener: PreviewListener): Promise<string> {
  const entry = await get(listener.entry())
  return entry.headers['set-cookie']![0]!.split(';')[0]!
}

describe("a remote preview's listener", () => {
  it('sets a strict cookie on its entry and goes on to the start page', async () => {
    const { transport } = await node((_req, res) => res.end())
    const listener = await open(transport)
    const entry = await get(listener.entry('/app?x=1'))
    expect(entry.status).toBe(302)
    expect(entry.headers.location).toBe('/app?x=1')
    expect(entry.headers['set-cookie']![0]).toMatch(/^acorn-preview=[\w-]{43}; HttpOnly; SameSite=Strict; Path=\/$/)
    expect((await get(`${listener.origin}/__acorn/preview?key=wrong`)).status).toBe(403)
    // A start page that names another host goes to this preview's own start instead.
    expect((await get(listener.entry('//elsewhere.test/'))).headers.location).toBe('/')
    expect((await get(listener.entry('/\\elsewhere.test/'))).headers.location).toBe('/')
  })

  it('refuses a request without the cookie, or on any other Host', async () => {
    const { transport } = await node((_req, res) => res.end('app'))
    const listener = await open(transport)
    const cookie = await signIn(listener)
    expect((await get(`${listener.origin}/`)).status).toBe(403)
    expect((await get(`${listener.origin}/`, { cookie: 'acorn-preview=guess' })).status).toBe(403)
    const port = new URL(listener.origin).port
    for (const host of [`localhost:${port}`, `rebound.example:${port}`, '127.0.0.1'])
      expect((await get(`${listener.origin}/`, { cookie, host })).status).toBe(403)
    expect(seen).toHaveLength(0)
    expect((await get(`${listener.origin}/`, { cookie })).text).toBe('app')
  })

  it('forwards below the route, without its cookie or a credential, and adds its policy beside the app’s', async () => {
    const { transport } = await node((_req, res) => {
      res.setHeader('content-security-policy', "script-src 'self'")
      res.setHeader('set-cookie', ['session=1; Path=/', 'acorn-preview=stolen; Path=/'])
      res.end('ok')
    })
    const listener = await open(transport)
    const cookie = await signIn(listener)
    const answer = await get(`${listener.origin}/src/main.ts?t=1`, {
      cookie: `theme=dark; ${cookie}`,
      authorization: 'Basic page',
      'x-acorn-internal': 'page',
    })
    expect(answer.status).toBe(200)
    expect(seen[0]!.url).toBe(`${ROUTE}/src/main.ts?t=1`)
    expect(seen[0]!.headers.cookie).toBe('theme=dark')
    expect(seen[0]!.headers.authorization).toBe('Bearer device')
    expect(seen[0]!.headers['x-acorn-internal']).toBeUndefined()
    expect(answer.headers['content-security-policy']).toBe(`script-src 'self', ${PREVIEW_POLICY}`)
    expect(answer.headers['set-cookie']).toEqual(['session=1; Path=/'])
  })

  it('refuses a path that would leave the route once resolved', async () => {
    const { transport } = await node((_req, res) => res.end())
    const listener = await open(transport)
    const cookie = await signIn(listener)
    for (const path of ['/../../../core/devices', '/%2e%2e/%2e%2e/%2e%2e/core', 'http://elsewhere.test/', 'http://['])
      expect((await get(listener.origin, { cookie }, path)).status).toBe(400)
    expect(seen).toHaveLength(0)
  })

  it('streams an answer as the Node writes it', async () => {
    let finish!: () => void
    const { transport } = await node((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: first\n\n')
      finish = () => res.end('data: last\n\n')
    })
    const listener = await open(transport)
    const cookie = await signIn(listener)
    const first = await new Promise<string>((resolve) => {
      request({ host: '127.0.0.1', port: new URL(listener.origin).port, path: '/events', headers: { cookie } }, (res) =>
        res.once('data', (chunk) => resolve(String(chunk))),
      ).end()
    })
    expect(first).toBe('data: first\n\n')
    finish()
  })

  it('opens a live reload socket for its own page only, and closes it with the preview', async () => {
    const { transport } = await node((_req, res) => res.end())
    const listener = await open(transport)
    const cookie = await signIn(listener)
    const socket = (origin: string, headers: Record<string, string> = { cookie }) =>
      new WebSocket(`${listener.origin.replace('http', 'ws')}/@vite/hmr?token=1`, { origin, headers })
    const outcome = (ws: WebSocket) =>
      new Promise<string>((resolve) => {
        ws.once('message', (data) => resolve(String(data)))
        ws.once('unexpected-response', (_req, res) => resolve(`refused ${res.statusCode}`))
      })
    expect(await outcome(socket('http://elsewhere.test'))).toBe('refused 403')
    expect(await outcome(socket(listener.origin, {}))).toBe('refused 403')
    const live = socket(listener.origin)
    expect(await outcome(live)).toBe(`node saw ${ROUTE}/@vite/hmr?token=1`)
    const closed = new Promise((resolve) => live.once('close', resolve))
    await listener.close()
    listeners.length = 0
    await closed
  })

  it('says so once its Node has gone', async () => {
    const { transport, forget } = await node((_req, res) => res.end())
    const listener = await open(transport)
    const cookie = await signIn(listener)
    forget()
    expect((await get(`${listener.origin}/`, { cookie })).status).toBe(410)
  })

  it('answers nothing on its port once closed', async () => {
    const { transport } = await node((_req, res) => res.end())
    const listener = await open(transport)
    const port = Number(new URL(listener.origin).port)
    await listener.close()
    listeners.length = 0
    const refused = await new Promise<boolean>((resolve) => {
      const probe = connect(port, '127.0.0.1')
      probe.once('connect', () => (probe.destroy(), resolve(false)))
      probe.once('error', () => resolve(true))
    })
    expect(refused).toBe(true)
  })
})
