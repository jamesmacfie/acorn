import { createServer as createHttpServer, type Server } from 'node:http'
import { createConnection, createServer as createTcpServer, type Server as TcpServer } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { mintInternalToken } from '../server/auth/internalTokens'
import type { DeviceService } from '../server/auth/deviceTokens'
import { attachTunnel, disposeTunnel, TUNNEL_PATH } from './tunnel'
import { isUpgradeClaimed } from './upgradeClaim'

// The tunnel is the single most sensitive upgrade this server offers — a raw TCP pipe to a port on the
// node's host — so these are its four refusals plus the one thing it is for.

const INTERNAL_KEY = 'k'.repeat(64)
const DEVICE_TOKEN = 'acorn_dt_test'

// A revocable stub. The tunnel has to honour both halves of protocol.md § Pairing — the immediate
// `onRevoked` callback AND the periodic `isActive` sweep — so both are drivable here.
let active = new Set(['d1'])
let fireRevoked: ((deviceId: string) => void) | null = null
const devices = {
  authenticate: async (token: string) => (token === DEVICE_TOKEN ? { deviceId: 'd1', userId: 'james' } : null),
  isActive: async (id: string) => active.has(id),
  onRevoked: (listener: (deviceId: string) => void) => {
    fireRevoked = listener
    return () => { fireRevoked = null }
  },
} as unknown as DeviceService

let http: Server
let echo: TcpServer
let httpPort = 0
let echoPort = 0
let allowedHost = ''
let declared: number[] = []
// Milliseconds the port resolver stalls for, so a test can widen the window between claiming an upgrade and
// refusing it. Zero for every case but the RST one.
let slowPorts = 0

// A TCP echo server standing in for a dev server: whatever it receives, it sends back uppercased, which
// makes a successful round trip unambiguous rather than "no error was thrown".
const startEcho = (): Promise<number> =>
  new Promise((resolve) => {
    echo = createTcpServer((socket) => {
      socket.on('data', (chunk: Buffer) => socket.write(chunk.toString().toUpperCase()))
    })
    echo.listen(0, '127.0.0.1', () => resolve((echo.address() as { port: number }).port))
  })

beforeEach(async () => {
  active = new Set(['d1'])
  fireRevoked = null
  slowPorts = 0
  echoPort = await startEcho()
  declared = [echoPort]
  http = createHttpServer((_req, res) => res.end('ok'))
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()))
  httpPort = (http.address() as { port: number }).port
  allowedHost = `127.0.0.1:${httpPort}`
  attachTunnel(http, {
    internalToken: INTERNAL_KEY,
    allowedHost,
    devices,
    declaredPorts: async () => {
      if (slowPorts) await new Promise((resolve) => setTimeout(resolve, slowPorts))
      return declared
    },
    // Short, so the sweep case does not need fake timers (the same injection wsHub.test.ts uses).
    revocationCheckMs: 40,
  })
  // The sweeper main/server.ts registers last in production, reproduced here because the path-claim case
  // below depends on it: without it an unclaimed upgrade hangs its socket and `close()` never returns.
  http.on('upgrade', (_req, socket) => {
    if (!isUpgradeClaimed(socket)) socket.destroy()
  })
})

afterEach(async () => {
  disposeTunnel(http)
  // Reap every socket before close(). A refused upgrade leaves a half-closed connection, and an upgrade no
  // handler answered leaves an open one — `close()` waits for both forever otherwise, which shows up as a
  // ten-second hook timeout rather than as the test that caused it.
  http.closeAllConnections?.()
  await new Promise<void>((resolve) => http.close(() => resolve()))
  await new Promise<void>((resolve) => echo.close(() => resolve()))
})

// A port nothing is listening on, obtained by binding and releasing one — guessing an offset can collide
// with something real on the machine running the suite.
const freePort = async (): Promise<number> => {
  const probe = createTcpServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()))
  const port = (probe.address() as { port: number }).port
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

const url = (task: string, port: number) => `ws://${allowedHost}${TUNNEL_PATH}?task=${task}&port=${port}`

