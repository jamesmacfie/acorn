import { createServer, Agent } from 'node:http'
import { createRequire } from 'node:module'
import { once } from 'node:events'
import { performance } from 'node:perf_hooks'
import { startHelperServer } from '../../apps/desktop/src/helper/helperServer.ts'
import { encodeBytes, decodeBytes } from '../../apps/desktop/src/shell/wire.ts'
import { NodeBroker } from '../../packages/custody/src/broker/nodeBroker.ts'
import { nodeRequest } from '../../packages/custody/src/broker/nodeRequest.ts'
import { attachWsHub, disposeWsHub, setStreamHandlers } from '../../packages/node-core/src/server/transport/wsHub.ts'
import { encodeIdFrame, decodeIdFrame } from '../../packages/protocol/src/ws.ts'

const require = createRequire(new URL('../../apps/desktop/package.json', import.meta.url))
const { WebSocket } = require('ws')
const { createAdaptorServer } = require('@hono/node-server')
const A = '00000000-0000-4000-8000-000000000001'
const B = '00000000-0000-4000-8000-000000000002'
const TERMINAL = '00000000-0000-4000-8000-000000000003'
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const waitFor = async (check: () => boolean, budgetMs = 3_000) => {
  const until = performance.now() + budgetMs
  while (!check()) {
    if (performance.now() > until) throw new Error('bounded wait expired')
    await delay(5)
  }
}
const stats = (values: number[]) => {
  const sorted = values.toSorted((a, b) => a - b)
  return { medianMs: sorted[Math.floor(sorted.length / 2)], maxMs: sorted.at(-1) }
}
const syntheticHelper = (broker: unknown) => ({ broker, fleet: { list: () => [] } }) as never
const openRenderer = async (server: Awaited<ReturnType<typeof startHelperServer>>) => {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/helper?secret=${server.secret}`)
  await once(ws, 'open')
  const messages: any[] = []
  ws.on('message', (data: any, binary: boolean) => messages.push(binary ? { binary: decodeIdFrame(data)?.id } : JSON.parse(String(data))))
  let id = 0
  const call = (method: string, params: unknown) => new Promise<any>((resolve) => {
    const wanted = ++id
    const receive = (data: any, binary: boolean) => {
      if (binary) return
      const response = JSON.parse(String(data))
      if (response.id !== wanted) return
      ws.off('message', receive)
      resolve(response)
    }
    ws.on('message', receive)
    ws.send(JSON.stringify({ id: wanted, method, params }))
  })
  return { ws, messages, call }
}

async function helperProbe() {
  let active = 0
  let aborts = 0
  let finish: (() => void) | undefined
  const broker = {
    statuses: () => [], send: () => {}, abort: () => { aborts += 1 },
    fetch: async (_id: string, request: { path: string }) => {
      if (request.path === '/slow') {
        active += 1
        await new Promise<void>((resolve) => { finish = resolve })
        active -= 1
      }
      return { status: 200, headers: {}, body: new Uint8Array() }
    },
  }
  const server = await startHelperServer(syntheticHelper(broker), { secret: 'synthetic-probe-only', appOrigin: 'http://acorn.localhost' })
  const renderer = await openRenderer(server)
  const pushPair = async () => {
    const from = renderer.messages.length
    for (const nodeId of [A, B]) {
      server.push({ push: 'node-frame', nodeId, frame: { channel: 'tasks:changed', taskId: null } })
      server.pushBytes(nodeId, encodeIdFrame(TERMINAL, new Uint8Array([65]))!)
      server.push({ push: 'node-status', status: { nodeId, state: 'online' } })
    }
    await renderer.call('fleet-list', {})
    return renderer.messages.slice(from).filter((m) => m.push || m.binary)
  }
  try {
    await renderer.call('node-send', { nodeId: A, frame: { channel: 'term:attach', id: TERMINAL } })
    const activeA = await pushPair()
    await Promise.all([A, B].map((nodeId) => renderer.call('node-fetch', { nodeId, request: { requestId: `fleet-${nodeId}`, path: '/v1/core/attachment' } })))
    const afterFleetRead = await pushPair()
    await renderer.call('node-fetch', { nodeId: A, request: { requestId: 'active-again', path: '/v1/core/tasks' } })
    const malformed = await renderer.call('node-fetch', { nodeId: B, request: { requestId: 'bad', path: 'invalid-path' } })
    const afterMalformed = await pushPair()
    await renderer.call('node-fetch', { nodeId: A, request: { requestId: 'active-again-2', path: '/v1/core/tasks' } })
    const other = await openRenderer(server)
    await other.call('node-fetch', { nodeId: B, request: { requestId: 'other-renderer', path: '/v1/core/tasks' } })
    const afterSecondRenderer = await pushPair()
    other.ws.close()
    await once(other.ws, 'close')
    const pending = renderer.call('node-fetch', { nodeId: A, request: { requestId: 'disconnect-probe', path: '/slow' } })
    await waitFor(() => active === 1)
    renderer.ws.close()
    await once(renderer.ws, 'close')
    await delay(30)
    const afterDisconnect = { active, aborts }
    finish?.()
    await delay(10)
    void pending
    return { activeA, afterFleetRead, malformedRejected: !malformed.ok, afterMalformed, afterSecondRenderer, afterDisconnect, afterManualCompletion: { active, aborts } }
  } finally {
    renderer.ws.terminate()
    await server.close()
  }
}

async function downstreamBackpressureProbe() {
  let nodePort = 0
  let helperPort = 0
  let hubMaxBuffered = 0
  let helperMaxBuffered = 0
  let pauses = 0
  let nodeSink: ((msg: any) => void) | undefined
  const originalSend = WebSocket.prototype.send
  WebSocket.prototype.send = function (...args: any[]) {
    const result = originalSend.apply(this, args)
    if (this._socket?.localPort === helperPort) helperMaxBuffered = Math.max(helperMaxBuffered, this.bufferedAmount)
    if (this._socket?.localPort === nodePort) hubMaxBuffered = Math.max(hubMaxBuffered, this.bufferedAmount)
    return result
  }
  const node = createServer((_req, response) => response.end(JSON.stringify({ baseline: 'acorn-1', protocolVersion: 1, fingerprint: 'synthetic' })))
  await new Promise<void>((resolve) => node.listen(0, '127.0.0.1', resolve))
  nodePort = (node.address() as any).port
  setStreamHandlers({
    input: () => {}, attach: (_id, sink) => { nodeSink = sink }, detach: () => {}, streamTaskId: () => null,
    flowControl: (_id, paused) => { if (paused) pauses += 1 },
  })
  attachWsHub(node, { internalToken: 'synthetic', allowedHosts: new Set([`127.0.0.1:${nodePort}`]), devices: { authenticate: async () => ({ deviceId: 'synthetic-device' }), onRevoked: () => () => {}, isActive: async () => true } as never })
  let helper: Awaited<ReturnType<typeof startHelperServer>> | undefined
  const broker = new NodeBroker({ frame: (nodeId, frame) => helper?.push({ push: 'node-frame', nodeId, frame }), bytes: (nodeId, frame) => helper?.pushBytes(nodeId, frame), status: () => {} })
  helper = await startHelperServer(syntheticHelper(broker), { secret: 'synthetic-probe-only', appOrigin: 'http://acorn.localhost' })
  helperPort = helper.port
  broker.upsert({ nodeId: A, label: 'synthetic', endpoint: `http://127.0.0.1:${nodePort}`, local: true, token: 'synthetic-device-token' })
  await waitFor(() => broker.statuses()[0]?.state === 'online')
  const renderer = await openRenderer(helper)
  let received = 0
  renderer.ws.on('message', (_data: unknown, binary: boolean) => { if (binary) received += 1 })
  try {
    await renderer.call('node-send', { nodeId: A, frame: { channel: 'term:attach', id: TERMINAL } })
    await waitFor(() => !!nodeSink)
    renderer.ws.pause()
    const chunk = 'x'.repeat(64 * 1024)
    const from = performance.now()
    for (let i = 0; i < 256; i += 1) {
      nodeSink!({ type: 'output', data: chunk })
      await delay(2)
    }
    await delay(50)
    const stalled = { payloadBytes: 256 * chunk.length, helperMaxBuffered, hubMaxBuffered, pauses, received, elapsedMs: performance.now() - from }
    renderer.ws.resume()
    try { await waitFor(() => received === 256, 10_000) }
    catch (error) { console.error(JSON.stringify({ stalled, received })); throw error }
    return { stalled, deliveredAfterResume: received }
  } finally {
    renderer.ws.resume()
    renderer.ws.terminate()
    broker.dispose()
    await helper.close()
    disposeWsHub(node)
    setStreamHandlers(null)
    node.closeAllConnections()
    await new Promise<void>((resolve) => node.close(() => resolve()))
    WebSocket.prototype.send = originalSend
  }
}

