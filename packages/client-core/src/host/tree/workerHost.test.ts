import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TreeMutation } from '@acorn/protocol/tree/messages.ts'
import type { FrameBridge } from '../frames/broker'
import type { TreeSlotBridge } from './workerHost'
import { allowApi } from '../frames/scopes'
import { pluginTreeRelayOrigin, pluginTreeRelayUrl } from './isolatedWorker'
import { _setWorkerFactory, _stopAllTreeWorkers, acquireTreeWorker, stopTreeWorker } from './workerHost'

// The lifecycle around a plugin's worker: one per bundle, shared by every tree it serves, stopped when
// the last one goes and when it stops answering.
//
// The worker is a stub that behaves the way a bundle would: it takes the two ports out of the hello
// and answers on the tree one. What is being tested is the host's half — the sharing, the routing by
// slot, and how failure reaches every tree when it dies.

const HASH = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const OTHER_HASH = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'

type Sandbox = {
  worker: Worker
  /** The tree port, as the bundle would hold it. */
  port: MessagePort
  terminated: boolean
  seen: unknown[]
  scoped: boolean
}

let sandbox: Sandbox | null = null
let sandboxes: Sandbox[] = []

const stubWorker = (record: Sandbox): Worker => ({
  postMessage: (_message: unknown, transfer?: Transferable[]) => {
    // The hello: the bridge port first, the tree port second, exactly as a frame's hello carries one.
    const port = ((transfer ?? []) as MessagePort[])[1]!
    ;((transfer ?? []) as MessagePort[])[0]!.postMessage({ kind: 'connected' })
    record.port = port
    port.onmessage = (event: MessageEvent) => record.seen.push(event.data)
    port.start()
    port.postMessage({ kind: 'tree:ready', version: 1, entries: ['toolCard'], ...(record.scoped ? { scopedBridge: true } : {}) })
  },
  terminate: () => { record.terminated = true },
  onerror: null,
} as unknown as Worker)

const bridge = (): FrameBridge => ({ dispose: () => {} })
const slotBridge = (): TreeSlotBridge => ({
  context: { surface: 'toolCard', target: 'remote', nodeId: 'node-a', theme: 'light', style: 'terminal' },
  connect: () => bridge(),
})

const acquire = (refused: string[] = []) =>
  acquireTreeWorker({ pluginId: 'stranger', hash: HASH, authority: 'equivalent-test-context', connect: () => bridge(), onRefused: (reason) => refused.push(reason) })

const start = (scoped = false): void => {
  sandbox = null
  sandboxes = []
  _setWorkerFactory(() => {
    const record: Sandbox = { worker: null as unknown as Worker, port: null as unknown as MessagePort, terminated: false, seen: [], scoped }
    record.worker = stubWorker(record)
    sandboxes.push(record)
    sandbox = record
    return record.worker
  })
}

const answerHeartbeats = (record: Sandbox): void => {
  record.port.onmessage = (event: MessageEvent) => {
    record.seen.push(event.data)
    if ((event.data as { kind?: string }).kind === 'tree:ping') record.port.postMessage({ kind: 'tree:pong' })
  }
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  _stopAllTreeWorkers()
  _setWorkerFactory(null)
  sandbox = null
  sandboxes = []
  vi.useRealTimers()
})