// Resolves to the echoed text, or rejects with the HTTP status the upgrade was refused with.
function open(target: string, headers: Record<string, string>, payload = 'ping', timeoutMs = 4_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target, { headers })
    ws.binaryType = 'nodebuffer'
    const timer = setTimeout(() => {
      ws.terminate()
      reject(new Error('timeout'))
    }, timeoutMs)
    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(timer)
      reject(new Error(`status ${res.statusCode}`))
    })
    ws.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    ws.on('open', () => ws.send(Buffer.from(payload)))
    ws.on('message', (data: Buffer) => {
      clearTimeout(timer)
      ws.close()
      resolve(data.toString())
    })
  })
}

// Opens a tunnel and KEEPS it open, resolving once the echo has come back so the pipe is known live.
// Returns a promise that settles when the socket closes, which is what revocation has to cause.
function hold(target: string, headers: Record<string, string>): Promise<{ closed: Promise<void>; ws: WebSocket }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target, { headers })
    ws.binaryType = 'nodebuffer'
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('timeout')) }, 4_000)
    let closed!: () => void
    const closedPromise = new Promise<void>((r) => (closed = r))
    ws.on('close', () => closed())
    ws.on('unexpected-response', (_req, res) => { clearTimeout(timer); reject(new Error(`status ${res.statusCode}`)) })
    ws.on('error', (error) => { clearTimeout(timer); reject(error) })
    ws.on('open', () => ws.send(Buffer.from('ping')))
    ws.once('message', () => { clearTimeout(timer); resolve({ closed: closedPromise, ws }) })
  })
}

