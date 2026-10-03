import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { Helper } from '@acorn/custody/runtime'
import type { NodeFetchRequest, NodeFetchResponse } from '@acorn/protocol/broker.ts'
import { encodeIdFrame, decodeIdFrame } from '@acorn/protocol/ws.ts'
import type { HelperReply } from '../shell/wire'
import { startHelperServer, type HelperServer } from './helperServer'

type Held = { request: NodeFetchRequest; resolve(value: NodeFetchResponse): void; reject(error: Error): void }
const servers: HelperServer[] = []
const sockets: WebSocket[] = []
afterEach(async () => { for (const socket of sockets.splice(0)) socket.terminate(); for (const server of servers.splice(0)) await server.close() })
const waitFor = async (predicate: () => boolean) => {
  const end = Date.now() + 5000
  while (!predicate()) { if (Date.now() > end) throw new Error('Fixture did not settle.'); await new Promise((resolve) => setTimeout(resolve, 5)) }
}

async function fixture(settleAbort = true) {
  const held = new Map<string, Held>()
  const aborted: string[] = []
  const retired: { nodeId: string; viewerId: string }[] = []
  const sent: { nodeId: string; options: { viewerId: string } }[] = []
  const helper = {
    broker: {
      fetch: (_nodeId: string, request: NodeFetchRequest) => new Promise<NodeFetchResponse>((resolve, reject) => {
        held.set(request.requestId, { request, resolve, reject })
      }).finally(() => held.delete(request.requestId)),
      abort: (id: string) => { aborted.push(id); if (settleAbort) held.get(id)?.reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })) },
      send: (nodeId: string, _frame: unknown, options: { viewerId: string }) => sent.push({ nodeId, options }),
      closeViewer: (nodeId: string, viewerId: string) => retired.push({ nodeId, viewerId }),
      openViewer: () => true,
      statuses: () => [],
    },
    fleet: { list: () => [] },
    config: { watch: () => () => {} },
  } as unknown as Helper
  const server = await startHelperServer(helper, { secret: 'r'.repeat(32), appOrigin: 'http://acorn.localhost' })
  servers.push(server)
  const open = async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/helper?secret=${server.secret}`)
    sockets.push(ws)
    const pushes: unknown[] = []
    const binary: Uint8Array[] = []
    const pending = new Map<number, (reply: HelperReply) => void>()
    ws.on('message', (data, isBinary) => {
      if (isBinary) { binary.push(data as Uint8Array); return }
      const message = JSON.parse(String(data))
      if ('push' in message) pushes.push(message)
      else { pending.get(message.id)?.(message); pending.delete(message.id) }
    })
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
    let id = 0
    const call = (method: string, params: unknown = {}) => new Promise<HelperReply>((resolve) => { pending.set(++id, resolve); ws.send(JSON.stringify({ id, method, params })) })
    return { ws, pushes, binary, call, settle: () => call('fleet-list') }
  }
  return { server, open, held, aborted, retired, sent }
}

const NODE_A = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const NODE_B = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'

describe('renderer socket ownership', () => {
  it('filters explicit interest per socket through fleet reads, cleanup sends, malformed calls, and cached switches', async () => {
    const f = await fixture()
    const a = await f.open(), b = await f.open()
    await a.call('node-interest', { nodeId: NODE_A }); await b.call('node-interest', { nodeId: NODE_B })
    const aggregate = a.call('node-fetch', { nodeId: NODE_B, request: { requestId: 'fleet', path: '/v1/tasks' } })
    await waitFor(() => f.held.size === 1)
    const response = [...f.held.values()][0]
    response.resolve({ status: 200, headers: {}, body: new Uint8Array() }); await aggregate
    await a.call('node-send', { nodeId: NODE_B, frame: { channel: 'term:detach', id: 'old' } })
    await a.call('node-fetch', { nodeId: NODE_B, request: { requestId: 'invalid', path: 'not-a-route' } })
    await a.call('node-send', { nodeId: NODE_B, frame: null })
    f.server.push({ push: 'node-frame', nodeId: NODE_A, frame: { channel: 'tasks:changed' } })
    f.server.push({ push: 'node-frame', nodeId: NODE_B, frame: { channel: 'tasks:changed' } })
    f.server.push({ push: 'node-status', status: { nodeId: NODE_B, state: 'online' } })
    const payload = encodeIdFrame('cccccccc-cccc-4ccc-cccc-cccccccccccc', new Uint8Array([0, 255, 7]))!
    f.server.pushBytes(NODE_A, payload); f.server.pushBytes(NODE_B, payload)
    await a.settle(); await b.settle()
    expect(a.pushes).toEqual([{ push: 'node-frame', nodeId: NODE_A, frame: { channel: 'tasks:changed' } }, { push: 'node-status', status: { nodeId: NODE_B, state: 'online' } }])
    expect(b.pushes).toEqual([{ push: 'node-frame', nodeId: NODE_B, frame: { channel: 'tasks:changed' } }, { push: 'node-status', status: { nodeId: NODE_B, state: 'online' } }])
    expect(decodeIdFrame(a.binary[0])?.id).toBe(NODE_A)
    expect([...decodeIdFrame(a.binary[0])!.payload]).toEqual([...payload])
    expect(decodeIdFrame(b.binary[0])?.id).toBe(NODE_B)
    await a.call('node-interest', { nodeId: NODE_B })
    f.server.push({ push: 'node-frame', nodeId: NODE_B, frame: { channel: 'cached:switch' } })
    await a.settle()
    expect(a.pushes.at(-1)).toEqual({ push: 'node-frame', nodeId: NODE_B, frame: { channel: 'cached:switch' } })
    expect(f.retired.map((r) => r.nodeId)).toEqual([NODE_A])
  })

  it('isolates equal request IDs and aborts only a disconnected renderer', async () => {
    const f = await fixture()
    const a = await f.open(), b = await f.open()
    // The transport namespace must not replace the HTTP correlation header.
    const request = { requestId: 'same', path: '/v1/slow', headers: { 'x-request-id': 'same', traceparent: 'test-trace' } }
    void a.call('node-fetch', { nodeId: NODE_A, request })
    const bReply = b.call('node-fetch', { nodeId: NODE_A, request })
    await waitFor(() => f.held.size === 2)
    const entries = [...f.held.entries()]
    expect(entries[0][0]).not.toBe(entries[1][0])
    expect(entries.map(([, held]) => held.request.headers)).toEqual([request.headers, request.headers])
    const closed = new Promise<void>((resolve) => a.ws.once('close', resolve))
    a.ws.close(); await closed; await waitFor(() => f.aborted.length === 1)
    expect(f.aborted).toEqual([entries[0][0]])
    entries[1][1].resolve({ status: 200, headers: {}, body: new Uint8Array([0, 255]) })
    expect(await bReply).toMatchObject({ ok: true, value: { status: 200, body: 'AP8=' } })
    await waitFor(() => f.held.size === 0)
  })

  it('keeps legacy wildcard interest but a modern fetch-only observer receives statuses without opening a lease', async () => {
    const f = await fixture()
    const legacy = await f.open(), observer = await f.open()
    await observer.call('node-interest', { nodeId: null })
    f.server.push({ push: 'node-frame', nodeId: NODE_A, frame: { channel: 'tasks:changed' } })
    f.server.pushBytes(NODE_A, encodeIdFrame(NODE_A, new Uint8Array([7]))!)
    f.server.push({ push: 'node-status', status: { nodeId: NODE_A, state: 'online' } })
    await observer.settle(); await legacy.settle()
    expect(legacy.pushes).toHaveLength(2)
    expect(legacy.binary).toHaveLength(1)
    expect(observer.pushes).toEqual([{ push: 'node-status', status: { nodeId: NODE_A, state: 'online' } }])
    expect(observer.binary).toEqual([])
    observer.ws.close(); await waitFor(() => observer.ws.readyState === WebSocket.CLOSED)
    expect(f.retired).toEqual([])
  })

  it('encodes only once for eligible recipients and does no payload work for inactive or missing viewers', async () => {
    const f = await fixture()
    const a = await f.open(), b = await f.open()
    await a.call('node-interest', { nodeId: NODE_A }); await b.call('node-interest', { nodeId: NODE_A })
    let serializations = 0
    const frame = { channel: 'tasks:changed', toJSON() { serializations++; return { channel: 'tasks:changed' } } }
    f.server.push({ push: 'node-frame', nodeId: NODE_B, frame })
    f.server.push({ push: 'node-frame', nodeId: NODE_A, frame }, 'no-such-viewer')
    let reads = 0
    const guarded = new Proxy(new Uint8Array([1]), { get() { reads++; throw new Error('inactive bytes were read') } })
    f.server.pushBytes(NODE_B, guarded)
    f.server.pushBytes(NODE_A, guarded, 'no-such-viewer')
    expect(serializations).toBe(0); expect(reads).toBe(0)
    f.server.push({ push: 'node-frame', nodeId: NODE_A, frame })
    f.server.pushBytes(NODE_A, new Uint8Array([1]))
    await a.settle(); await b.settle()
    expect(serializations).toBe(1)
    expect(a.pushes).toEqual(b.pushes)
    expect(a.binary).toEqual(b.binary)
  })

  it('targets transport refusals to the requesting renderer while retaining sibling status delivery', async () => {
    const f = await fixture()
    const a = await f.open(), b = await f.open()
    await a.call('node-interest', { nodeId: NODE_A }); await b.call('node-interest', { nodeId: NODE_A })
    await a.call('node-send', { nodeId: NODE_A, frame: { channel: 'probe:action' } })
    await b.call('node-send', { nodeId: NODE_A, frame: { channel: 'probe:action' } })
    const error = { code: 'viewers_unsupported', message: 'Upgrade this Node for another window.' } as const
    f.server.push({ push: 'node-transport-error', nodeId: NODE_A, error }, f.sent[1].options.viewerId)
    f.server.push({ push: 'node-status', status: { nodeId: NODE_A, state: 'online' } })
    await a.settle(); await b.settle()
    expect(a.pushes).toEqual([{ push: 'node-status', status: { nodeId: NODE_A, state: 'online' } }])
    expect(b.pushes).toEqual([{ push: 'node-transport-error', nodeId: NODE_A, error }, { push: 'node-status', status: { nodeId: NODE_A, state: 'online' } }])
  })

  it('does not access a late response body after close and clears completed request ownership', async () => {
    const f = await fixture(false)
    const a = await f.open()
    void a.call('node-fetch', { nodeId: NODE_A, request: { requestId: 'late', path: '/v1/slow' } })
    await waitFor(() => f.held.size === 1)
    const held = [...f.held.values()][0]
    let reads = 0
    a.ws.close()
    await waitFor(() => f.aborted.length === 1)
    held.resolve({ status: 200, headers: {}, get body() { reads += 1; return new Uint8Array(1024) } })
    await waitFor(() => f.held.size === 0)
    expect(reads).toBe(0)
    const b = await f.open()
    const success = b.call('node-fetch', { nodeId: NODE_A, request: { requestId: 'done', path: '/v1/read' } })
    await waitFor(() => f.held.size === 1)
    ;[...f.held.values()][0].resolve({ status: 200, headers: {}, body: new Uint8Array() }); await success
    const failures = b.call('node-fetch', { nodeId: NODE_A, request: { requestId: 'failed', path: '/v1/read' } })
    await waitFor(() => f.held.size === 1)
    ;[...f.held.values()][0].reject(new Error('request failed')); expect(await failures).toMatchObject({ ok: false })
    b.ws.close(); await waitFor(() => b.ws.readyState === WebSocket.CLOSED)
    expect(f.aborted).toHaveLength(1)
  })
})
