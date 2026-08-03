import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocket } from 'ws'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DeviceService } from '../server/auth/deviceTokens'
import type { ServerMsg } from '@acorn/protocol/terminal.ts'
import { WS_PATH, type WsServerWireFrame } from '@acorn/protocol/ws.ts'
import { _resetWsHub, attachWsHub, disposeWsHub, registerWsChannelHandler, setStreamHandlers, wsBroadcast, type StreamSink } from './wsHub'

// Headless verification of the delicate transport bits the smoke suite (S4) can't cover in a unit:
// upgrade auth (device bearer / internal-token / host), per-connection seq,
// revocation (immediate and by sweep), deterministic replay-before-live ordering on attach, input
// routing, detach, and status broadcast. Drives a real `ws` client against a real http.Server with
// the hub attached — no Electron, no GUI.

const INTERNAL = 'internal-token-xyz'
const DEVICE_TOKEN = 'acorn_dt_stub'

let server: Server
let host: string
let origin: string
// Devices that authenticate, and whether each is still active. A stub rather than a real
// deviceService over SQLite: what is under test here is the hub's reaction to the DeviceService
// contract (authenticate / onRevoked / isActive), and deviceTokens.test.ts already proves the
// contract itself. It also keeps this load-sensitive file free of a per-case database.
let active: Map<string, boolean>
let revokedListeners: Array<(deviceId: string) => void>
let devices: DeviceService

const stubDevices = (): DeviceService => ({
  issue: () => Promise.reject(new Error('not used')),
  authenticate: async (bearer) => {
    if (bearer !== DEVICE_TOKEN) return null
    // The stub mirrors the real service's single-null contract: a revoked device authenticates as
    // nothing, so "refused at upgrade" is the same code path as "unknown token".
    return active.get('d1') ? { deviceId: 'd1' } : null
  },
  list: async () => [],
  revoke: async (id) => {
    active.set(id, false)
    for (const listener of revokedListeners) listener(id)
    return true
  },
  onRevoked: (listener) => {
    revokedListeners.push(listener)
    return () => {
      revokedListeners = revokedListeners.filter((l) => l !== listener)
    }
  },
  isActive: async (id) => active.get(id) === true,
})

const listen = (s: Server) => new Promise<void>((r) => s.listen(0, '127.0.0.1', r))

beforeEach(async () => {
  server = createServer()
  await listen(server)
  const port = (server.address() as AddressInfo).port
  host = `127.0.0.1:${port}`
  origin = `http://${host}`
  active = new Map([['d1', true]])
  revokedListeners = []
  devices = stubDevices()
  // 20ms sweep everywhere: the interval is injected rather than faked, so the sweep runs for real and
  // the assertion is about the socket closing, not about a timer having been scheduled.
  attachWsHub(server, { internalToken: INTERNAL, allowedHost: host, devices, revocationCheckMs: 20 })
})

afterEach(() => {
  // disposeWsHub, not just _resetWsHub: the hub owns a revocation-sweep interval and an onRevoked
  // subscription, and leaking either across cases would let one case's hub terminate another's socket.
  disposeWsHub(server)
  _resetWsHub()
  server.close()
})

// Open a ws with explicit upgrade headers; resolves on open, rejects on the 403 'unexpected-response'.
function open(headers: Record<string, string>): Promise<WebSocket> {
  const ws = new WebSocket(`ws://${host}${WS_PATH}`, { headers })
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve(ws))
    ws.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)))
    ws.on('error', reject)
  })
}

// The ordinary authenticated socket: a device bearer. It used to be a session cookie plus an exact
// Origin, back when the renderer's socket was a browser socket on the node's own origin.
const authHeaders = () => ({ host, authorization: `Bearer ${DEVICE_TOKEN}` })

