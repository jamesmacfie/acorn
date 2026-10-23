import { createServer, request, type IncomingMessage, type Server } from 'node:http'
import { type AddressInfo, type Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { getRequestListener } from '@hono/node-server'
import { WebSocket, WebSocketServer } from 'ws'
import { proxyHttp, proxyUpgrade, rewriteLocation, type LoopbackProxyOptions } from './loopbackProxy'

// The proxy against a dev server and a browser, both real sockets on this computer.

const servers: Server[] = []
const sockets = new Set<Socket>()
const PUBLIC_ORIGIN = 'https://abc.def.preview.test'

afterEach(() => {
  for (const socket of sockets) socket.destroy()
  for (const server of servers.splice(0)) server.close()
})

async function listen(server: Server): Promise<number> {
  servers.push(server)
  server.on('connection', (socket) => sockets.add(socket))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as AddressInfo).port
}

// What the dev server saw of each request.
const seen: IncomingMessage[] = []
const bodies: string[] = []

async function devServer(handler: Parameters<typeof createServer>[1] = (_req, res) => res.end('ok')): Promise<number> {
  seen.length = 0
  bodies.length = 0
  return listen(
    createServer((req, res) => {
      seen.push(req)
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => {
        bodies.push(Buffer.concat(chunks).toString())
        handler!(req, res)
      })
    }),
  )
}

// A front door standing where the preview server does: it hands every request and upgrade to the proxy.
async function front(options: Partial<LoopbackProxyOptions> & { port: number }): Promise<number> {
  const full: LoopbackProxyOptions = {
    publicOrigin: PUBLIC_ORIGIN,
    ownPort: 1,
    responseHeaders: { 'content-security-policy': "default-src 'self'" },
    ...options,
  }
  const server = createServer(getRequestListener((request) => proxyHttp(request, full)))
  server.on('upgrade', (req, socket, head) => void proxyUpgrade(req, socket, head, full))
  return listen(server)
}

function get(port: number, path: string, headers: Record<string, string> = {}, method = 'GET', body?: string) {
  return new Promise<{ status: number; headers: IncomingMessage['headers']; text: string }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers, agent: false }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () =>
        resolve({ status: res.statusCode!, headers: res.headers, text: Buffer.concat(chunks).toString() }),
      )
    })
    req.on('error', reject)
    req.end(body)
  })
}

