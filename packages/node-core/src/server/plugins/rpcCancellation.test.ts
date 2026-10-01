import { getEventListeners } from 'node:events'
import { MessageChannel, Worker } from 'node:worker_threads'
import { setImmediate as immediate } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { PluginRpcEndpoint } from './pluginRpc'
import { invocationOwned } from './rpcOwnership'

const drain = async () => { await immediate(); await immediate() }
const empty = { functions: 0, scopes: 0, pending: 0, incoming: 0, localSignals: 0, remoteSignals: 0, bodyReads: 0 }

describe('Request cancellation across a real worker', () => {
  it('carries pre-abort and live abort through nested visitors, then releases their scopes and signals', async () => {
    const { port1, port2 } = new MessageChannel()
    const worker = new Worker(new URL('./__fixtures__/rpcWorker.ts', import.meta.url), { workerData: { port: port2 }, transferList: [port2] })
    const host = new PluginRpcEndpoint(port1, () => 'async')
    try {
      const plugin = host.decode(await new Promise((resolve, reject) => { port1.once('message', resolve); worker.once('error', reject) })) as { request(request: Request, context?: unknown): Promise<Response> }
      const aborted = new AbortController(); aborted.abort()
      expect(await (await plugin.request(new Request('https://fixture.invalid/pre', { signal: aborted.signal }))).json()).toMatchObject({ aborted: true, name: 'AbortError' })
      expect(await (await plugin.request(new Request('https://fixture.invalid/ok'))).json()).toEqual({ aborted: false })
      for (let i = 0; i < 20; i++) {
        let entered!: () => void
        const running = new Promise<void>((resolve) => { entered = resolve })
        const controller = new AbortController()
        const request = new Request('https://fixture.invalid/nested', { signal: controller.signal })
        const call = plugin.request(request, invocationOwned({ providers: { withConnections: async (_id: string, visit: () => Promise<unknown>) => { entered(); return visit() } } }))
        const rejected = expect(call).rejects.toMatchObject({ name: 'AbortError' })
        await running; controller.abort(); await rejected
        await expect.poll(() => host.referenceCounts().functions).toBe(0)
        expect(host.referenceCounts()).toMatchObject(empty)
        expect(getEventListeners(request.signal, 'abort')).toHaveLength(0)
      }
    } finally { host.close(new Error('done')); await worker.terminate() }
  })
})

