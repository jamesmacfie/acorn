import { afterEach, expect, it, vi } from 'vitest'
import { MessageChannel as NativeMessageChannel } from 'node:worker_threads'
import type { PluginFrameContext } from '@acorn/protocol/plugin/bridge.ts'
import { _setWorkerFactory, _stopAllTreeWorkers, acquireTreeWorker } from './workerHost'

type Sandbox = { worker: Worker; tree: MessagePort; bridge: MessagePort; seen: unknown[]; closed: number }
const sandboxes: Sandbox[] = []
const ports: MessagePort[] = []
let sequence = 0
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 10))
const hash = () => `ownership-${++sequence}`
const context: PluginFrameContext = { surface: 'probe.panel', target: 'remote', nodeId: 'a', theme: 'light', style: 'terminal', claimsKeys: [] }
function factory(modern = true, ready = true) {
  _setWorkerFactory(() => {
    const sandbox = { seen: [], closed: 0 } as unknown as Sandbox
    sandbox.worker = {
      onerror: null,
      postMessage(message: { acornBridge?: number }, transfer: MessagePort[]) {
        if (message.acornBridge) {
          sandbox.bridge = transfer[0]!
          sandbox.tree = transfer[1]!
          ports.push(...transfer)
          sandbox.bridge.onmessage = () => {}
          sandbox.bridge.start()
          sandbox.tree.onmessage = (event: MessageEvent) => {
            sandbox.seen.push(event.data)
            ports.push(...event.ports)
            if (event.data.kind === 'tree:ping') sandbox.tree.postMessage({ kind: 'tree:pong' })
          }
          sandbox.tree.start()
          if (ready) sandbox.tree.postMessage({ kind: 'tree:ready', version: 1, entries: ['panel'] })
          sandbox.bridge.postMessage({ kind: 'connected', ...(modern ? { treeSlotBridge: 1 } : {}) })
        } else sandbox.seen.push(message)
      },
      terminate() { sandbox.closed++ },
    } as unknown as Worker
    sandboxes.push(sandbox)
    return sandbox.worker
  })
}
function acquire(bundle: string, authority = 'a', disposed = vi.fn()) {
  return acquireTreeWorker({ pluginId: 'probe', hash: bundle, context, authority, onRefused: () => {}, connect: (port) => { port.onmessage = () => {}; return { dispose: () => { disposed(); port.close() } } } })
}
afterEach(() => {
  _stopAllTreeWorkers()
  _setWorkerFactory(null)
  for (const port of ports.splice(0)) port.close()
  sandboxes.length = 0
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it('owns one modern bridge per slot, preserves props updates and reuses the warm module', async () => {
  factory()
  const bundle = hash()
  const disposed = vi.fn()
  const a = acquire(bundle, 'a', disposed), b = acquire(bundle, 'b', disposed)
  a.mount('a', 'panel', { value: 1 }); b.mount('b', 'panel', {})
  await settle()
  expect(sandboxes).toHaveLength(1)
  expect(a.bridgePort('a')).not.toBe(b.bridgePort('b'))
  const bridge = a.bridgePort('a')
  a.mount('a', 'panel', { value: 2 })
  expect(a.bridgePort('a')).toBe(bridge)
  a.release()
  expect(disposed).toHaveBeenCalledTimes(1)
  expect(a.bridgePort('a')).toBeNull()
  b.release()
  expect(disposed).toHaveBeenCalledTimes(2)
  expect(sandboxes[0]!.closed).toBe(0)
  const c = acquire(bundle, 'c', disposed)
  c.mount('c', 'panel', {})
  expect(sandboxes).toHaveLength(1)
  c.release()
})

it('gives equivalent and foreign legacy slots separate workers and retires each immediately', async () => {
  factory(false)
  const bundle = hash()
  const a = acquire(bundle), sibling = acquire(bundle), foreign = acquire(bundle, 'b')
  a.mount('a', 'panel', {}); sibling.mount('sibling', 'panel', {}); foreign.mount('foreign', 'panel', {})
  await settle()
  expect(sandboxes).toHaveLength(3)
  expect(a.bridgePort('a')).not.toBe(sibling.bridgePort('sibling'))
  expect(foreign.bridgePort('foreign')).not.toBe(sibling.bridgePort('sibling'))
  a.release()
  expect(sandboxes.map((sandbox) => sandbox.closed)).toEqual([1, 0, 0])
  sibling.release()
  expect(sandboxes.map((sandbox) => sandbox.closed)).toEqual([1, 1, 0])
  foreign.release()
  expect(sandboxes.map((sandbox) => sandbox.closed)).toEqual([1, 1, 1])
})

it('drops an admitted old-slot completion rather than publishing into a reused slot id', async () => {
  factory()
  const owner = acquire(hash())
  let finish = () => {}
  const held = new Promise<void>((resolve) => { finish = resolve })
  owner.onHostRequest('slot', async () => { await held; return { ok: true, body: 'old' } })
  owner.mount('slot', 'panel', {})
  await settle()
  sandboxes[0]!.tree.postMessage({ kind: 'tree:host-request', slot: 'slot', id: 1, op: 'owner.invoke', name: 'held' })
  await settle()
  owner.unmount('slot')
  owner.mount('slot', 'panel', {})
  finish()
  await settle()
  expect(sandboxes[0]!.seen.filter((message) => (message as { kind: string }).kind === 'tree:host-reply')).toEqual([])
  owner.release()
})

it('retires all resources even when an external bridge disposer throws', async () => {
  factory()
  const owner = acquireTreeWorker({ pluginId: 'probe', hash: hash(), context, authority: 'a', onRefused: () => {}, connect: (port) => ({ dispose: () => { port.close(); throw new Error('external disposer') } }) })
  owner.mount('a', 'panel', {}); owner.mount('b', 'panel', {})
  await settle()
  expect(() => _stopAllTreeWorkers()).not.toThrow()
  expect(sandboxes[0]!.closed).toBe(1)
  expect(owner.bridgePort('a')).toBeNull()
  owner.release()
})

it('evicts the oldest idle modern module while preserving active workers and reactivation recency', async () => {
  factory()
  const bundles = Array.from({ length: 18 }, hash)
  const owners = bundles.map((bundle) => acquire(bundle))
  await settle()
  for (const owner of owners.slice(0, 16)) owner.release()
  const reactivated = acquire(bundles[0]!)
  reactivated.release()
  owners[16]!.release()
  expect(sandboxes[0]!.closed).toBe(0)
  expect(sandboxes[1]!.closed).toBe(1)
  expect(sandboxes[17]!.closed).toBe(0)
  owners[17]!.release()
  expect(sandboxes[2]!.closed).toBe(1)
})

it('ignores a captured error callback from a retired worker generation', async () => {
  factory()
  const bundle = hash()
  const owner = acquire(bundle)
  owner.mount('a', 'panel', {})
  await settle()
  const error = sandboxes[0]!.worker.onerror!
  _stopAllTreeWorkers()
  const replacement = acquire(bundle)
  replacement.mount('b', 'panel', {})
  error.call(sandboxes[0]!.worker, { message: 'late old failure' } as ErrorEvent)
  expect(sandboxes[1]!.closed).toBe(0)
  owner.release(); replacement.release()
})

it('bounds retired classification hints and derives legacy mode from live slot workers after hint eviction', async () => {
  factory(false)
  const liveBundle = hash(), retiredBundle = hash()
  const active = acquire(liveBundle)
  const retired = acquire(retiredBundle)
  await settle()
  retired.release()
  const historical = Array.from({ length: 257 }, () => acquire(hash()))
  await settle()
  for (const owner of historical) owner.release()
  const before = sandboxes.length
  const equivalent = acquire(liveBundle)
  expect(sandboxes).toHaveLength(before + 1)
  expect(equivalent.bridgePort()).not.toBe(active.bridgePort())
  const foreign = acquire(liveBundle, 'foreign')
  expect(foreign.bridgePort()).not.toBeNull()
  expect(foreign.bridgePort()).not.toBe(active.bridgePort())
  const reprobe = acquire(retiredBundle)
  // This retired old hash no longer has a hint, so classification runs again without privileged
  // bootstrap handles. Existing live contexts above classify their new slot workers without a detector.
  expect(reprobe.bridgePort()).toBeNull()
  await settle()
  expect(reprobe.bridgePort()).not.toBeNull()
  active.release(); equivalent.release(); foreign.release(); reprobe.release()
})

it.each(['spawn', 'bridge-channel', 'tree-channel', 'transfer'] as const)(
  'retires every admitted startup handle exactly once when %s fails', async (step) => {
    const failure = new Error(`failed ${step}`)
    const closes: ReturnType<typeof vi.fn>[] = []
    let channels = 0
    vi.stubGlobal('MessageChannel', function () {
      channels++
      if ((step === 'bridge-channel' && channels === 1) || (step === 'tree-channel' && channels === 2)) throw failure
      const channel = new NativeMessageChannel()
      for (const port of [channel.port1, channel.port2]) {
        const close = port.close.bind(port)
        const tracked = vi.fn(close)
        port.close = tracked
        closes.push(tracked)
      }
      return channel
    })
    const terminate = vi.fn()
    _setWorkerFactory(() => {
      if (step === 'spawn') throw failure
      return { onerror: null, postMessage: () => { if (step === 'transfer') throw failure }, terminate } as unknown as Worker
    })
    const refused = vi.fn()
    const handle = acquireTreeWorker({ pluginId: 'probe', hash: hash(), onRefused: refused, connect: (port) => {
      return { dispose: () => { port.close(); throw new Error('cleanup must preserve original startup failure') } }
    } })
    const failed = vi.fn()
    handle.transport('failed').onFailed(failed)
    await settle()
    expect(refused).toHaveBeenCalledWith(failure.message)
    expect(failed).toHaveBeenCalledWith(failure.message)
    handle.release()
    for (const close of closes) expect(close).toHaveBeenCalledTimes(1)
    expect(terminate).toHaveBeenCalledTimes(step === 'spawn' ? 0 : 1)
  },
)

it('reserves the 512 slot budget before spawning, and returns reservations after release and failure', async () => {
  factory()
  const bundle = hash()
  const owners = Array.from({ length: 512 }, () => acquire(bundle))
  await settle()
  expect(() => acquire(bundle, 'overflow')).toThrow('512')
  expect(sandboxes).toHaveLength(1)
  owners[0]!.mount('reserved', 'panel', {})
  expect(() => owners[0]!.mount('extra', 'panel', {})).toThrow('512')
  owners[1]!.release()
  owners[0]!.mount('extra', 'panel', {})
  expect(() => acquire(bundle, 'overflow')).toThrow('512')
  _stopAllTreeWorkers()
  const replacement = acquire(bundle)
  expect(sandboxes).toHaveLength(2)
  for (const owner of owners) owner.release()
  replacement.release()
})

it('supports multiple slots on one owner within the same early reservation budget', async () => {
  factory(false)
  const bundle = hash(), owner = acquire(bundle)
  await settle()
  for (let i = 0; i < 512; i++) owner.mount(`slot-${i}`, 'panel', {})
  expect(() => owner.mount('overflow', 'panel', {})).toThrow('512')
  expect(() => acquire(bundle, 'foreign')).toThrow('512')
  owner.unmount('slot-0')
  const sibling = acquire(bundle)
  expect(sandboxes).toHaveLength(513)
  expect(sandboxes[0]!.closed).toBe(1)
  owner.release(); sibling.release()
  expect(sandboxes.every((sandbox) => sandbox.closed === 1)).toBe(true)
})

it.each([true, false])('owns only the latest pre-ready props (modern=%s)', async (modern) => {
  factory(modern, false)
  const owner = acquire(hash())
  await settle()
  for (let value = 0; value < 1000; value++) owner.mount('slot', 'panel', { value })
  await settle()
  const mounts = () => sandboxes[0]!.seen.filter((message) => (message as { kind: string }).kind === 'tree:mount')
  expect(mounts()).toHaveLength(0)
  sandboxes[0]!.tree.postMessage({ kind: 'tree:ready', version: 1, entries: ['panel'] })
  await settle()
  expect(mounts()).toHaveLength(1)
  expect(mounts().at(-1)).toMatchObject({ props: { value: 999 } })
  owner.release()
})

it('keeps the existing failure deadline while native construction is deferred and ignores late readiness', async () => {
  factory(false, false)
  let constructed = () => {}
  const readiness = new Promise<void>((resolve) => { constructed = resolve })
  const spawning: Sandbox[] = []
  _setWorkerFactory(() => {
    const worker = { ready: readiness, onerror: null, postMessage: (message: { acornBridge?: number }) => { if (!message.acornBridge) throw new Error('deferred worker owns only hello') }, terminate: vi.fn() } as unknown as Worker
    spawning.push({ worker } as Sandbox)
    return worker
  })
  vi.useFakeTimers()
  const owner = acquire(hash())
  const failed = vi.fn()
  owner.transport('slot').onFailed(failed)
  owner.mount('slot', 'panel', { value: 1 })
  await vi.advanceTimersByTimeAsync(20_000)
  expect(failed).toHaveBeenCalledExactlyOnceWith('this plugin stopped responding')
  expect(spawning[0]!.worker.terminate).toHaveBeenCalledTimes(1)
  constructed()
  await Promise.resolve()
  expect(owner.bridgePort('slot')).toBeNull()
  owner.release()
})

it('retires both modern mount endpoints when scoped bridge construction fails without killing siblings', async () => {
  factory()
  const channels: { port1: ReturnType<typeof vi.fn>; port2: ReturnType<typeof vi.fn> }[] = []
  vi.stubGlobal('MessageChannel', function () {
    const channel = new NativeMessageChannel()
    const port1 = vi.fn(channel.port1.close.bind(channel.port1))
    const port2 = vi.fn(channel.port2.close.bind(channel.port2))
    channel.port1.close = port1
    channel.port2.close = port2
    channels.push({ port1, port2 })
    return channel
  })
  const bundle = hash()
  const failed = vi.fn()
  const owner = acquireTreeWorker({ pluginId: 'probe', hash: bundle, context, onRefused: failed, connect: () => { throw new Error('bridge construction failed') } })
  const sibling = acquire(bundle)
  const failures: string[] = []
  owner.transport('failed').onFailed((reason) => failures.push(reason))
  owner.mount('failed', 'panel', {})
  sibling.mount('live', 'panel', {})
  await settle()
  expect(failures).toEqual(['bridge construction failed'])
  expect(channels[2]!.port1).toHaveBeenCalledOnce()
  expect(channels[2]!.port2).toHaveBeenCalledOnce()
  expect(owner.bridgePort('failed')).toBeNull()
  expect(sibling.bridgePort('live')).not.toBeNull()
  expect(sandboxes[0]!.closed).toBe(0)
  owner.release(); sibling.release()
})
