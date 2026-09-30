import { createServer, type IncomingMessage, type Server } from 'node:http'
import { createConnection } from 'node:net'
import { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import { afterEach, expect, it, vi } from 'vitest'
import type { DeviceService } from '../auth/deviceTokens'
import { _resetWsHub, attachWsHub, disposeWsHub, onWsBroadcast, registerWsChannelHandler, setStreamHandlers, wsBroadcast } from './wsHub'

const servers: Server[] = []
const peers: WebSocket[] = []
const devices = (over: Partial<DeviceService> = {}): DeviceService => ({
  authenticate: async () => ({ deviceId: 'd1' }), isActive: async () => true, onRevoked: () => () => {}, ...over,
}) as DeviceService

afterEach(async () => {
  for (const ws of peers.splice(0)) ws.terminate()
  for (const server of servers.splice(0)) {
    disposeWsHub(server)
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  _resetWsHub()
  vi.restoreAllMocks()
})

async function start(over: Partial<DeviceService> = {}, maxMessageBytes = 128, revocationCheckMs = 60_000) {
  const server = createServer()
  servers.push(server)
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const host = `127.0.0.1:${(server.address() as { port: number }).port}`
  attachWsHub(server, { devices: devices(over), allowedHosts: new Set([host]), internalToken: 'synthetic', maxMessageBytes, revocationCheckMs })
  const open = async () => {
    const ws = new WebSocket(`ws://${host}/v1/events`, { headers: { authorization: 'Bearer dummy' } })
    peers.push(ws)
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.on('error', reject) })
    return ws
  }
  return { server, host, open }
}
const closed = (ws: WebSocket) => new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)))

it('rejects oversize before owner dispatch with close code 1009', async () => {
  const seen = vi.fn()
  registerWsChannelHandler('docker', { onFrame: seen, onDisconnect: () => {} })
  const { open } = await start()
  const ws = await open()
  const ended = closed(ws)
  ws.send(JSON.stringify({ channel: 'docker:exec:in', data: 'x'.repeat(129) }))
  expect(await ended).toBe(1009)
  expect(seen).not.toHaveBeenCalled()
})

it('contains rejected authorization and a throwing upgrade, then accepts a valid peer', async () => {
  const authenticate = vi.fn().mockRejectedValueOnce(new Error('synthetic lookup failed')).mockResolvedValue({ deviceId: 'd1' })
  const { host, open } = await start({ authenticate })
  const denied = () => new Promise<number>((resolve, reject) => {
    const ws = new WebSocket(`ws://${host}/v1/events`, { headers: { authorization: 'Bearer dummy' } })
    peers.push(ws)
    ws.on('error', reject)
    ws.on('unexpected-response', (_req, res) => { res.resume(); resolve(res.statusCode!) })
  })
  expect(await denied()).toBe(403)
  const upgrade = vi.spyOn(WebSocketServer.prototype, 'handleUpgrade').mockImplementationOnce(() => { throw new Error('synthetic upgrade failure') })
  expect(await denied()).toBe(403)
  upgrade.mockRestore()
  const accepted = await open()
  expect(accepted.readyState).toBe(accepted.OPEN)
})

it('shares one lazy WebSocket server between concurrent first upgrades', async () => {
  const upgrade = vi.spyOn(WebSocketServer.prototype, 'handleUpgrade')
  const { open } = await start()
  await Promise.all([open(), open()])
  expect(upgrade).toHaveBeenCalledTimes(2)
  expect(upgrade.mock.contexts[0]).toBe(upgrade.mock.contexts[1])
})