describe('RPC encoding cancellation and retirement', () => {
  it('preserves byte view offsets, chunk order, and empty bodies, and rejects non-byte chunks', async () => {
    const { port1, port2 } = new MessageChannel(), host = new PluginRpcEndpoint(port1, () => 'async'), peer = new PluginRpcEndpoint(port2, () => 'async')
    try {
      const bytes = new Uint8Array([0, 1, 2, 0])
      const chunks = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes.subarray(1, 3)); controller.enqueue(Buffer.from([3])); controller.enqueue(new Uint8Array()); controller.close() } })
      const response = peer.decode(await host.encode(new Response(chunks))) as Response
      expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3])
      expect(await (peer.decode(await host.encode(new Response())) as Response).text()).toBe('')
      const invalid = new ReadableStream({ start(controller) { controller.enqueue(new ArrayBuffer(3)); controller.close() } })
      await expect(host.encode(new Response(invalid))).rejects.toThrow(/non-Uint8Array/)
      expect(host.referenceCounts()).toMatchObject(empty)
    } finally { host.close(new Error('done')); peer.close(new Error('done')) }
  })
  it('settles close during a held request body and cancels the body without publishing late references', async () => {
    const { port1, port2 } = new MessageChannel(), host = new PluginRpcEndpoint(port1, () => 'async'), peer = new PluginRpcEndpoint(port2, () => 'async')
    let cancelled = 0, latePosts = 0, retired = false
    const post = port1.postMessage.bind(port1)
    port1.postMessage = (message) => { if (retired) latePosts++; post(message) }
    try {
      const remote = host.decode(await peer.encode(async () => new Response('ok'))) as (...args: unknown[]) => Promise<Response>
      const request = new Request('https://fixture.invalid/body', { method: 'POST', body: new ReadableStream({ cancel() { cancelled++; return new Promise(() => {}) } }), duplex: 'half' } as RequestInit)
      const call = remote(invocationOwned({ work: async () => {} }), request)
      const rejected = expect(call).rejects.toThrow('retired')
      await expect.poll(() => host.referenceCounts().bodyReads).toBe(1)
      retired = true; host.close(new Error('retired'))
      await rejected; await drain()
      expect(cancelled).toBe(1)
      expect(latePosts).toBe(0)
      expect(host.referenceCounts()).toMatchObject({ ...empty, remoteFunctions: 0 })
      await expect(host.encode(() => {})).rejects.toThrow('retired')
    } finally { host.close(new Error('done')); peer.close(new Error('done')) }
  })

  it('settles close during a held response body and fences all response posts', async () => {
    const { port1, port2 } = new MessageChannel(), host = new PluginRpcEndpoint(port1, () => 'async'), peer = new PluginRpcEndpoint(port2, () => 'async')
    let cancelled = 0, latePosts = 0, retired = false
    const post = port2.postMessage.bind(port2)
    port2.postMessage = (message) => { if (retired) latePosts++; post(message) }
    try {
      const remote = host.decode(await peer.encode(async () => new Response(new ReadableStream({ cancel() { cancelled++ } })))) as () => Promise<Response>
      const call = remote(), rejected = expect(call).rejects.toThrow('retired')
      await expect.poll(() => peer.referenceCounts().bodyReads).toBe(1)
      retired = true; peer.close(new Error('retired')); host.close(new Error('retired'))
      await rejected; await drain()
      expect(cancelled).toBe(1); expect(latePosts).toBe(0)
      expect(host.referenceCounts()).toMatchObject(empty)
      expect(peer.referenceCounts()).toMatchObject(empty)
    } finally { host.close(new Error('done')); peer.close(new Error('done')) }
  })

  it('aborts held body encoding and does not wait for an uncooperative handler', async () => {
    const { port1, port2 } = new MessageChannel(), host = new PluginRpcEndpoint(port1, () => 'async'), peer = new PluginRpcEndpoint(port2, () => 'async')
    let cancelled = 0
    try {
      const remote = host.decode(await peer.encode(async () => new Promise(() => {}))) as (request: Request, context: unknown) => Promise<Response>
      const controller = new AbortController()
      const request = new Request('https://fixture.invalid/body', { method: 'POST', signal: controller.signal, body: new ReadableStream({ cancel() { cancelled++ } }), duplex: 'half' } as RequestInit)
      const call = remote(request, invocationOwned({ work: async () => {} })), rejected = expect(call).rejects.toMatchObject({ name: 'AbortError' })
      await expect.poll(() => host.referenceCounts().bodyReads).toBe(1)
      controller.abort(); await rejected; await drain()
      expect(cancelled).toBe(1)
      expect(host.referenceCounts()).toMatchObject(empty)
      const live = new AbortController(), ignored = remote(new Request('https://fixture.invalid/ignored', { signal: live.signal }), invocationOwned({ work: async () => {} }))
      const ignoredRejection = expect(ignored).rejects.toMatchObject({ name: 'AbortError' })
      await expect.poll(() => peer.referenceCounts().incoming).toBe(1)
      live.abort(); await ignoredRejection
      await expect.poll(() => peer.referenceCounts().incoming).toBe(0)
      expect(host.referenceCounts()).toMatchObject(empty)
      expect(peer.referenceCounts()).toMatchObject({ remoteSignals: 0, remoteFunctions: 0 })
    } finally { host.close(new Error('done')); peer.close(new Error('done')) }
  })

  it('retires repeated successful body readers and listeners while both endpoints remain open', async () => {
    const { port1, port2 } = new MessageChannel(), host = new PluginRpcEndpoint(port1, () => 'async'), peer = new PluginRpcEndpoint(port2, () => 'async')
    try {
      const remote = host.decode(await peer.encode(async (request: Request) => new Response(await request.arrayBuffer()))) as (request: Request) => Promise<Response>
      for (let i = 0; i < 500; i++) {
        const request = new Request('https://fixture.invalid/body', { method: 'POST', body: 'fixture' })
        expect(await (await remote(request)).text()).toBe('fixture')
        expect(getEventListeners(request.signal, 'abort')).toHaveLength(0)
      }
      await drain()
      expect(host.referenceCounts()).toMatchObject(empty)
      expect(peer.referenceCounts()).toMatchObject({ ...empty, functions: 1 })
    } finally { host.close(new Error('done')); peer.close(new Error('done')) }
  })
})
