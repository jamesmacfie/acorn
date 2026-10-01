import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, WebSocket } from 'ws'
import { afterEach, describe, expect, it } from 'vitest'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import { encodeIdFrame, WS_VIEWERS_HEADER, WS_MAX_VIEWERS, type WsClientFrame } from '@acorn/protocol/ws.ts'
import type { NodeStatus, NodeTransportError } from '@acorn/protocol/broker.ts'
import { NodeBroker } from './nodeBroker'

const A = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'
const NODE = 'cccccccc-cccc-4ccc-cccc-cccccccccccc'
const cleanup: (() => void)[] = []
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose() })
const waitFor = async (predicate: () => boolean) => {
  const end = Date.now() + 5000
  while (!predicate()) { if (Date.now() > end) throw new Error('Event fixture did not settle.'); await new Promise((resolve) => setTimeout(resolve, 5)) }
}

async function fixture(feature: number | 'unknown' | 'unreachable' | { advertisement: unknown } | undefined, viewerMultiplexing = true) {
  let probes = 0
  const server: Server = createServer((request, response) => {
    if (request.url !== '/v1/node') return response.end('{}')
    probes += 1
    expect(request.headers.authorization).toBeUndefined()
    if (feature === 'unreachable') return response.writeHead(503).end()
    response.end(JSON.stringify(feature === 'unknown' ? {} : { baseline: ACORN_BASELINE, protocolVersion: 1, fingerprint: 'test', ...(feature === undefined ? {} : { eventTransport: typeof feature === 'object' ? feature.advertisement : { viewers: feature } }) }))
  })
  const wss = new WebSocketServer({ server })
  const connections: { ws: WebSocket; headers: IncomingHttpHeaders; frames: WsClientFrame[] }[] = []
  wss.on('connection', (ws, request) => {
    expect(request.headers.authorization).toBe('Bearer device-fixture')
    const entry = { ws, headers: request.headers, frames: [] as WsClientFrame[] }
    connections.push(entry)
    ws.on('message', (raw) => entry.frames.push(JSON.parse(raw.toString())))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const statuses: NodeStatus[] = []
  const frames: { frame: unknown; viewerId?: string }[] = [], bytes: { frame: Uint8Array; viewerId?: string }[] = []
  const errors: { error: NodeTransportError; viewerId?: string }[] = []
  const broker = new NodeBroker({ status: (status) => statuses.push(status), frame: (_node, frame, viewerId) => frames.push({ frame, viewerId }), bytes: (_node, frame, viewerId) => bytes.push({ frame, viewerId }), transportError: (_node, error, viewerId) => errors.push({ error, viewerId }) }, { viewerMultiplexing })
  cleanup.push(() => { broker.dispose(); for (const conn of connections) conn.ws.terminate(); wss.close(); server.close() })
  broker.upsert({ nodeId: NODE, endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, token: 'device-fixture', label: 'test', local: true })
  const ready = () => waitFor(() => statuses.at(-1)?.state === 'online')
  return { broker, connections, statuses, frames, bytes, errors, probes: () => probes, ready }
}

const attach = (broker: NodeBroker, viewerId: string, cols = 80) => broker.send(NODE, { channel: 'term:attach', id: A, cols, rows: 24 }, { viewerId, intent: { key: A, state: 'attached' } })
const detach = (broker: NodeBroker, viewerId: string) => broker.send(NODE, { channel: 'term:detach', id: A }, { viewerId, intent: { key: A, state: 'detached' } })

describe('event viewer compatibility and reconnect', () => {
  it('keeps default callers raw unless the host opts in, even when the Node advertises viewers', async () => {
    const f = await fixture(1, false)
    await f.ready()
    f.broker.send(NODE, { channel: 'term:attach', id: A })
    await waitFor(() => f.connections[0].frames.length === 1)
    expect(f.connections[0].headers[WS_VIEWERS_HEADER]).toBeUndefined()
    expect(f.connections[0].frames).toEqual([{ channel: 'term:attach', id: A }])
    const payload = encodeIdFrame(A, new Uint8Array([0, 255, 23]))!
    f.connections[0].ws.send(payload)
    await waitFor(() => f.bytes.length === 1)
    expect([...f.bytes[0].frame]).toEqual([...payload]); expect(f.bytes[0].viewerId).toBeUndefined()
    expect(f.probes()).toBe(1)
  })

  it('wraps opted-in default sends and strips their stable default identity on incoming bytes and frames', async () => {
    const f = await fixture(1)
    await f.ready()
    f.broker.send(NODE, { channel: 'term:attach', id: A })
    await waitFor(() => f.connections[0].frames.length === 1)
    const outgoing = f.connections[0].frames[0]
    expect(f.connections[0].headers[WS_VIEWERS_HEADER]).toBe('1')
    expect(outgoing).toMatchObject({ channel: 'ws:viewer', frame: { channel: 'term:attach', id: A } })
    const id = outgoing.viewerId as string
    const payload = encodeIdFrame(A, new Uint8Array([0, 255]))!
    f.connections[0].ws.send(encodeIdFrame(id, payload)!)
    f.connections[0].ws.send(JSON.stringify({ channel: 'ws:viewer', viewerId: id, frame: { channel: 'term:out' }, seq: 1 }))
    await waitFor(() => f.bytes.length === 1 && f.frames.length === 1)
    expect(f.bytes[0].viewerId).toBeUndefined(); expect([...f.bytes[0].frame]).toEqual([...payload])
    expect(f.frames).toEqual([{ viewerId: undefined, frame: { channel: 'term:out' } }])
    f.broker.closeViewer(NODE)
    await waitFor(() => f.connections[0].frames.length === 2)
    expect(f.connections[0].frames[1]).toEqual({ channel: 'ws:viewer-close', viewerId: id })
  })

  it.each([undefined, 2, 'unknown', 'unreachable'] as const)('retains legacy single-viewer behavior and explicitly refuses a second viewer (%s)', async (feature) => {
    const f = await fixture(feature)
    await f.ready()
    attach(f.broker, A); attach(f.broker, B)
    await waitFor(() => f.connections[0].frames.length === 1 && f.errors.length === 1)
    expect(f.connections[0].headers[WS_VIEWERS_HEADER]).toBeUndefined()
    expect(f.connections[0].frames[0].channel).toBe('term:attach')
    expect(f.errors[0]).toMatchObject({ viewerId: B, error: { code: 'viewers_unsupported' } })
    expect(f.statuses.at(-1)?.state).toBe('online')
    const request = f.broker.fetch(NODE, { requestId: 'surviving-fetch', path: '/v1/read' })
    f.broker.closeViewer(NODE, A)
    expect((await request).status).toBe(200)
    await waitFor(() => f.connections.length === 2)
    await f.ready()
    attach(f.broker, B)
    await waitFor(() => f.connections[1].frames.length === 1)
    expect(f.connections[1].frames[0].channel).toBe('term:attach')
  })

  it.each(['detached', 'attached'] as const)('compacts 1000 initial-open cycles to the final %s state', async (final) => {
    const f = await fixture(1)
    for (let i = 0; i < 1000; i++) { attach(f.broker, A, i + 2); detach(f.broker, A) }
    if (final === 'attached') attach(f.broker, A, 192)
    await f.ready()
    // Ping is a physical round-trip barrier after the broker has flushed its outbox.
    await new Promise<void>((resolve) => { f.connections[0].ws.once('pong', resolve); f.connections[0].ws.ping() })
    expect(f.connections[0].frames).toEqual(final === 'attached' ? [{ channel: 'ws:viewer', viewerId: A, frame: { channel: 'term:attach', id: A, cols: 192, rows: 24 } }] : [])
  })

  it.each([null, 'unknown', { viewers: '1' }, { viewers: -1 }, { viewers: 1.5 }])('falls back to legacy for malformed optional feature without marking a valid Node incompatible (%j)', async (advertisement) => {
    const f = await fixture({ advertisement })
    await f.ready()
    expect(f.connections[0].headers[WS_VIEWERS_HEADER]).toBeUndefined()
    expect(f.statuses.some((status) => status.state === 'incompatible')).toBe(false)
    f.broker.send(NODE, { channel: 'term:attach', id: A })
    await waitFor(() => f.connections[0].frames.length === 1)
    expect(f.connections[0].frames).toEqual([{ channel: 'term:attach', id: A }])
  })

  it('restores live desired state at the final size and checks sequence across viewers before routing', async () => {
    const f = await fixture(1)
    await f.ready(); attach(f.broker, A)
    await waitFor(() => f.connections[0].frames.length === 1)
    f.connections[0].ws.terminate()
    await waitFor(() => f.statuses.at(-1)?.state === 'offline')
    for (let i = 0; i < 1000; i++) { attach(f.broker, A, i + 2); detach(f.broker, A) }
    attach(f.broker, A, 196)
    await waitFor(() => f.connections.length === 2)
    await f.ready(); await waitFor(() => f.connections[1].frames.length === 1)
    expect(f.connections[1].frames[0]).toMatchObject({ viewerId: A, frame: { cols: 196 } })
    f.connections[1].ws.send(JSON.stringify({ channel: 'ws:viewer', viewerId: A, frame: { channel: 'probe:a' }, seq: 1 }))
    f.connections[1].ws.send(JSON.stringify({ channel: 'ws:viewer', viewerId: B, frame: { channel: 'probe:b' }, seq: 2 }))
    f.connections[1].ws.send(JSON.stringify({ channel: 'ws:viewer', viewerId: A, frame: { channel: 'probe:lost' }, seq: 4 }))
    await waitFor(() => f.frames.length === 2 && f.statuses.at(-1)?.state === 'offline')
    expect(f.frames.map((frame) => frame.viewerId)).toEqual([A, B])
    f.broker.closeViewer(NODE, A)
    await waitFor(() => f.connections.length === 3)
    await f.ready()
    await new Promise<void>((resolve) => { f.connections[2].ws.once('pong', resolve); f.connections[2].ws.ping() })
    expect(f.connections[2].frames).toEqual([])
  })

  it('counts the default owner toward the explicit cap and releases its slot', async () => {
    const f = await fixture(1)
    await f.ready()
    f.broker.send(NODE, { channel: 'probe:default' })
    for (let i = 0; i < WS_MAX_VIEWERS; i++) f.broker.send(NODE, { channel: 'probe:action' }, { viewerId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` })
    expect(f.errors).toHaveLength(1)
    expect(f.errors[0].error.code).toBe('viewer_limit')
    f.broker.closeViewer(NODE)
    f.broker.send(NODE, { channel: 'probe:action' }, { viewerId: f.errors[0].viewerId })
    await waitFor(() => f.connections[0].frames.length === WS_MAX_VIEWERS + 2)
    expect(f.errors).toHaveLength(1)
  })

  it('targets a legacy lease, refuses the sibling before output, and permits handoff after release', async () => {
    const f = await fixture(undefined)
    await f.ready()
    expect(f.broker.openViewer(NODE, A)).toBe(true)
    expect(f.broker.openViewer(NODE, B)).toBe(false)
    f.connections[0].ws.send(JSON.stringify({ channel: 'term:out', id: A, msg: { type: 'ready' }, seq: 1 }))
    f.connections[0].ws.send(encodeIdFrame(A, new Uint8Array([1, 2]))!)
    await waitFor(() => f.frames.length === 1 && f.bytes.length === 1)
    expect(f.frames[0].viewerId).toBe(A); expect(f.bytes[0].viewerId).toBe(A)
    expect(f.errors[0].viewerId).toBe(B)
    f.broker.closeViewer(NODE, A)
    expect(f.broker.send(NODE, { channel: 'plugin:cleanup' }, { viewerId: A, cleanup: true })).toBe(false)
    await waitFor(() => f.connections.length === 2); await f.ready()
    expect(f.broker.openViewer(NODE, B)).toBe(true)
    await waitFor(() => f.connections[1].frames.length === 1)
    expect(f.connections[1].frames[0]).toEqual({ channel: 'ws:viewer-open' })
    expect(f.errors).toHaveLength(1)
  })
})