const frames = (ws: WebSocket): WsServerWireFrame[] => {
  const out: WsServerWireFrame[] = []
  ws.on('message', (d) => out.push(JSON.parse(d.toString()) as WsServerWireFrame))
  return out
}
// Resolves once the socket has closed, so a revocation assertion waits for the real close rather than
// polling readyState.
const closed = (ws: WebSocket): Promise<void> => new Promise((r) => ws.on('close', () => r()))
// Wait for a server-side effect to arrive, rather than sleeping a fixed interval and hoping. A
// fixed 30ms sleep is what made this file the suite's most frequent load-sensitive failure: 30ms
// is plenty on an idle machine and not always enough with 6 packages testing concurrently. The
// timeout is generous because it only bounds a genuine hang, never the happy path.
const waitFor = async (predicate: () => boolean, label: string, timeoutMs = 5_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

describe('wsHub auth', () => {
  it('rejects a socket with no token at all', async () => {
    await expect(open({ host })).rejects.toThrow(/403/)
  })

  it('rejects a mismatched Host (DNS-rebinding guard)', async () => {
    await expect(open({ ...authHeaders(), host: 'evil.example.com' })).rejects.toThrow()
  })

  // docs/vNext/protocol.md § Events: the socket is token-authenticated at upgrade. No cookie and no
  // Origin — a broker socket from Electron main is not a browser socket, and there is no ambient
  // credential left for an Origin check to defend.
  it('accepts a device bearer, and does not care what Origin says', async () => {
    const ws = await open({ ...authHeaders(), origin: 'http://evil.example.com' })
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })

  it('rejects a session cookie, which is no longer a credential', async () => {
    await expect(open({ host, origin, cookie: 'session=anything-at-all' })).rejects.toThrow(/403/)
  })

  it('accepts the internal token', async () => {
    const ws = await open({ host, 'x-acorn-internal': INTERNAL })
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })

  it('rejects a wrong internal token', async () => {
    await expect(open({ host, 'x-acorn-internal': `${INTERNAL}-wrong` })).rejects.toThrow(/403/)
  })

  it('refuses a revoked bearer at the upgrade itself', async () => {
    await devices.revoke('d1')
    await expect(open({ host, authorization: `Bearer ${DEVICE_TOKEN}` })).rejects.toThrow(/403/)
  })

  // A presented-and-rejected credential is a rejection, not an invitation to try the next mechanism.
  it('does not fall back to the internal token when a bearer is present but bad', async () => {
    await expect(open({ host, authorization: 'Bearer acorn_dt_wrong', 'x-acorn-internal': INTERNAL })).rejects.toThrow(/403/)
  })
})

describe('wsHub seq and revocation', () => {
  it('stamps a per-connection seq from 1, and restarts at 1 on a fresh socket', async () => {
    const first = await open(authHeaders())
    const got = frames(first)
    wsBroadcast({ channel: 'term:status' })
    wsBroadcast({ channel: 'term:status' })
    await waitFor(() => got.length >= 2, 'two broadcasts')
    expect(got.map((f) => f.seq)).toEqual([1, 2])
    first.close()
    await closed(first)

    // seq is per-connection, not per-node: a reconnect starts over, which is why the broker compares
    // only within one socket's lifetime.
    const second = await open(authHeaders())
    const again = frames(second)
    wsBroadcast({ channel: 'term:status' })
    await waitFor(() => again.length >= 1, 'a broadcast on the new socket')
    expect(again[0].seq).toBe(1)
    second.close()
  })

  it('closes a live socket the moment its device is revoked', async () => {
    const ws = await open({ host, authorization: `Bearer ${DEVICE_TOKEN}` })
    const gone = closed(ws)
    // Fire only the revocation signal and leave isActive() true, so a close can ONLY have come from
    // the onRevoked listener. Revoking for real here would leave the 20ms sweep as an alternative
    // explanation, and the two paths are separately load-bearing.
    for (const listener of revokedListeners) listener('d1')
    await gone
    expect(ws.readyState).toBe(WebSocket.CLOSED)
  })

  // The backstop: a revoke this hub never heard about (another process, or a listener registered after
  // the fact) still closes the socket, because a long-lived stream holds no bearer to re-present.
  it('sweeps away a socket whose device was revoked out of band', async () => {
    const ws = await open({ host, authorization: `Bearer ${DEVICE_TOKEN}` })
    const gone = closed(ws)
    active.set('d1', false) // revoked without firing onRevoked
    await gone
    expect(ws.readyState).toBe(WebSocket.CLOSED)
  })

  // Revocation is per-device, so an internal-token socket (a child process this node spawned, with no
  // device row) must survive a device being revoked out from under a client.
  it('leaves an internal-token socket alone when a device is revoked', async () => {
    const ws = await open({ host, 'x-acorn-internal': INTERNAL })
    await devices.revoke('d1')
    const got = frames(ws)
    wsBroadcast({ channel: 'term:status' })
    await waitFor(() => got.length >= 1, 'the socket to still be receiving')
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })
})

describe('wsHub streaming', () => {
  it('delivers ready + initial screen BEFORE any live frame on attach, and routes input', async () => {
    const inputs: string[] = []
    let liveSink: StreamSink | null = null
    setStreamHandlers({
      input: (_id, data) => inputs.push(data),
      attach: (_id, sink) => {
        liveSink = sink
        sink({ type: 'ready', session: { id: 's1' } as never, replayed: true })
        sink({ type: 'output', data: 'SCREEN' })
      },
      detach: () => {},
    })
    const ws = await open(authHeaders())
    const got = frames(ws)
    ws.send(JSON.stringify({ channel: 'term:attach', id: 's1' }))
    // Load-bearing: LIVE must be pushed only after ready+SCREEN have been delivered, or the ordering
    // assertion below proves nothing.
    await waitFor(() => got.length >= 2, 'ready + initial screen')
    liveSink!({ type: 'output', data: 'LIVE' } satisfies ServerMsg)
    await waitFor(() => got.length >= 3, 'the live frame')
    const outs = got.filter((f) => f.channel === 'term:out') as Extract<WsServerWireFrame, { channel: 'term:out' }>[]
    expect(outs.map((f) => f.msg.type)).toEqual(['ready', 'output', 'output'])
    expect(outs[1].msg).toMatchObject({ data: 'SCREEN' })
    expect(outs[2].msg).toMatchObject({ data: 'LIVE' }) // live strictly after the screen restore

    ws.send(JSON.stringify({ channel: 'term:input', id: 's1', data: 'ls\n' }))
    await waitFor(() => inputs.length > 0, 'input to reach the stream handler')
    expect(inputs).toEqual(['ls\n'])
    ws.close()
  })

  it('routes prefixed frames to a registered channel handler and signals disconnect', async () => {
    const seen: string[] = []
    const disconnects: object[] = []
    registerWsChannelHandler('docker', {
      onFrame: (frame, send) => {
        seen.push(frame.channel)
        send({ channel: 'docker:log', id: 'c1', data: 'hi' })
      },
      onDisconnect: (conn) => disconnects.push(conn),
    })
    // Terminal handlers untouched: term frames still need setStreamHandlers, unknown prefixes are dropped.
    const ws = await open(authHeaders())
    const got = frames(ws)
    ws.send(JSON.stringify({ channel: 'docker:logs:attach', id: 'c1' }))
    ws.send(JSON.stringify({ channel: 'nobody:home' }))
    await waitFor(() => got.length > 0, 'the handler reply to reach the client')
    expect(seen).toEqual(['docker:logs:attach']) // 'nobody:home' has no handler and is dropped
    expect(got).toEqual([{ channel: 'docker:log', id: 'c1', data: 'hi', seq: 1 }])
    ws.close()
    await waitFor(() => disconnects.length === 1, 'the hub to signal disconnect')
  })

  it('detach removes the sink; status broadcast reaches the socket', async () => {
    let detached = false
    setStreamHandlers({ input: () => {}, attach: (_id, sink) => sink({ type: 'ready', session: { id: 's1' } as never, replayed: false }), detach: () => (detached = true) })
    const ws = await open(authHeaders())
    const got = frames(ws)
    ws.send(JSON.stringify({ channel: 'term:attach', id: 's1' }))
    await waitFor(() => got.length > 0, 'the attach reply')
    ws.send(JSON.stringify({ channel: 'term:detach', id: 's1' }))
    await waitFor(() => detached, 'detach to reach the stream handler')
    expect(detached).toBe(true)
    wsBroadcast({ channel: 'term:status' })
    await waitFor(() => got.some((f) => f.channel === 'term:status'), 'the status broadcast')
    ws.close()
  })
})