async function cancelProbe() {
  let routeAborted = false
  let closedAt = 0
  const server = createAdaptorServer({ fetch: (request: Request) => new Promise<Response>((resolve) => {
    request.signal.addEventListener('abort', () => { routeAborted = true; closedAt = performance.now(); resolve(new Response('cancelled')) }, { once: true })
  }) })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const agent = new Agent({ keepAlive: true })
  const controller = new AbortController()
  const request = nodeRequest({ url: new URL(`http://127.0.0.1:${server.address().port}/slow`), method: 'GET', headers: {}, agent, signal: controller.signal }).catch((error) => error.name)
  await delay(25)
  const abortedAt = performance.now()
  controller.abort()
  const errorName = await request
  await waitFor(() => routeAborted)
  agent.destroy()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return { errorName, routeAborted, propagationMs: closedAt - abortedAt }
}

async function bodyProbe() {
  const rows: unknown[] = []
  for (const bytes of [64 * 1024, 2 * 1024 * 1024, 8 * 1024 * 1024]) {
    const body = new Uint8Array(bytes).fill(65)
    const encode: number[] = [], decode: number[] = [], nativeEncode: number[] = []
    for (let i = 0; i < 7; i += 1) {
      let from = performance.now()
      const wire = encodeBytes(body)
      encode.push(performance.now() - from)
      from = performance.now()
      const result = decodeBytes(wire)
      decode.push(performance.now() - from)
      if (result.length !== bytes || result[bytes - 1] !== 65) throw new Error('wire mismatch')
      from = performance.now()
      const native = Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString('base64')
      nativeEncode.push(performance.now() - from)
      if (native !== wire) throw new Error('native mismatch')
    }
    rows.push({ bytes, wireChars: 4 * Math.ceil(bytes / 3), encode: stats(encode), decode: stats(decode), nativeEncode: stats(nativeEncode) })
  }
  const chunks = Array.from({ length: 128 }, () => Buffer.alloc(64 * 1024, 65))
  const copied: number[] = [], aliased: number[] = []
  for (let i = 0; i < 15; i += 1) {
    let from = performance.now()
    const copy = new Uint8Array(Buffer.concat(chunks))
    copied.push(performance.now() - from)
    from = performance.now()
    const alias = Buffer.concat(chunks)
    aliased.push(performance.now() - from)
    if (copy.length !== alias.length || alias[alias.length - 1] !== 65) throw new Error('copy mismatch')
  }
  return { rows, responseAssembly8MiB: { copied: stats(copied), oneBuffer: stats(aliased), removableAllocationBytes: 8 * 1024 * 1024 } }
}

const result = {
  environment: { node: process.version, platform: process.platform, arch: process.arch, commit: 'f8e4b59c', synthetic: true },
  helper: await helperProbe(),
  downstreamBackpressure: await downstreamBackpressureProbe(),
  upstreamCancellation: await cancelProbe(),
  bodies: await bodyProbe(),
}
console.log(JSON.stringify(result, null, 2))
