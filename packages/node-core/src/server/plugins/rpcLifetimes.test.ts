import { MessageChannel } from 'node:worker_threads'
import { setImmediate as immediate } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { PluginRpcEndpoint } from './pluginRpc'
import { invocationOwned } from './rpcOwnership'

const pair = (mode: (path: string) => 'sync' | 'async' = () => 'async') => {
  const { port1, port2 } = new MessageChannel()
  const host = new PluginRpcEndpoint(port1, mode), peer = new PluginRpcEndpoint(port2, () => 'async')
  return { host, peer, port1, close: () => { host.close(new Error('done')); peer.close(new Error('done')) } }
}
const drain = async () => { await immediate(); await immediate() }
const deferred = <T = void>() => {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('RPC invocation ownership', () => {
  it('retires request graphs and returned service methods after nested work and response encoding', async () => {
    const { host, peer, close } = pair()
    let captured!: { store(): Promise<{ read(): Promise<number> }> }
    const body = deferred()
    try {
      const route = host.decode(await peer.encode(async (ctx: typeof captured) => {
        captured = ctx
        const store = await ctx.store()
        expect(await store.read()).toBe(42)
        return new Response(new ReadableStream({ async start(controller) { await body.promise; controller.enqueue(new Uint8Array([42])); controller.close() } }))
      })) as (ctx: typeof captured) => Promise<Response>
      const result = route(invocationOwned({ store: async () => ({ read: async () => 42 }) }))
      await drain(); await drain()
      expect(host.referenceCounts().functions).toBe(2)
      body.resolve()
      expect([...(new Uint8Array(await (await result).arrayBuffer()))]).toEqual([42])
      await drain()
      expect(host.referenceCounts()).toMatchObject({ functions: 0, scopes: 0, pending: 0, localSignals: 0 })
      expect(peer.referenceCounts()).toMatchObject({ remoteFunctions: 0, incoming: 0, bodyReads: 0 })
      expect(() => captured.store()).toThrow(/invocation has ended/)
    } finally { body.resolve(); close() }
  })

  it('keeps one simultaneous visitor alive when another use of the same callback finishes', async () => {
    const { host, peer, close } = pair()
    const release = deferred(), entered = deferred()
    try {
      const ctx = peer.decode(await host.encode({ core: { secrets: { use: async (hold: boolean, visit: () => Promise<number>) => {
        if (hold) { entered.resolve(); await release.promise }
        return visit()
      } } } }, 'plugin.init.args[0]')) as { core: { secrets: { use(hold: boolean, visit: () => number): Promise<number> } } }
      const visitor = () => 42
      const first = ctx.core.secrets.use(true, visitor)
      await entered.promise
      expect(await ctx.core.secrets.use(false, visitor)).toBe(42)
      await drain()
      expect(peer.referenceCounts().functions).toBe(1)
      release.resolve()
      expect(await first).toBe(42)
      await drain()
      expect(peer.referenceCounts()).toMatchObject({ functions: 0, scopes: 0 })
      expect(host.referenceCounts().remoteFunctions).toBe(0)
    } finally { release.resolve(); close() }
  })

  it('preserves generic visitor results after the lending operation, including within a request', async () => {
    const { host, peer, close } = pair()
    try {
      const ctx = peer.decode(await host.encode({ telemetry: { measure: async (_name: string, visit: () => unknown) => visit() }, providers: { withConnection: async (visit: () => unknown) => visit() } }, 'plugin.init.args[0]')) as { telemetry: { measure(name: string, visit: () => unknown): Promise<() => Promise<number>> }; providers: { withConnection(visit: () => unknown): Promise<{ read(): Promise<number> }> } }
      const measured = await ctx.telemetry.measure('callable', () => () => 42)
      const connected = await ctx.providers.withConnection(() => ({ read: () => 43 }))
      await drain()
      expect(await measured()).toBe(42)
      expect(await connected.read()).toBe(43)
      const route = host.decode(await peer.encode(async (requestContext: { providers: { withConnections(id: string, visit: () => unknown): Promise<{ read(): Promise<number> }[]> } }) => {
        const values = await requestContext.providers.withConnections('fixture', () => ({ read: () => 44 }))
        await drain()
        return values[0].read()
      })) as (context: unknown) => Promise<number>
      expect(await route(invocationOwned({ providers: { withConnections: async (_id: string, visit: () => unknown) => [await visit()] } }))).toBe(44)
      await drain()
      expect(host.referenceCounts()).toMatchObject({ scopes: 0, pending: 0 })
      expect(peer.referenceCounts()).toMatchObject({ scopes: 0, pending: 0 })
    } finally { close() }
  })

  it('preserves realm-owned registration callbacks and similarly named capability methods', async () => {
    const { host, peer, close } = pair()
    let saved!: () => Promise<number>
    try {
      const capability = peer.decode(await host.encode({ undefined: async () => 42, telemetry: { measure: async (_name: string, visit: () => Promise<number>) => { saved = visit } } }, 'plugin.init.args[0].capabilities.get.result')) as { undefined(): Promise<number>; telemetry: { measure(name: string, visit: () => number): Promise<void> } }
      await capability.telemetry.measure('long-lived', () => 42)
      await drain()
      expect(await saved()).toBe(42)
      expect(await capability.undefined()).toBe(42)
      expect(await capability.undefined()).toBe(42)
      expect(peer.referenceCounts().functions).toBe(1)
    } finally { close() }
  })

  it('does not roll back a stable callback published by a concurrent call', async () => {
    const { host, peer, close } = pair()
    let saved!: () => Promise<number>, stream!: ReadableStreamDefaultController<Uint8Array>
    try {
      const remote = host.decode(await peer.encode({ hold: async () => {}, save: async (visit: () => Promise<number>) => { saved = visit } })) as { hold(...args: unknown[]): Promise<void>; save(visit: () => number): Promise<void> }
      const visit = () => 42
      const broken = remote.hold(visit, new Request('https://fixture.invalid', { method: 'POST', body: new ReadableStream({ start(controller) { stream = controller } }), duplex: 'half' } as RequestInit))
      const rejected = expect(broken).rejects.toThrow('body failed')
      await drain()
      await remote.save(visit)
      stream.error(new Error('body failed'))
      await rejected
      expect(await saved()).toBe(42)
      expect(host.referenceCounts().functions).toBe(1)
    } finally { close() }
  })

  it('rolls back half-encoded graphs when classification or binding fails', async () => {
    const { host, close } = pair((path) => { if (path.endsWith('.bad')) throw new Error('bad mode'); return 'async' })
    try {
      await expect(host.encode({ good() {}, bad() {} })).rejects.toThrow('bad mode')
      expect(host.referenceCounts().functions).toBe(0)
      class Broken { good() {}; bad() {} }
      Object.defineProperty(Broken.prototype.bad, 'name', { get() { throw new Error('bad bind') } })
      await expect(host.encode(new Broken())).rejects.toThrow('bad bind')
      expect(host.referenceCounts().functions).toBe(0)
    } finally { close() }
  })

  it('rejects new authority calls after cancellation while an entered callback drains', async () => {
    const { host, peer, close } = pair()
    const held = deferred(), entered = deferred()
    let captured!: { read(): Promise<number> }, first!: Promise<number>
    try {
      const route = host.decode(await peer.encode(async (_request: Request, ctx: typeof captured) => {
        captured = ctx; first = ctx.read(); await entered.promise
        return new Promise(() => {})
      })) as (request: Request, ctx: typeof captured) => Promise<Response>
      const controller = new AbortController()
      const call = route(new Request('https://fixture.invalid', { signal: controller.signal }), invocationOwned({ read: async () => { entered.resolve(); await held.promise; return 42 } }))
      const rejected = expect(call).rejects.toMatchObject({ name: 'AbortError' })
      await entered.promise; controller.abort(); await rejected
      expect(host.referenceCounts().functions).toBe(1)
      await expect(captured.read()).rejects.toThrow(/invocation has ended/)
      held.resolve(); expect(await first).toBe(42); await drain()
      expect(host.referenceCounts()).toMatchObject({ functions: 0, scopes: 0, pending: 0 })
    } finally { held.resolve(); close() }
  })

  it.each(['store', 'signal', 'request'])('rejects a held nested %s result delivered after its outer invocation retires', async (kind) => {
    const { host, peer, port1, close } = pair()
    const sent = deferred()
    let held: unknown, late!: Promise<unknown>
    const post = port1.postMessage.bind(port1)
    port1.postMessage = (message) => {
      const wire = message as { __acornRpc?: string; value?: { lateStore?: boolean } }
      if (wire.__acornRpc === 'result' && wire.value?.lateStore) { held = message; sent.resolve(); return }
      post(message)
    }
    try {
      const route = host.decode(await peer.encode(async (ctx: { store(): Promise<unknown> }) => {
        late = ctx.store(); void late.catch(() => {})
        await sent.promise
        return new Response('done')
      })) as (ctx: unknown) => Promise<Response>
      const read = async () => 42
      const nested = kind === 'store' ? { read } : kind === 'signal' ? AbortSignal.abort({ read }) : new Request('https://fixture.invalid', { signal: AbortSignal.abort({ read }) })
      expect(await (await route(invocationOwned({ store: async () => ({ lateStore: true, nested }) }))).text()).toBe('done')
      expect(held).toBeDefined()
      post(held); held = undefined
      await expect(late).rejects.toThrow(/invocation has ended/)
      await drain()
      expect(host.referenceCounts()).toMatchObject({ functions: 0, scopes: 0, pending: 0 })
      expect(peer.referenceCounts()).toMatchObject({ remoteFunctions: 0, remoteScopes: 0, pending: 0 })
    } finally { if (held) post(held); close() }
  })
})

describe('RPC stable and resource identities', () => {
  it('reuses class bindings and separates sync and async exports of the same function', async () => {
    const { host, peer, close } = pair((path) => path.endsWith('.sync') ? 'sync' : 'async')
    try {
      class Counter { #value = 42; read() { return this.#value } }
      const instance = new Counter()
      const first = await host.encode(instance) as { read: { id: number } }
      expect(await host.encode(instance)).toEqual(first)
      const remote = peer.decode(first) as { read(): Promise<number> }
      expect(await remote.read()).toBe(42)
      const fn = () => 1
      const modes = await host.encode({ sync: fn, async: fn }) as { sync: { id: number; sync: boolean }; async: { id: number; sync: boolean } }
      expect(modes.sync.sync).toBe(true)
      expect(modes.async.sync).toBe(false)
      expect(modes.sync.id).not.toBe(modes.async.id)
      expect(host.referenceCounts().functions).toBe(3)
    } finally { close() }
  })

  it('resolves replaced capability implementations without invalidating a retained old proxy', async () => {
    const { host, peer, close } = pair()
    try {
      let implementation = { read: async () => 'first' }
      const ctx = peer.decode(await host.encode({ capabilities: { get: async () => implementation } }, 'plugin.init.args[0]')) as { capabilities: { get(): Promise<typeof implementation> } }
      const first = await ctx.capabilities.get()
      expect((await ctx.capabilities.get()).read).toBe(first.read)
      implementation = { read: async () => 'second' }
      const second = await ctx.capabilities.get()
      expect(await second.read()).toBe('second')
      expect(await first.read()).toBe('first')
    } finally { close() }
  })

  it('keeps overlapping returned spans open until end, including idempotent ends and sibling fields', async () => {
    const { host, peer, close } = pair()
    let ended = 0
    try {
      const ctx = peer.decode(await host.encode({ telemetry: { startSpan: () => ({ traceId: 'trace', spanId: 'span', end: () => { ended++ } }) } }, 'plugin.init.args[0]')) as { telemetry: { startSpan(): Promise<{ traceId: string; spanId: string; end(): Promise<void> }> } }
      const one = await ctx.telemetry.startSpan(), two = await ctx.telemetry.startSpan()
      expect(one.traceId).toBe('trace'); expect(two.spanId).toBe('span')
      expect(host.referenceCounts().functions).toBe(3)
      await one.end(); await one.end(); await drain()
      expect(host.referenceCounts().functions).toBe(2)
      await two.end(); await two.end(); await drain()
      expect(ended).toBe(2)
      expect(host.referenceCounts()).toMatchObject({ functions: 1, scopes: 0 })
      expect(peer.referenceCounts().remoteFunctions).toBe(1)
    } finally { close() }
  })
})