describe('proxying HTTP to a loopback port', () => {
  it("shows the dev server its own host and origin, and none of the Node's credentials", async () => {
    const port = await devServer()
    const proxy = await front({ port, grantCookie: '__Host-acorn-preview' })
    await get(proxy, '/src/main.ts?t=1', {
      authorization: 'Bearer device-token',
      'x-acorn-internal': 'internal-token',
      'proxy-authorization': 'Basic xyz',
      origin: PUBLIC_ORIGIN,
      referer: `${PUBLIC_ORIGIN}/page`,
      cookie: '__Host-acorn-preview=secret; theme=dark',
    })
    const [request] = seen
    expect(request!.url).toBe('/src/main.ts?t=1')
    expect(request!.headers).toMatchObject({
      host: `localhost:${port}`,
      origin: `http://localhost:${port}`,
      referer: `http://localhost:${port}/page`,
      cookie: 'theme=dark',
    })
    expect(request!.headers).not.toHaveProperty('authorization')
    expect(request!.headers).not.toHaveProperty('x-acorn-internal')
    expect(request!.headers).not.toHaveProperty('proxy-authorization')
  })

  it("leaves another site's origin alone, so the dev server can refuse it", async () => {
    const port = await devServer()
    const proxy = await front({ port })
    await get(proxy, '/', { origin: 'https://evil.example' })
    expect(seen[0]!.headers.origin).toBe('https://evil.example')
  })

  it('streams a request body up and a response down', async () => {
    const port = await devServer((_req, res) => res.end('saved'))
    const proxy = await front({ port })
    const answer = await get(proxy, '/save', {}, 'POST', 'the body')
    expect(bodies[0]).toBe('the body')
    expect(answer.text).toBe('saved')
  })

  it('passes a server-sent event along as it is written', async () => {
    const port = await devServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: first\n\n')
      // Never ends: the test finishes by the first chunk arriving.
    })
    const proxy = await front({ port })
    const first = await new Promise<string>((resolve) => {
      const req = request({ host: '127.0.0.1', port: proxy, path: '/events', agent: false }, (res) =>
        res.once('data', (chunk) => resolve(String(chunk))),
      )
      req.end()
    })
    expect(first).toBe('data: first\n\n')
  })

  it('never follows a redirect, and turns one to the dev server into a path', async () => {
    const port = await devServer((req, res) => {
      const to = req.url === '/home' ? `http://localhost:${port}/next?x=1#top` : 'https://elsewhere.example/'
      res.writeHead(302, { location: to }).end()
    })
    const proxy = await front({ port })
    const own = await get(proxy, '/home')
    expect([own.status, own.headers.location]).toEqual([302, '/next?x=1#top'])
    const other = await get(proxy, '/away')
    expect([other.status, other.headers.location]).toEqual([302, 'https://elsewhere.example/'])
    expect(seen).toHaveLength(2)
  })

  it("adds the page's policy beside the app's own, and drops what would stop the frame", async () => {
    const port = await devServer((_req, res) => {
      res.setHeader('x-frame-options', 'DENY')
      res.setHeader('content-security-policy', "img-src 'self'")
      res.setHeader('set-cookie', ['a=1', 'b=2'])
      res.end()
    })
    const proxy = await front({ port })
    const { headers } = await get(proxy, '/')
    expect(headers).not.toHaveProperty('x-frame-options')
    expect(headers['content-security-policy']).toEqual("img-src 'self', default-src 'self'")
    expect(headers['set-cookie']).toEqual(['a=1', 'b=2'])
  })

  it("refuses this Node's own port, and says so when nothing is listening", async () => {
    const port = await devServer()
    const own = await front({ port, ownPort: port })
    expect((await get(own, '/')).status).toBe(403)
    expect(seen).toHaveLength(0)

    const closed = await listen(createServer())
    servers.pop()!.close()
    const proxy = await front({ port: closed })
    const answer = await get(proxy, '/')
    expect(answer.status).toBe(502)
    expect(answer.headers['content-security-policy']).toBe("default-src 'self'")
  })

  it("uses only the path of an address that names another host, so it can't aim the proxy", async () => {
    const port = await devServer()
    const proxy = await front({ port })
    await get(proxy, 'http://elsewhere.example/x?y=1')
    expect(seen.map((request) => [request.url, request.headers.host])).toEqual([['/x?y=1', `localhost:${port}`]])
  })
})

describe('proxying a WebSocket upgrade', () => {
  it('carries frames both ways, with the dev server seeing its own origin', async () => {
    const dev = createServer()
    const sockets = new WebSocketServer({ server: dev })
    const origins: (string | undefined)[] = []
    sockets.on('connection', (ws, req) => {
      origins.push(req.headers.origin)
      ws.on('message', (data) => ws.send(`echo ${data}`))
    })
    const port = await listen(dev)
    const proxy = await front({ port })

    const ws = new WebSocket(`ws://127.0.0.1:${proxy}/hmr`, { headers: { origin: PUBLIC_ORIGIN } })
    const reply = new Promise<string>((resolve) => ws.once('message', (data) => resolve(String(data))))
    await new Promise((resolve) => ws.once('open', resolve))
    ws.send('hello')
    expect(await reply).toBe('echo hello')
    expect(origins).toEqual([`http://localhost:${port}`])
    ws.close()
  })

  it("refuses this Node's own port", async () => {
    const port = await devServer()
    const proxy = await front({ port, ownPort: port })
    const ws = new WebSocket(`ws://127.0.0.1:${proxy}/`)
    const status = await new Promise((resolve) =>
      ws.once('unexpected-response', (_req, res) => resolve(res.statusCode)),
    )
    expect(status).toBe(403)
  })
})

describe('rewriteLocation', () => {
  it('rewrites only an address on the same dev server', () => {
    expect(rewriteLocation('http://127.0.0.1:5173/a', 5173)).toBe('/a')
    expect(rewriteLocation('http://[::1]:5173/a', 5173)).toBe('/a')
    expect(rewriteLocation('http://localhost:5174/a', 5173)).toBe('http://localhost:5174/a')
    expect(rewriteLocation('https://localhost:5173/a', 5173)).toBe('https://localhost:5173/a')
    expect(rewriteLocation('/relative', 5173)).toBe('/relative')
  })
})
