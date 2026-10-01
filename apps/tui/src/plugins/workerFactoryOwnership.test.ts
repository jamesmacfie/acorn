import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MessageChannel, Worker } from 'node:worker_threads'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

type Adapter = { ready: Promise<void>; postMessage(message: unknown, ports?: unknown[]): void; terminate(): Promise<void>; onerror: ((event: { message: string }) => void) | null }
const held = vi.hoisted(() => ({ path: '', factory: null as ((url: string) => Adapter) | null, warnings: [] as unknown[] }))
vi.mock('./custody', () => ({ bundlePath: () => held.path }))
vi.mock('@acorn/client-core/host/tree/workerHost.ts', () => ({ _setWorkerFactory: (factory: (url: string) => Adapter) => { held.factory = factory } }))
vi.mock('@acorn/client-core/infra/telemetry', () => ({ createLogger: () => ({ warn: (...args: unknown[]) => held.warnings.push(args) }) }))
import { installPluginWorkers } from './workerFactory'

const adapters: Adapter[] = []
const workers: Worker[] = []
const channels: MessageChannel[] = []
const messages: { phase?: string; restored?: boolean }[] = []
const gates: (() => void)[] = []
const realPost = Worker.prototype.postMessage
const realTerminate = Worker.prototype.terminate
let directory = ''
let sequence = 0
const wait = async (condition: () => boolean, deadline = 3000) => {
  const until = Date.now() + deadline
  while (!condition()) {
    if (Date.now() >= until) throw new Error(`worker fixture deadline: ${JSON.stringify(messages)}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
const bundle = (source: string) => {
  held.path = join(directory, `bundle-${++sequence}.mjs`)
  writeFileSync(held.path, source)
}
const start = (hash = `factory-${sequence}`) => {
  const adapter = held.factory!(`/plugin-worker/${hash}.js`)
  adapters.push(adapter)
  const bridge = new MessageChannel(), tree = new MessageChannel()
  channels.push(bridge, tree)
  bridge.port1.postMessage({ kind: 'ready', context: { nodeId: 'fixture' } })
  adapter.postMessage({ acornBridge: 1 }, [bridge.port2, tree.port2])
  return { adapter, bridge, tree }
}
const claimingModule = `
addEventListener('message', (event) => {
  if (!event.data.acornBridge) return
  const bridge = event.ports[0]
  bridge.onmessage = (message) => {
    if (message.data.kind === 'ready') {
      bridge.postMessage({ kind: 'connected' })
      postMessage({ phase: 'claimed', restored: !bridge.postMessage.toString().includes('claimHello') })
      bridge.postMessage({ id: 1, kind: 'api', path: '/once' })
    } else if (message.data.id === 1) postMessage({ phase: 'reply' })
  }
  bridge.start()
})
`
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'acorn-worker-factory-test-'))
  installPluginWorkers()
  vi.spyOn(Worker.prototype, 'postMessage').mockImplementation(function (this: Worker, message, transfer) {
    if ((message as { acornBridge?: number })?.acornBridge && !workers.includes(this)) {
      workers.push(this)
      this.on('message', (message) => messages.push(message))
    }
    return realPost.call(this, message, transfer)
  })
})
afterEach(async () => {
  for (const release of gates.splice(0)) release()
  // Always terminate native threads even when an injected adapter termination fails.
  await Promise.all(workers.map((worker) => realTerminate.call(worker)))
  await Promise.all(adapters.splice(0).map((adapter) => adapter.terminate()))
  for (const channel of channels.splice(0)) { channel.port1.close(); channel.port2.close() }
  workers.length = 0
  messages.length = 0
  held.warnings.length = 0
  vi.restoreAllMocks()
  rmSync(directory, { recursive: true, force: true })
})

it('retains the hello through a delayed import and unrelated first listener, then restores adopted ports', async () => {
  bundle(`addEventListener('message', () => postMessage({ phase: 'generic' })); await new Promise(resolve => setTimeout(resolve, 80)); ${claimingModule}`)
  const { bridge } = start()
  let requests = 0
  bridge.port1.on('message', (message) => {
    if (message.id === 1) { requests++; bridge.port1.postMessage({ id: 1, ok: true, body: 'once' }) }
  })
  await wait(() => messages.some((message) => message.phase === 'reply'))
  expect(messages.find((message) => message.phase === 'claimed')?.restored).toBe(true)
  expect(requests).toBe(1)
})

it('retires both unclaimed transferred ports and reports the original module rejection', async () => {
  bundle(`await new Promise(resolve => setTimeout(resolve, 50)); throw new Error('rejected module')`)
  const { adapter, bridge, tree } = start()
  const closed = vi.fn(), failed = vi.fn()
  bridge.port1.on('close', closed); tree.port1.on('close', closed)
  adapter.onerror = failed
  await wait(() => failed.mock.calls.length > 0)
  await wait(() => closed.mock.calls.length === 2)
  expect(failed).toHaveBeenCalledWith({ message: 'rejected module' })
})

it('expires an unclaimed hello with a visible worker error and closes its transferred ports', async () => {
  bundle(`addEventListener('message', () => postMessage({ phase: 'generic' })); await new Promise(() => {})`)
  const { adapter, bridge, tree } = start()
  const closed = vi.fn(), failed = vi.fn()
  bridge.port1.on('close', closed); tree.port1.on('close', closed)
  adapter.onerror = failed
  await wait(() => failed.mock.calls.length > 0, 12_000)
  await wait(() => closed.mock.calls.length === 2)
  expect(failed.mock.calls[0]![0].message).toContain('did not claim its initial bridge')
}, 15_000)

it('drains noisy stdout and stderr without retaining a transcript or blocking the bridge', async () => {
  bundle(`
    const chunk = 'noisy-plugin-output'.repeat(8192)
    for (const stream of [process.stdout, process.stderr]) {
      for (let i = 0; i < 64; i++) await new Promise(resolve => stream.write(chunk) ? resolve() : stream.once('drain', resolve))
    }
    postMessage({ phase: 'drained' })
    ${claimingModule}
  `)
  start()
  await wait(() => messages.some((message) => message.phase === 'claimed'), 5000)
  expect(messages.some((message) => message.phase === 'drained')).toBe(true)
  expect(workers[0]!.stdout?.readableFlowing).toBe(true)
  expect(workers[0]!.stderr?.readableFlowing).toBe(true)
  expect(workers[0]!.stdout?.readableLength).toBe(0)
  expect(workers[0]!.stderr?.readableLength).toBe(0)
})

it('cancels repeated deferred same-hash adapters without spawning and releases each retained hello once', async () => {
  bundle(claimingModule)
  const first = start('barrier')
  await first.adapter.ready
  let release = () => {}
  const barrier = new Promise<void>((resolve) => { release = resolve; gates.push(resolve) })
  vi.spyOn(Worker.prototype, 'terminate').mockImplementation(function (this: Worker) {
    return realTerminate.call(this).then(async (code) => { await barrier; return code })
  })
  const retirement = first.adapter.terminate()
  for (let i = 0; i < 100; i++) {
    const next = start('barrier')
    const closes = [vi.spyOn(next.bridge.port2, 'close'), vi.spyOn(next.tree.port2, 'close')]
    await next.adapter.terminate()
    for (const close of closes) expect(close).toHaveBeenCalledTimes(1)
  }
  const survivor = start('barrier')
  let constructed = false
  void survivor.adapter.ready.then(() => { constructed = true })
  expect(workers).toHaveLength(1)
  expect(constructed).toBe(false)
  release()
  await retirement
  await survivor.adapter.ready
  expect(workers).toHaveLength(2)
})

it('observes a rejected termination and waits for actual thread exit before admitting its replacement', async () => {
  bundle(claimingModule)
  const first = start('rejected-termination')
  await first.adapter.ready
  vi.spyOn(Worker.prototype, 'terminate').mockImplementationOnce(() => Promise.reject(new Error('injected termination rejection')))
  const retirement = first.adapter.terminate()
  const survivor = start('rejected-termination')
  await wait(() => held.warnings.length === 1)
  expect(workers).toHaveLength(1)
  await realTerminate.call(workers[0]!)
  await retirement
  await survivor.adapter.ready
  expect(workers).toHaveLength(2)
})
