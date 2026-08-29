import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TreeMutation } from '@acorn/protocol/tree/messages.ts'
import type { FrameBridge } from '../frames/broker'
import { _setWorkerFactory, _stopAllTreeWorkers, acquireTreeWorker, pluginWorkerUrl } from './workerHost'

// The lifecycle around a plugin's worker: one per bundle, shared by every tree it serves, stopped when
// the last one goes and when it stops answering.
//
// The worker is a stub that behaves the way a bundle would: it takes the two ports out of the hello
// and answers on the tree one. What is being tested is the host's half — the sharing, the routing by
// slot, and what a reader sees when it dies.

const HASH = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

type Sandbox = {
  worker: Worker
  /** The tree port, as the bundle would hold it. */
  port: MessagePort
  terminated: boolean
  seen: unknown[]
}

let sandbox: Sandbox | null = null

const stubWorker = (): Worker => ({
  postMessage: (_message: unknown, transfer?: Transferable[]) => {
    // The hello: the bridge port first, the tree port second, exactly as a frame's hello carries one.
    const port = ((transfer ?? []) as MessagePort[])[1]!
    sandbox!.port = port
    port.onmessage = (event: MessageEvent) => sandbox!.seen.push(event.data)
    port.start()
  },
  terminate: () => { sandbox!.terminated = true },
  onerror: null,
} as unknown as Worker)

const bridge = (): FrameBridge => ({ dispose: () => {} })

const acquire = (refused: string[] = []) =>
  acquireTreeWorker({ pluginId: 'stranger', hash: HASH, connect: () => bridge(), onRefused: (reason) => refused.push(reason) })

const start = (): void => {
  sandbox = { worker: null as unknown as Worker, port: null as unknown as MessagePort, terminated: false, seen: [] }
  _setWorkerFactory(() => {
    sandbox!.worker = stubWorker()
    return sandbox!.worker
  })
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  _stopAllTreeWorkers()
  _setWorkerFactory(null)
  sandbox = null
  vi.useRealTimers()
})

describe('one worker per bundle', () => {
  it('serves two trees from one worker, and stops it once both are gone', async () => {
    start()
    const first = acquire()
    const second = acquire()
    expect(sandbox!.terminated).toBe(false)

    first.mount('s1', 'toolCard', { tool: 'a' })
    second.mount('s2', 'toolCard', { tool: 'b' })
    // Real timers here: a port delivers on the event loop, not on a timer, so a fake clock cannot
    // advance it. The grace period below is a timer, and that is what the fake clock is for.
    await settle()
    expect(sandbox!.seen).toEqual([
      { kind: 'tree:mount', slot: 's1', entry: 'toolCard', props: { tool: 'a' } },
      { kind: 'tree:mount', slot: 's2', entry: 'toolCard', props: { tool: 'b' } },
    ])

    vi.useFakeTimers()
    first.release()
    await vi.advanceTimersByTimeAsync(60_000)
    // Still running: the second tree is holding it.
    expect(sandbox!.terminated).toBe(false)
    second.release()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sandbox!.terminated).toBe(true)
  })

  it('names the bundle by its hash, on the shell’s own origin', () => {
    // Not `app-plugin://`: a worker script has to be same-origin with the document that started it.
    expect(pluginWorkerUrl(HASH)).toBe(`/plugin-worker/${HASH}.js`)
  })
})

describe('what reaches a tree', () => {
  it('routes a batch to the slot it names and nowhere else', async () => {
    start()
    const handle = acquire()
    const mine: TreeMutation[][] = []
    const theirs: TreeMutation[][] = []
    handle.transport('s1').onBatch((ops) => mine.push([...ops]))
    handle.transport('s2').onBatch((ops) => theirs.push([...ops]))
    handle.mount('s1', 'toolCard', {})
    handle.mount('s2', 'toolCard', {})

    const ops: TreeMutation[] = [{ op: 'insert', parent: null, index: 0, node: { id: 'n1', type: 'Card', props: {}, children: [] } }]
    sandbox!.port.postMessage({ kind: 'tree:batch', slot: 's1', ops })
    await settle()
    expect(mine).toEqual([ops])
    expect(theirs).toEqual([])
  })

  it('refuses a message the host cannot read, without touching the tree', async () => {
    start()
    const refused: string[] = []
    const handle = acquire(refused)
    const batches: TreeMutation[][] = []
    handle.transport('s1').onBatch((ops) => batches.push([...ops]))
    handle.mount('s1', 'toolCard', {})

    sandbox!.port.postMessage({ kind: 'tree:batch', slot: 's1', ops: [{ op: 'teleport', id: 'n1' }] })
    sandbox!.port.postMessage({ nonsense: true })
    await settle()
    expect(batches).toEqual([])
    expect(refused).toHaveLength(2)
    expect(refused[0]).toContain('could not read')
  })

  it('gives the tree a placeholder when the bundle cannot draw it', async () => {
    start()
    const refused: string[] = []
    const handle = acquire(refused)
    const failures: string[] = []
    handle.transport('s1').onFailed((message) => failures.push(message))
    handle.mount('s1', 'missing', {})

    sandbox!.port.postMessage({ kind: 'tree:failed', slot: 's1', message: "no renderer named 'missing'" })
    await settle()
    expect(failures).toEqual(["no renderer named 'missing'"])
    expect(refused.join(' ')).toContain("no renderer named 'missing'")
  })

  it('fails every tree it was serving when the worker stops answering', async () => {
    start()
    vi.useFakeTimers()
    const handle = acquire()
    const failures: string[] = []
    handle.transport('s1').onFailed((message) => failures.push(message))
    handle.transport('s2').onFailed((message) => failures.push(message))
    handle.mount('s1', 'toolCard', {})
    handle.mount('s2', 'toolCard', {})

    // Two beats with no pong in between is the whole rule.
    await vi.advanceTimersByTimeAsync(10_000)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(sandbox!.terminated).toBe(true)
    expect(failures).toEqual(['this plugin stopped responding', 'this plugin stopped responding'])
  })

  it('keeps a worker alive while it answers the heartbeat', async () => {
    start()
    vi.useFakeTimers()
    const handle = acquire()
    handle.mount('s1', 'toolCard', {})
    // The stub answers, the way a live bundle's `mountTree` does.
    sandbox!.port.onmessage = (event: MessageEvent) => {
      sandbox!.seen.push(event.data)
      if ((event.data as { kind?: string }).kind === 'tree:ping') sandbox!.port.postMessage({ kind: 'tree:pong' })
    }
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(10_000)
    expect(sandbox!.terminated).toBe(false)
  })
})
