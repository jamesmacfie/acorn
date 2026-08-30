// One Web Worker per plugin bundle, and the lifecycle around it (docs/plugins.md § The tree contract
// § The sandbox: one worker per bundle).
//
// What the worker has: the plugin's bundle, whatever framework it brought, and the bridge. What it
// does not have: a DOM, `fetch`, `importScripts` after boot, or any handle to another plugin's worker.
// The first two are the shell's CSP on the worker script's own response (app_scheme.rs); the last is
// arithmetic, since a worker is reached only through the port that created it.
//
// Trust is unchanged from the frame path. The bundle hash is what the device accepted, the prompt is
// the same prompt, and a withheld bundle mounts nothing. A worker is the same bytes with a different
// host, which is why nothing here asks a second question.
import { PLUGIN_BRIDGE_VERSION } from '@acorn/protocol/plugin/bridge.ts'
import type { TreeMutation } from '@acorn/protocol/tree/messages.ts'
import { TREE_LIMITS, batchBytes, sandboxMessage } from '@acorn/protocol/tree/messages.ts'
import type { KitEvent } from '@acorn/protocol/tree/nodes.ts'
import type { FrameBridge } from '../frames/broker'
import type { TreeTransport } from './TreeHost'

/**
 * Where the worker script comes from: the shell's own origin, serving the same content-addressed
 * bundle the plugin scheme serves as `/client.js`.
 *
 * It cannot be `app-plugin://<hash>/client.js`, however much that would suit: a worker script must be
 * same-origin with the document that starts it, and the plugin scheme is a different origin by design.
 * So the shell serves the identical bytes at its own origin under a policy that gives them nothing —
 * see `app_scheme.rs`, `is_plugin_worker`.
 */
export const pluginWorkerUrl = (hash: string): string => `/plugin-worker/${hash}.js`

/** How long a worker with no live tree is kept before it is stopped. Long enough that scrolling a
 *  transcript past the last of a plugin's tool cards and back does not restart it. */
const GRACE_MS = 30_000

/** Ping cadence, and how long a worker has to answer before it is treated as gone. */
const HEARTBEAT_MS = 10_000

export type TreeWorkerHandle = {
  /** Mount, or update: a second mount for the same slot is a props change, which is what keeps a tool
   *  card's redraw one message rather than a teardown. */
  mount(slot: string, entry: string, props: unknown): void
  unmount(slot: string): void
  transport(slot: string): TreeTransport
  /**
   * The bridge port this bundle is connected on, for the three host-to-plugin pushes that are not tree
   * mutations: a rail-row selection, a surface-scoped command, an appearance change (frames/broker.ts).
   *
   * One port per bundle, not per tree, because one worker holds one bridge. That is why the pushes
   * carry their own addressing and the plugin's own listener decides whether the message was for the
   * tree it drew — the same re-check a frame does, one rung up.
   */
  bridgePort(): MessagePort | null
  release(): void
}

type Slot = {
  batch: ((ops: readonly TreeMutation[]) => void)[]
  failed: ((message: string) => void)[]
}

type Live = {
  worker: Worker
  port: MessagePort
  /** The other half of the handshake: the bridge's port, kept so `bridgePort()` can hand it out. */
  bridgeSide: MessagePort
  bridge: FrameBridge
  slots: Map<string, Slot>
  refs: number
  grace: ReturnType<typeof setTimeout> | null
  beat: ReturnType<typeof setInterval> | null
  awaitingPong: boolean
  dead: boolean
  /** Tell every tree this worker was serving that it is gone. Set once, by `start`. */
  failEverything(reason: string): void
}

const workers = new Map<string, Live>()

// The seam the jsdom suite spawns through: jsdom has no `Worker`, and a real one would need a real
// bundle on disk. Everything else in this file is exercised for real.
let spawn: (url: string) => Worker = (url) => new Worker(url, { type: 'module' })

export function _setWorkerFactory(factory: ((url: string) => Worker) | null): void {
  spawn = factory ?? ((url) => new Worker(url, { type: 'module' }))
}

export type AcquireInput = {
  pluginId: string
  /** The bundle this device accepted. One worker per hash, so two plugins never share one and one
   *  plugin's two versions never do either. */
  hash: string
  /** Wire the bridge onto the worker's port. Called once per worker, by whichever tree mounts first;
   *  every later tree from the same bundle rides the same bridge, exactly as two frames of one plugin
   *  each ride their own. */
  connect(port: MessagePort): FrameBridge
  /** A one-line reason something was refused, for the roster row. */
  onRefused(reason: string): void
}

