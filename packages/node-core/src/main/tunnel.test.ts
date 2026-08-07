import { createServer as createHttpServer, type Server } from 'node:http'
import { createServer as createTcpServer, type Server as TcpServer } from 'node:net'
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

const devices = {
  authenticate: async (token: string) => (token === DEVICE_TOKEN ? { deviceId: 'd1', userId: 'james' } : null),
  isActive: async () => true,
  onRevoked: () => () => {},
} as unknown as DeviceService

let http: Server
let echo: TcpServer
let httpPort = 0
let echoPort = 0
let allowedHost = ''
let declared: number[] = []

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
    declaredPorts: async () => declared,
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