it('contains throwing and rejecting handlers and still runs every disconnect owner', async () => {
  const detached = vi.fn(() => { throw new Error('native exited') })
  const cleaned = vi.fn()
  setStreamHandlers({ input: () => {}, attach: () => {}, detach: detached, streamTaskId: () => 't1' })
  registerWsChannelHandler('bad', { onFrame: async () => { throw new Error('owner failed') }, onDisconnect: async () => { throw new Error('cleanup failed') } })
  registerWsChannelHandler('good', { onFrame: (_frame, send) => send({ channel: 'good:reply' }), onDisconnect: cleaned })
  const { open } = await start()
  const first = await open()
  first.send(JSON.stringify({ channel: 'term:attach', id: 's1' }))
  const ended = closed(first)
  first.send(JSON.stringify({ channel: 'bad:frame' }))
  await ended
  await vi.waitFor(() => expect(cleaned).toHaveBeenCalledOnce())
  expect(detached).toHaveBeenCalledOnce()
  const next = await open()
  const reply = new Promise<string>((resolve) => next.once('message', (data) => resolve(String(data))))
  next.send(JSON.stringify({ channel: 'good:frame' }))
  expect(JSON.parse(await reply)).toMatchObject({ channel: 'good:reply' })
})

it('contains a rejecting terminal hook', async () => {
  setStreamHandlers({ input: async () => { throw new Error('native exited') }, attach: () => {}, detach: () => {}, streamTaskId: () => 't1' })
  const { open } = await start()
  const ws = await open()
  const ended = closed(ws)
  ws.send(JSON.stringify({ channel: 'term:input', id: 's1', data: 'hello' }))
  await ended
})

it('fails closed on a rejected device activity lookup', async () => {
  const { open } = await start({ isActive: async () => { throw new Error('database unavailable') } }, 128, 20)
  const ws = await open()
  await closed(ws)
})

it('contains rejected node-side subscriber promises without skipping later listeners', async () => {
  const got = vi.fn()
  const offBad = onWsBroadcast(async () => { throw new Error('subscriber failed') })
  const offGood = onWsBroadcast(got)
  try { wsBroadcast({ channel: 'test:changed' }); await Promise.resolve(); expect(got).toHaveBeenCalledOnce() }
  finally { offBad(); offGood() }
})

it('flushes a refusal and destroys the server socket without waiting for the peer FIN', async () => {
  const { server, host } = await start({ authenticate: async () => null })
  let ended!: () => void
  const serverClosed = new Promise<void>((resolve) => { ended = resolve })
  server.on('upgrade', (_req, socket) => socket.once('close', ended))
  const tcp = createConnection({ host: '127.0.0.1', port: Number(host.split(':')[1]), allowHalfOpen: true })
  tcp.on('error', () => {})
  let received = ''
  const peerEnded = new Promise<void>((resolve) => tcp.once('end', resolve))
  tcp.on('data', (bytes) => { received += String(bytes) })
  await new Promise<void>((resolve) => tcp.once('connect', resolve))
  tcp.write(`GET /v1/events HTTP/1.1\r\nHost: ${host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nAuthorization: Bearer dummy\r\n\r\n`)
  try { await Promise.all([serverClosed, peerEnded]); expect(received).toContain('403 Forbidden') } finally { tcp.destroy() }
})

class Peer extends Duplex {
  _read(): void {}
  _write(_chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void): void { done() }
}

it('owns peer errors during delayed authorization and discards a late completion after disposal', async () => {
  let complete!: (value: { deviceId: string } | null) => void
  const auth = new Promise<{ deviceId: string } | null>((resolve) => { complete = resolve })
  const server = createServer()
  servers.push(server)
  attachWsHub(server, { devices: devices({ authenticate: () => auth }), allowedHosts: new Set(['synthetic']), internalToken: 'dummy' })
  const socket = new Peer()
  server.emit('upgrade', { url: '/v1/events', headers: { host: 'synthetic', authorization: 'Bearer dummy' } } as IncomingMessage, socket, Buffer.alloc(0))
  expect(socket.listenerCount('error')).toBeGreaterThan(0)
  socket.emit('error', new Error('synthetic peer closed'))
  disposeWsHub(server)
  complete({ deviceId: 'd1' })
  await Promise.resolve()
  expect(socket.destroyed).toBe(true)
})