describe('attachTunnel', () => {
  it('pipes bytes both ways to a declared port for a device caller', async () => {
    await expect(open(url('task-1', echoPort), { authorization: `Bearer ${DEVICE_TOKEN}` })).resolves.toBe('PING')
  })

  it('refuses an undeclared port', async () => {
    // protocol.md § Streams: "Only declared ports; no general SOCKS." Without this the pipe is a proxy to
    // anything listening on the node's loopback — every database, every other app's dev server.
    declared = [echoPort + 1]
    await expect(open(url('task-1', echoPort), { authorization: `Bearer ${DEVICE_TOKEN}` })).rejects.toThrow(/status 403/)
  })

  it('refuses an unauthenticated upgrade', async () => {
    await expect(open(url('task-1', echoPort), {})).rejects.toThrow(/status 403/)
    await expect(open(url('task-1', echoPort), { authorization: 'Bearer wrong' })).rejects.toThrow(/status 403/)
  })

  it('refuses a task-scoped credential aimed at another task', async () => {
    // The hole this closes: an agent holds ACORN_API_TOKEN and can reach the node's own listener, so
    // without the check it could open a pipe to any port ANY other task declares.
    const foreign = mintInternalToken(INTERNAL_KEY, { scope: 'task', taskId: 'task-2' })
    await expect(open(url('task-1', echoPort), { 'x-acorn-internal': foreign })).rejects.toThrow(/status 403/)
    // …and its own task still works, so the refusal is the scope check and not the credential kind.
    const own = mintInternalToken(INTERNAL_KEY, { scope: 'task', taskId: 'task-1' })
    await expect(open(url('task-1', echoPort), { 'x-acorn-internal': own })).resolves.toBe('PING')
  })

  it('refuses a foreign Host header', async () => {
    // The DNS-rebinding guard the HTTP surface has. Reached through authorizeWsUpgrade, which is why the
    // tunnel reuses it rather than writing its own door.
    await expect(
      open(`ws://127.0.0.1:${httpPort}${TUNNEL_PATH}?task=task-1&port=${echoPort}`, {
        authorization: `Bearer ${DEVICE_TOKEN}`,
        host: 'evil.test',
      }),
    ).rejects.toThrow(/status 403/)
  })

  it('answers 502 when nothing is listening on a declared port', async () => {
    // Distinguishable from 403 on purpose: "you may not ask for that" and "your dev server is not running"
    // are different problems, and the preview pane says different things about them.
    const dead = await freePort()
    declared = [dead]
    await expect(open(url('task-1', dead), { authorization: `Bearer ${DEVICE_TOKEN}` })).rejects.toThrow(/status 502/)
  })

  it('closes a LIVE pipe the moment its device is revoked', async () => {
    // protocol.md § Pairing: "deleting a device row invalidates its token immediately — open sockets are
    // closed, in-flight requests fail." wsHub has honoured this since Phase 1; the tunnel honoured neither
    // half, so a stolen laptop's established pipe kept reaching the dev server after the owner revoked it.
    // Refusing a NEW upgrade is the half that stops mattering once one is open.
    //
    // `isActive` is left TRUE and only the callback fires, so the periodic sweep cannot be the explanation —
    // the same non-vacuity trick wsHub.test.ts uses, and without it this case passed with the callback
    // deleted (measured).
    const held = await hold(url('task-1', echoPort), { authorization: `Bearer ${DEVICE_TOKEN}` })
    fireRevoked?.('d1')
    await expect(held.closed).resolves.toBeUndefined()
  })

  it('closes a live pipe on the periodic sweep, for a revoke it never heard about', async () => {
    // The backstop wsHub also has: another process revoked, or this listener was registered after the
    // revoke. Driven by flipping `isActive` WITHOUT firing onRevoked, so the callback cannot be the
    // explanation.
    const held = await hold(url('task-1', echoPort), { authorization: `Bearer ${DEVICE_TOKEN}` })
    active.delete('d1')
    await expect(held.closed).resolves.toBeUndefined()
  })

  it('survives a flood of half-open upgrades', async () => {
    // What this asserts, and what it does NOT.
    //
    // ASSERTS: a loop of connect-then-RST upgrades neither crashes the process nor wedges the tunnel — the
    // last line proves a legitimate tunnel still works afterwards.
    //
    // Does NOT assert the `refuse` guard. `refuse` now attaches an error listener and checks `writable`
    // before writing, because a `write` to a socket whose peer has gone emits `'error'` and the HTTP server
    // has already handed the socket over — with no listener that is an uncaughtException. I could NOT
    // reproduce it: removing the guard leaves this case green even with the resolver stalled 120ms and the
    // client destroying in the connect callback, so on this platform the write lands in the kernel buffer or
    // the emit is absorbed. The guard is precautionary and recorded as such in phase4-notes.md rather than
    // dressed up as a verified fix.
    // The window has to be WIDE, or the refusal is written before the peer's FIN is even processed and the
    // case passes with the guard removed (measured). A slow resolver is exactly what production has: the real
    // `declaredPorts` reads the tasks table, the repo_paths row and possibly a run target's `url_command`.
    slowPorts = 120
    const errors: unknown[] = []
    const onUncaught = (error: unknown) => errors.push(error)
    process.on('uncaughtException', onUncaught)
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        const raw = createConnection({ host: '127.0.0.1', port: httpPort }, () => {
          raw.write(
            `GET ${TUNNEL_PATH}?task=task-1&port=${echoPort} HTTP/1.1\r\n` +
            `Host: ${allowedHost}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n' +
            'Authorization: Bearer wrong\r\n\r\n',
          )
          raw.destroy()
        })
        raw.on('error', () => {})
      }
      await new Promise((resolve) => setTimeout(resolve, 600))
      expect(errors).toEqual([])
    } finally {
      process.off('uncaughtException', onUncaught)
      slowPorts = 0
    }
    // …and the tunnel still works afterwards, so the process did not merely survive by going deaf.
    await expect(open(url('task-1', echoPort), { authorization: `Bearer ${DEVICE_TOKEN}` })).resolves.toBe('PING')
  })

  it('claims only its own upgrade path', async () => {
    // The events hub attaches to the same listener, so a tunnel that answered EVERY upgrade would have
    // broken `/v2/events` the moment it was attached.
    //
    // Asserted by watching this request go unanswered, with NO second handler registered — the earlier
    // shape (register a rival handler and check it wins) could not distinguish anything: Node calls both
    // listeners, ours completes asynchronously after an await, so the synchronous rival always won the race
    // whether or not the path was checked. The query deliberately carries a valid task and port, so
    // `parseTarget` would accept it if the path comparison were the only thing stopping it.
    await expect(
      open(`ws://${allowedHost}/v2/events?task=task-1&port=${echoPort}`, { authorization: `Bearer ${DEVICE_TOKEN}` }, 'ping', 700),
    ).rejects.toThrow()
  })
})