describe('one worker per bundle', () => {
  it('reports unavailable isolation through its surface without creating an app-origin worker', async () => {
    _setWorkerFactory(() => { throw new Error('unknown renderer origin for a plugin worker') })
    const refused: string[] = []
    const failures: string[] = []
    const handle = acquire(refused)
    handle.transport('s1').onFailed((reason) => failures.push(reason))
    await settle()
    expect(refused).toEqual(['unknown renderer origin for a plugin worker'])
    expect(failures).toEqual(refused)
    expect(handle.bridgePort()).toBeNull()
    handle.release()
  })

  it('isolates identical bytes by plugin id, including each bridge’s API namespace', async () => {
    start()
    const connected: string[] = []
    const take = (pluginId: string) => acquireTreeWorker({
      pluginId,
      hash: HASH,
      connect: () => {
        connected.push(pluginId)
        expect(allowApi({ pluginId, api: [] }, 'GET', `/v1/p/${pluginId}/items`).allowed).toBe(true)
        expect(allowApi({ pluginId, api: [] }, 'GET', `/v1/p/${pluginId === 'alpha' ? 'beta' : 'alpha'}/items`).allowed).toBe(false)
        return bridge()
      },
      onRefused: () => {},
    })
    const alpha = take('alpha')
    const beta = take('beta')
    expect(sandboxes).toHaveLength(2)
    await settle()
    expect(connected).toEqual(['alpha', 'beta'])
    expect(alpha.bridgePort()).not.toBe(beta.bridgePort())

    stopTreeWorker({ pluginId: 'alpha', hash: HASH }, 'trust withdrawn')
    expect(sandboxes[0]!.terminated).toBe(true)
    expect(sandboxes[1]!.terminated).toBe(false)
    expect(alpha.bridgePort()).toBeNull()
    expect(beta.bridgePort()).not.toBeNull()
  })

  it('keeps different hashes of one plugin independent', async () => {
    start()
    const alpha = acquireTreeWorker({ pluginId: 'alpha', hash: HASH, connect: () => bridge(), onRefused: () => {} })
    const newer = acquireTreeWorker({ pluginId: 'alpha', hash: OTHER_HASH, connect: () => bridge(), onRefused: () => {} })
    expect(sandboxes).toHaveLength(2)
    await settle()
    stopTreeWorker({ pluginId: 'alpha', hash: HASH }, 'replaced')
    expect(sandboxes.map(({ terminated }) => terminated)).toEqual([true, false])
    expect(alpha.bridgePort()).toBeNull()
    expect(newer.bridgePort()).not.toBeNull()
  })

  it('serves two trees from one worker, and stops it once both are gone', async () => {
    start(true)
    const first = acquire()
    const second = acquire()
    expect(sandbox!.terminated).toBe(false)

    first.mount('s1', 'toolCard', { tool: 'a' }, slotBridge)
    second.mount('s2', 'toolCard', { tool: 'b' }, slotBridge)
    // Real timers here: a port delivers on the event loop, not on a timer, so a fake clock cannot
    // advance it. The grace period below is a timer, and that is what the fake clock is for.
    await settle()
    expect(sandbox!.seen.map((message) => {
      const { bridgePort: _port, context: _context, slotBridge: _slotBridge, ...rest } = message as Record<string, unknown>
      return rest
    })).toEqual([
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

  it('starts the bundle through its isolated plugin origin', () => {
    expect(pluginTreeRelayUrl(HASH, 'nonce')).toBe(`app-plugin://${HASH}/worker.html#nonce`)
    expect(() => pluginTreeRelayUrl('../acorn', 'nonce')).toThrow('invalid plugin bundle hash')
    expect(pluginTreeRelayOrigin(HASH, 'app://acorn')).toBe(`app-plugin://${HASH}`)
    expect(pluginTreeRelayOrigin(HASH, 'http://app.localhost')).toBe(`http://app-plugin.${HASH}`)
    expect(pluginTreeRelayOrigin(HASH, 'https://app.localhost')).toBe(`https://app-plugin.${HASH}`)
    expect(() => pluginTreeRelayOrigin(HASH, 'https://evil.example')).toThrow('unknown renderer origin')
  })

  it('leaves another plugin alive when the first plugin’s grace expires', async () => {
    start(true)
    const alpha = acquireTreeWorker({ pluginId: 'alpha', hash: HASH, connect: () => bridge(), onRefused: () => {} })
    const beta = acquireTreeWorker({ pluginId: 'beta', hash: HASH, connect: () => bridge(), onRefused: () => {} })
    beta.mount('beta-slot', 'toolCard', {}, slotBridge)
    await settle()
    vi.useFakeTimers()
    const [alphaWorker, betaWorker] = sandboxes
    answerHeartbeats(alphaWorker!)
    answerHeartbeats(betaWorker!)
    alpha.release()
    for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(10_000)
    expect(alphaWorker!.terminated).toBe(true)
    expect(betaWorker!.terminated).toBe(false)
    expect(beta.bridgePort('beta-slot')).not.toBeNull()
  })

  it('cannot stop a replacement with an old generation’s timer or worker error', async () => {
    start(true)
    const first = acquireTreeWorker({ pluginId: 'alpha', hash: HASH, connect: () => bridge(), onRefused: () => {} })
    const oldWorker = sandbox!
    first.mount('s1', 'toolCard', {}, slotBridge)
    await vi.waitFor(() => expect(oldWorker.seen.some((message) => (message as { kind?: string }).kind === 'tree:mount')).toBe(true))
    vi.useFakeTimers()
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    first.release()
    const oldGrace = timeoutSpy.mock.calls.find(([, delay]) => delay === 30_000)?.[0]
    expect(oldGrace).toBeTypeOf('function')
    stopTreeWorker({ pluginId: 'alpha', hash: HASH }, 'authority replaced')
    const next = acquireTreeWorker({ pluginId: 'alpha', hash: HASH, connect: () => bridge(), onRefused: () => {} })
    const newWorker = sandbox!
    oldWorker.worker.onerror?.({ message: 'late error' } as ErrorEvent)
    const fireOldGrace = oldGrace as () => void
    fireOldGrace()
    timeoutSpy.mockRestore()
    expect(oldWorker.terminated).toBe(true)
    expect(newWorker.terminated).toBe(false)
    next.release()
  })

  it.each(['mounted', 'in grace'] as const)('stops a revoked worker immediately while %s', async (state) => {
    start(true)
    const dispose = vi.fn()
    const handle = acquireTreeWorker({ pluginId: 'alpha', hash: HASH, connect: () => ({ dispose }), onRefused: () => {} })
    const failures: string[] = []
    handle.transport('s1').onFailed((reason) => failures.push(reason))
    handle.mount('s1', 'toolCard', {})
    await settle()
    vi.useFakeTimers()
    if (state === 'in grace') handle.release()
    stopTreeWorker({ pluginId: 'alpha', hash: HASH }, 'trust withdrawn')
    expect(sandbox!.terminated).toBe(true)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(failures).toEqual(state === 'mounted' ? ['trust withdrawn'] : [])
    expect(handle.bridgePort()).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('what reaches a tree', () => {
  it('rejects a forged small byte count on an oversized batch', async () => {
    start()
    const refused: string[] = []
    const handle = acquire(refused)
    handle.mount('s1', 'toolCard', {})
    const received: TreeMutation[][] = []
    handle.transport('s1').onBatch((batch) => received.push([...batch]))
    const ops = Array.from({ length: 20 }, (_, index) => ({ op: 'text', id: `n${index}`, value: 'x'.repeat(60_000) }))
    sandbox!.port.postMessage({ kind: 'tree:batch', slot: 's1', ops, bytes: 0 })
    await settle()
    expect(refused).toContain('sent a tree message past the host size or depth limit')
    expect(received).toEqual([])
    handle.release()
  })

  it('replays the first batch when the worker answers before the host subscribes', async () => {
    start()
    const handle = acquire()
    handle.mount('s1', 'topbar', {})
    const ops: TreeMutation[] = [{ op: 'insert', parent: null, index: 0, node: { id: 'n1', type: 'Heading', props: {}, children: [] } }]
    sandbox!.port.postMessage({ kind: 'tree:batch', slot: 's1', ops })
    await settle()

    const received: TreeMutation[][] = []
    handle.transport('s1').onBatch((batch) => received.push([...batch]))
    expect(received).toEqual([ops])
    handle.release()
  })

  it('delivers selection and commands only to their scoped bridge', async () => {
    start(true)
    const handle = acquire()
    handle.mount('s1', 'toolCard', {}, slotBridge)
    handle.mount('s2', 'toolCard', {}, slotBridge)
    await vi.waitFor(() => expect(sandbox!.seen).toHaveLength(2))
    const messages = [[], []] as unknown[][]
    const mounts = sandbox!.seen as { bridgePort: MessagePort }[]
    mounts.forEach((mount, index) => {
      mount.bridgePort.onmessage = (event: MessageEvent) => messages[index]!.push(event.data)
      mount.bridgePort.start()
    })

    handle.select('s2', 'issue-2')
    handle.surfaceAction('s1', 'refresh')
    await vi.waitFor(() => expect(messages).toEqual([
      [{ kind: 'surfaceAction', command: 'refresh' }],
      [{ kind: 'select', item: 'issue-2' }],
    ]))
    handle.unmount('s1')
    handle.select('s1', 'stale')
    await settle()
    expect(messages[0]).toHaveLength(1)
    handle.release()
  })

  it('gives concurrent legacy mounts separate immutable workers without lending the first bridge', async () => {
    start(false)
    const handle = acquire()
    handle.mount('s1', 'toolCard', {})
    handle.mount('s2', 'toolCard', {})
    await settle()
    expect(sandboxes).toHaveLength(2)
    expect(sandboxes[0]!.seen).toEqual([expect.objectContaining({ slot: 's1' })])
    await vi.waitFor(() => expect(sandboxes[1]!.seen).toEqual([expect.objectContaining({ slot: 's2' })]))
    expect(handle.bridgePort('s1')).not.toBe(handle.bridgePort('s2'))
    handle.unmount('s1')
    expect(sandboxes[0]!.terminated).toBe(true)
    expect(sandboxes[1]!.terminated).toBe(false)
    handle.release()
  })

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

  it('fails the tree when the bundle cannot draw it', async () => {
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
    start(true)
    vi.useFakeTimers()
    const handle = acquire()
    const failures: string[] = []
    handle.transport('s1').onFailed((message) => failures.push(message))
    handle.transport('s2').onFailed((message) => failures.push(message))
    handle.mount('s1', 'toolCard', {}, slotBridge)
    handle.mount('s2', 'toolCard', {}, slotBridge)

    // Two beats with no pong in between is the whole rule.
    await vi.advanceTimersByTimeAsync(10_000)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(sandbox!.terminated).toBe(true)
    expect(failures).toEqual(['this plugin stopped responding', 'this plugin stopped responding'])
  })

  it('does not let a handle from a dead worker stop the one that replaced it', async () => {
    start()
    vi.useFakeTimers()
    // Two tool cards from the one bundle.
    const first = acquire()
    const second = acquire()
    first.mount('s1', 'toolCard', {})
    second.mount('s2', 'toolCard', {})

    // The bundle stops answering, so the host stops it and fails both cards.
    await vi.advanceTimersByTimeAsync(25_000)
    const dead = sandbox!
    expect(dead.terminated).toBe(true)

    // A card mounts again and gets a fresh worker under the same hash.
    first.unmount('s1')
    first.release()
    start()
    const third = acquire()
    const failures: string[] = []
    third.transport('s3').onFailed((message) => failures.push(message))
    third.mount('s3', 'toolCard', {})
    // This one is healthy, so the heartbeat is not what the assertion below is measuring.
    sandbox!.port.onmessage = (event: MessageEvent) => {
      sandbox!.seen.push(event.data)
      if ((event.data as { kind?: string }).kind === 'tree:ping') sandbox!.port.postMessage({ kind: 'tree:pong' })
    }

    // The late release belongs to the worker that died, not to this one.
    second.unmount('s2')
    second.release()
    for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(10_000)
    expect(sandbox!.terminated).toBe(false)
    expect(failures).toEqual([])
  })

  // The deadline on a host request, and the one operation it deliberately does not cover.
  //
  // `owner.invoke` is answered by code in this process, so a handler that never settles would leave the
  // tree waiting forever and the deadline is what stops it. `overlay.open` is answered by a person
  // closing a modal. Holding that to ten seconds meant the agent composer's image editor rejected the
  // sandbox's promise while the editor was still open, and the edit the reader applied came back to a
  // caller that had already given up.
  const ask = (op: 'owner.invoke' | 'overlay.open', hold: Promise<unknown>) => {
    start()
    const handle = acquire()
    handle.onHostRequest('s1', async () => {
      await hold
      return { ok: true, body: 'done' }
    })
    handle.mount('s1', 'toolCard', {})
    sandbox!.port.postMessage({ kind: 'tree:host-request', slot: 's1', id: 1, op, name: 'x' })
    return () => sandbox!.seen.filter((message) => (message as { kind?: string }).kind === 'tree:host-reply')
  }

  it('gives up on an owner action that never answers', async () => {
    // The fake clock goes in before the request does: the deadline is a timer the host starts when the
    // request lands, and one started on the real clock is not one this test can advance.
    vi.useFakeTimers()
    const replies = ask('owner.invoke', new Promise(() => {}))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(replies()).toEqual([
      { kind: 'tree:host-reply', slot: 's1', id: 1, ok: false, error: { code: 'timeout', message: 'the owner did not answer in time' } },
    ])
  })

  it('holds an open overlay past the deadline rather than failing it', async () => {
    vi.useFakeTimers()
    const replies = ask('overlay.open', new Promise(() => {}))
    await vi.advanceTimersByTimeAsync(30_000)
    // Half a minute in, with nothing said to the tree: the reader is still editing.
    expect(replies()).toEqual([])
  })

  it('delivers an overlay result to the tree that asked for it', async () => {
    let close = (_: unknown) => {}
    const replies = ask('overlay.open', new Promise((resolve) => { close = resolve }))
    await settle()
    close(null)
    await settle()
    expect(replies()).toEqual([{ kind: 'tree:host-reply', slot: 's1', id: 1, ok: true, body: 'done' }])
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
