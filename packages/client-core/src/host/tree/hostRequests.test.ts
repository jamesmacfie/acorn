import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TREE_LIMITS } from '@acorn/protocol/tree/messages.ts'
import type { FrameBridge } from '../frames/broker'
import { _setWorkerFactory, _stopAllTreeWorkers, acquireTreeWorker, type TreeHostResult } from './workerHost'

// What a mounted tree may ask the host for, and everything the host refuses
// (docs/plugins.md § Asking the host).
//
// The half tested here is the routing and the limits: which slot a request is answered on, what happens
// when nobody is listening, and the four ways a request is refused before an owner ever sees it. Who is
// allowed to ask for what — the action has to be declared and bound, the overlay has to be the one the
// descriptor named — is RemoteTree's, and is tested where the registries are.
//
// Same stub worker as workerHost.test.ts, for the same reason: a real one would need a real bundle.

const HASH = 'aaaaaaaabbbbbbbbccccccccddddddddaaaaaaaabbbbbbbbccccccccdddddddd'

let port: MessagePort
let seen: unknown[]

const stubWorker = (): Worker => ({
  postMessage: (_message: unknown, transfer?: Transferable[]) => {
    port = ((transfer ?? []) as MessagePort[])[1]!
    port.onmessage = (event: MessageEvent) => seen.push(event.data)
    port.start()
  },
  terminate: () => {},
  onerror: null,
} as unknown as Worker)

const acquire = () =>
  acquireTreeWorker({
    pluginId: 'stranger',
    hash: HASH,
    connect: (): FrameBridge => ({ dispose: () => {} }),
    onRefused: () => {},
  })

const settle = async (): Promise<void> => {
  // Three hops, not one: the request crosses the port, the host awaits a handler, and the reply crosses
  // back. A single macrotask lands in the middle of that.
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

/** Every reply the host has posted, in order. */
const replies = () => seen.filter((message) => (message as { kind?: string }).kind === 'tree:host-reply') as {
  slot: string
  id: number
  ok: boolean
  body?: unknown
  error?: { code: string; message: string }
}[]

const ask = (slot: string, id: number, payload?: unknown): void => {
  port.postMessage({ kind: 'tree:host-request', slot, id, op: 'owner.invoke', name: 'replace', ...(payload === undefined ? {} : { payload }) })
}

beforeEach(() => {
  seen = []
  _setWorkerFactory(() => stubWorker())
})

afterEach(() => {
  _stopAllTreeWorkers()
  _setWorkerFactory(null)
  vi.useRealTimers()
})

describe('a tree asking its host for something', () => {
  it('answers on the slot it arrived on, so one worker’s two trees cannot read each other’s replies', async () => {
    const worker = acquire()
    worker.mount('a', 'preview', {})
    worker.mount('b', 'preview', {})
    worker.onHostRequest('a', async () => ({ ok: true, body: 'from a' }))
    worker.onHostRequest('b', async () => ({ ok: true, body: 'from b' }))

    ask('b', 1)
    await settle()

    expect(replies()).toEqual([{ kind: 'tree:host-reply', slot: 'b', id: 1, ok: true, body: 'from b' }])
  })

  it('refuses a request for a tree nobody is showing, rather than leaving the sandbox waiting', async () => {
    acquire().mount('a', 'preview', {})
    ask('gone', 1)
    await settle()
    expect(replies()[0]?.error?.code).toBe('unmounted')
  })

  // The terminal case. It mounts remote trees and has no iframe to put an overlay in, so a plugin has
  // to be able to tell "denied" from "this host cannot".
  it('refuses when the host bound no handler for this slot', async () => {
    acquire().mount('a', 'preview', {})
    ask('a', 1)
    await settle()
    expect(replies()[0]?.error?.code).toBe('unsupported_host')
  })

  it('measures the payload before doing anything with it', async () => {
    const worker = acquire()
    worker.mount('a', 'preview', {})
    const handler = vi.fn(async (): Promise<TreeHostResult> => ({ ok: true, body: null }))
    worker.onHostRequest('a', handler)

    ask('a', 1, { blob: 'x'.repeat(TREE_LIMITS.hostRequestBytes + 1) })
    await settle()

    expect(replies()[0]?.error?.code).toBe('too_large')
    expect(handler).not.toHaveBeenCalled()
  })

  it('caps how many one tree may have outstanding', async () => {
    const worker = acquire()
    worker.mount('a', 'preview', {})
    // Never settles, so every request stays in flight.
    worker.onHostRequest('a', () => new Promise<TreeHostResult>(() => {}))

    for (let id = 1; id <= TREE_LIMITS.hostRequestsPerSlot + 1; id++) ask('a', id)
    await settle()

    expect(replies()).toHaveLength(1)
    expect(replies()[0]).toMatchObject({ id: TREE_LIMITS.hostRequestsPerSlot + 1, ok: false, error: { code: 'too_many' } })
  })

  it('gives up on an owner that never answers', async () => {
    vi.useFakeTimers()
    const worker = acquire()
    worker.mount('a', 'preview', {})
    worker.onHostRequest('a', () => new Promise<TreeHostResult>(() => {}))

    ask('a', 1)
    await vi.advanceTimersByTimeAsync(TREE_LIMITS.hostRequestMs + 1)

    expect(replies()[0]?.error?.code).toBe('timeout')
  })

  it('reports a handler that threw as a refusal rather than dropping it', async () => {
    const worker = acquire()
    worker.mount('a', 'preview', {})
    worker.onHostRequest('a', async () => { throw new Error('that attachment is no longer in this draft') })

    ask('a', 1)
    await settle()

    expect(replies()[0]).toMatchObject({ ok: false, error: { message: 'that attachment is no longer in this draft' } })
  })

  it('says nothing back once the tree has gone, and frees the slot’s budget with it', async () => {
    const worker = acquire()
    worker.mount('a', 'preview', {})
    let finish: (result: TreeHostResult) => void = () => {}
    worker.onHostRequest('a', () => new Promise<TreeHostResult>((resolve) => { finish = resolve }))

    ask('a', 1)
    await settle()
    worker.unmount('a')
    finish({ ok: true, body: 'too late' })
    await settle()

    expect(replies()).toHaveLength(0)
  })
})