export function acquireTreeWorker(input: AcquireInput): TreeWorkerHandle {
  const live = workers.get(input.hash) ?? start(input)
  live.refs++
  if (live.grace) {
    clearTimeout(live.grace)
    live.grace = null
  }

  const slotFor = (id: string): Slot => {
    const existing = live.slots.get(id)
    if (existing) return existing
    if (live.slots.size >= TREE_LIMITS.slotsPerWorker) throw new Error(`${input.pluginId} asked for more than ${TREE_LIMITS.slotsPerWorker} trees at once`)
    const slot: Slot = { batch: [], failed: [] }
    live.slots.set(id, slot)
    return slot
  }

  let released = false
  return {
    mount: (slot, entry, props) => {
      slotFor(slot)
      if (!live.dead) live.port.postMessage({ kind: 'tree:mount', slot, entry, props })
    },
    unmount: (slot) => {
      live.slots.delete(slot)
      if (!live.dead) live.port.postMessage({ kind: 'tree:unmount', slot })
    },
    bridgePort: () => (live.dead ? null : live.bridgeSide),
    transport: (slot) => ({
      onBatch: (listener) => {
        const target = slotFor(slot)
        target.batch.push(listener)
        return () => { target.batch.splice(target.batch.indexOf(listener), 1) }
      },
      onFailed: (listener) => {
        const target = slotFor(slot)
        // A worker that died before this tree subscribed still has to reach it, or the reader gets a
        // blank card with nothing to say why.
        if (live.dead) queueMicrotask(() => listener('this plugin stopped responding'))
        target.failed.push(listener)
        return () => { target.failed.splice(target.failed.indexOf(listener), 1) }
      },
      send: (handler: number, event: KitEvent, payload: unknown) => {
        if (!live.dead) live.port.postMessage({ kind: 'tree:event', slot, handler, event, payload })
      },
    }),
    release: () => {
      if (released) return
      released = true
      if (--live.refs > 0) return
      // Not stopped on the spot: a reader scrolling a transcript unmounts and remounts these
      // constantly, and restarting a bundle per scroll is how a tool card becomes a stutter.
      live.grace = setTimeout(() => stop(input.hash, 'no trees left'), GRACE_MS)
    },
  }
}

function start(input: AcquireInput): Live {
  const worker = spawn(pluginWorkerUrl(input.hash))
  const bridgeChannel = new MessageChannel()
  const treeChannel = new MessageChannel()
  const live: Live = {
    worker,
    port: treeChannel.port1,
    bridgeSide: bridgeChannel.port1,
    bridge: input.connect(bridgeChannel.port1),
    slots: new Map(),
    refs: 0,
    grace: null,
    beat: null,
    awaitingPong: false,
    dead: false,
    failEverything: (reason) => {
      for (const slot of live.slots.values()) for (const listener of slot.failed) listener(reason)
    },
  }
  workers.set(input.hash, live)

  live.port.onmessage = (event: MessageEvent) => {
    const parsed = sandboxMessage.safeParse(event.data)
    if (!parsed.success) return input.onRefused(`sent a tree message the host could not read: ${parsed.error.issues[0]?.message ?? 'unknown'}`)
    const message = parsed.data
    switch (message.kind) {
      case 'tree:pong':
        live.awaitingPong = false
        return
      case 'tree:ready':
        return
      case 'tree:failed': {
        const slot = live.slots.get(message.slot)
        for (const listener of slot?.failed ?? []) listener(message.message)
        return input.onRefused(`could not draw '${message.slot}': ${message.message}`)
      }
      case 'tree:batch': {
        const bytes = batchBytes(message)
        if (bytes > TREE_LIMITS.batchBytes) return input.onRefused(`dropped a ${bytes}-byte batch, over the ${TREE_LIMITS.batchBytes}-byte cap`)
        const slot = live.slots.get(message.slot)
        // A batch for a tree nobody is showing any more. Dropped silently: unmount and a batch in
        // flight cross constantly, and it is not a fault.
        if (!slot) return
        for (const listener of slot.batch) listener(message.ops as readonly TreeMutation[])
        return
      }
    }
  }
  live.port.start()

  // The handshake: the same hello a frame gets, with a second port. `sdk.ts`'s `connect()` takes the
  // first and `mountTree` takes the second, so one bundle can be a rectangle here and a tree there
  // without knowing which it was loaded as.
  worker.postMessage({ acornBridge: PLUGIN_BRIDGE_VERSION }, [bridgeChannel.port2, treeChannel.port2])

  worker.onerror = (event: ErrorEvent | Event) => {
    const message = 'message' in event && typeof event.message === 'string' ? event.message : 'the plugin worker threw'
    input.onRefused(message)
    stop(input.hash, message)
  }

  live.beat = setInterval(() => {
    if (live.awaitingPong) return stop(input.hash, 'this plugin stopped responding')
    live.awaitingPong = true
    live.port.postMessage({ kind: 'tree:ping' })
  }, HEARTBEAT_MS)

  return live
}

function stop(hash: string, reason: string): void {
  const live = workers.get(hash)
  if (!live || live.dead) return
  live.dead = true
  workers.delete(hash)
  if (live.beat) clearInterval(live.beat)
  if (live.grace) clearTimeout(live.grace)
  live.failEverything(reason)
  live.bridge.dispose()
  live.port.onmessage = null
  live.port.close()
  live.worker.terminate()
}

/** Test seam, and the teardown a node switch would want: stop every worker now. */
export function _stopAllTreeWorkers(): void {
  for (const hash of [...workers.keys()]) stop(hash, 'the host stopped every plugin worker')
}
