// One Web Worker per accepted plugin bundle identity, and the lifecycle around it
// (docs/plugins.md § The tree contract § The sandbox: one worker per bundle).
//
// What the worker has: the plugin's bundle, whatever framework it brought, and a bridge per tree. What it
// does not have: a DOM, `fetch`, `importScripts` after boot, or any handle to another plugin's worker.
// The first two are the shell's CSP on the worker script's own response (app_scheme.rs); the last is
// arithmetic, since a worker is reached only through the port that created it.
//
// Trust is unchanged from the frame path. The bundle hash is what the device accepted, the prompt is
// the same prompt, and a withheld bundle mounts nothing. A worker is the same bytes with a different
// host, which is why nothing here asks a second question.
import { PLUGIN_BRIDGE_VERSION } from '@acorn/protocol/plugin/bridge.ts'
import type { PluginBridgeAppearance, PluginFrameContext } from '@acorn/protocol/plugin/bridge.ts'
import type { TreeMutation } from '@acorn/protocol/tree/messages.ts'
import { TREE_LIMITS, batchBytes, sandboxMessage, type TreeHostOp } from '@acorn/protocol/tree/messages.ts'
import type { KitEvent } from '@acorn/protocol/tree/nodes.ts'
import { postAppearance, postSelect, postSurfaceAction, type FrameBridge } from '../frames/broker'
import { createLogger } from '../../infra/telemetry/logger'
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

/** One thing a mounted tree asked the host for, already addressed: the slot is where it arrived, not
 *  something the sandbox named (@acorn/protocol/tree/messages.ts § TREE_HOST_OPS). */
export type TreeHostRequest = { op: TreeHostOp; name: string; payload: unknown }

/** What the owner of a mounted tree answers with. A code and a sentence on failure, never a host error:
 *  a contributor learns that its request was refused, not how this process is put together. */
export type TreeHostResult = { ok: true; body: unknown } | { ok: false; error: { code: string; message: string } }

export type TreeWorkerHandle = {
  /** Mount, or update: a second mount for the same slot is a props change, which is what keeps a tool
   *  card's redraw one message rather than a teardown. */
  mount(slot: string, entry: string, props: unknown, authority?: () => TreeSlotBridge): void
  unmount(slot: string): void
  transport(slot: string): TreeTransport
  /** The bundle's compatibility bridge. Modern tree effects use the per-slot bridge. */
  bridgePort(): MessagePort | null
  select(slot: string, item: string): void
  surfaceAction(slot: string, command: string): void
  appearance(slot: string, value: Omit<PluginBridgeAppearance, 'kind'>): void
  /**
   * Answer this slot's host requests. Returns the detach.
   *
   * Per slot rather than per worker, which is the point of routing these over the tree channel at all:
   * one worker draws every tree its bundle contributes, so only the slot says which mounted
   * contribution asked (../frames/sdk.ts § TreeMount.host).
   *
   * A slot with no handler denies every request, so a tree whose host cannot answer is told so rather
   * than left waiting.
   */
  onHostRequest(slot: string, handler: (request: TreeHostRequest) => Promise<TreeHostResult>): () => void
  release(): void
}

/** Host-owned bridge for one visible tree. The worker receives only its context and transferred port. */
export type TreeSlotBridge = {
  context: PluginFrameContext
  connect(port: MessagePort): FrameBridge
}

type Slot = {
  batch: ((ops: readonly TreeMutation[]) => void)[]
  failed: ((message: string) => void)[]
  /** The owner's answer to `TreeMount.host`, set by the component that drew this slot. */
  hostRequest: ((request: TreeHostRequest) => Promise<TreeHostResult>) | null
  /** Requests this slot has outstanding, against TREE_LIMITS.hostRequestsPerSlot. */
  inFlight: number
  mount: { entry: string; props: unknown } | null
  authority: TreeSlotBridge | null
  bridge: FrameBridge | null
  bridgeSide: MessagePort | null
  appearance: Omit<PluginBridgeAppearance, 'kind'> | null
}

type Live = {
  key: TreeWorkerKey
  worker: Worker
  port: MessagePort
  /** The other half of the handshake: the bridge's port, kept so `bridgePort()` can hand it out. */
  bridgeSide: MessagePort
  bridge: FrameBridge
  protocol: 'pending' | 'scoped' | 'legacy'
  legacySlot: string | null
  firstSlot: string | null
  slots: Map<string, Slot>
  refs: number
  grace: ReturnType<typeof setTimeout> | null
  beat: ReturnType<typeof setInterval> | null
  awaitingPong: boolean
  dead: boolean
  /** Tell every tree this worker was serving that it is gone. Set once, by `start`. */
  failEverything(reason: string): void
}

/** Content can be shared across plugins, but a bridge is authority granted to one plugin id. */
export type TreeWorkerKey = { pluginId: string; hash: string }

// JSON array encoding is unambiguous even when a plugin id contains punctuation. The worker URL and
// device cache remain hash-addressed; only the live authority uses this pair.
const workerKey = ({ pluginId, hash }: TreeWorkerKey): string => JSON.stringify([pluginId, hash])
const workers = new Map<string, Live>()

// The seam the jsdom suite spawns through: jsdom has no `Worker`, and a real one would need a real
// bundle on disk. Everything else in this file is exercised for real.
let spawn: (url: string) => Worker = (url) => new Worker(url, { type: 'module' })

export function _setWorkerFactory(factory: ((url: string) => Worker) | null): void {
  spawn = factory ?? ((url) => new Worker(url, { type: 'module' }))
}

export type AcquireInput = {
  pluginId: string
  /** The bundle this device accepted. Workers are shared only for the same plugin id and hash. */
  hash: string
  /** Bootstrap the bundle's compatibility bridge. It has no effects unless the SDK is legacy and its
   * first slot is mounted. Modern SDKs use the bridge supplied with each mount. */
  connect(port: MessagePort, authorized: () => boolean): FrameBridge
  /** A one-line reason something was refused, for the roster row. */
  onRefused(reason: string): void
}

export function acquireTreeWorker(input: AcquireInput): TreeWorkerHandle {
  const key: TreeWorkerKey = { pluginId: input.pluginId, hash: input.hash }
  const live = workers.get(workerKey(key)) ?? start(input, key)
  live.refs++
  if (live.grace) {
    clearTimeout(live.grace)
    live.grace = null
  }

  const slotFor = (id: string): Slot => {
    const existing = live.slots.get(id)
    if (existing) return existing
    if (live.slots.size >= TREE_LIMITS.slotsPerWorker) throw new Error(`${input.pluginId} asked for more than ${TREE_LIMITS.slotsPerWorker} trees at once`)
    const slot: Slot = { batch: [], failed: [], hostRequest: null, inFlight: 0, mount: null, authority: null, bridge: null, bridgeSide: null, appearance: null }
    live.slots.set(id, slot)
    live.firstSlot ??= id
    return slot
  }

  let released = false
  return {
    mount: (slot, entry, props, authority) => {
      const target = slotFor(slot)
      target.mount = { entry, props }
      target.authority ??= authority?.() ?? null
      if (!live.dead) sendMount(live, slot, target, input.onRefused)
    },
    unmount: (slot) => {
      const target = live.slots.get(slot)
      if (target) {
        target.bridge?.dispose()
        target.bridgeSide?.close()
        live.slots.delete(slot)
      }
      if (live.legacySlot === slot) live.legacySlot = null
      if (!live.dead) live.port.postMessage({ kind: 'tree:unmount', slot })
    },
    bridgePort: () => (live.dead ? null : live.bridgeSide),
    select: (slot, item) => {
      const port = live.slots.get(slot)?.bridgeSide ?? (live.legacySlot === slot ? live.bridgeSide : null)
      if (!live.dead && port) postSelect(port, item)
    },
    surfaceAction: (slot, command) => {
      const port = live.slots.get(slot)?.bridgeSide ?? (live.legacySlot === slot ? live.bridgeSide : null)
      if (!live.dead && port) postSurfaceAction(port, command)
    },
    appearance: (slot, value) => {
      const target = live.slots.get(slot)
      if (!target || live.dead) return
      target.appearance = value
      const port = target.bridgeSide ?? (live.legacySlot === slot ? live.bridgeSide : null)
      if (port) postAppearance(port, value)
    },
    onHostRequest: (slot, handler) => {
      const target = slotFor(slot)
      target.hostRequest = handler
      return () => {
        if (target.hostRequest === handler) target.hostRequest = null
      }
    },
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
      if (live.dead) return
      if (--live.refs > 0) return
      // Not stopped on the spot: a reader scrolling a transcript unmounts and remounts these
      // constantly, and restarting a bundle per scroll is how a tool card becomes a stutter.
      //
      // The timer names this worker, not just its key. A handle outlives the worker it was taken from — the
      // bundle stops answering, the host stops it, and the next tree starts a fresh one under the same
      // key — so a late release from the old generation was arming a timer that stopped the new
      // worker thirty seconds later and told every tree on it there were no trees left.
      live.grace = setTimeout(() => {
        stop(key, 'no trees left', live)
      }, GRACE_MS)
    },
  }
}

function sendMount(live: Live, id: string, slot: Slot, onRefused: (reason: string) => void): void {
  if (!slot.mount || live.protocol === 'pending') return
  if (live.protocol === 'legacy') {
    // An old SDK has one unaddressed bridge. Only the first slot may use it. Once that slot goes away,
    // this worker cannot be rebound to a different component's services safely.
    if (id !== live.firstSlot || (live.legacySlot && live.legacySlot !== id)) {
      const reason = 'this plugin bundle uses an older tree SDK and can draw only one tree at a time'
      for (const listener of slot.failed) listener(reason)
      onRefused(reason)
      return
    }
    const firstMount = live.legacySlot !== id
    live.legacySlot = id
    if (firstMount && slot.authority) live.bridge.setContext?.(slot.authority.context)
    if (firstMount && slot.appearance) postAppearance(live.bridgeSide, slot.appearance)
    live.port.postMessage({ kind: 'tree:mount', slot: id, ...slot.mount })
    return
  }
  if (!slot.authority) {
    const reason = 'this tree has no mounted bridge authority'
    for (const listener of slot.failed) listener(reason)
    onRefused(reason)
    return
  }
  if (!slot.bridgeSide) {
    const channel = new MessageChannel()
    slot.bridgeSide = channel.port1
    slot.bridge = slot.authority.connect(channel.port1)
    if (slot.appearance) postAppearance(channel.port1, slot.appearance)
    live.port.postMessage({
      kind: 'tree:mount', slot: id, ...slot.mount,
      context: slot.authority.context, bridgePort: channel.port2,
    }, [channel.port2])
    return
  }
  live.port.postMessage({ kind: 'tree:mount', slot: id, ...slot.mount })
}

function start(input: AcquireInput, key: TreeWorkerKey): Live {
  const log = createLogger('plugins', input.pluginId)
  const worker = spawn(pluginWorkerUrl(input.hash))
  const bridgeChannel = new MessageChannel()
  const treeChannel = new MessageChannel()
  const live: Live = {
    key,
    worker,
    port: treeChannel.port1,
    bridgeSide: bridgeChannel.port1,
    bridge: null as unknown as FrameBridge,
    protocol: 'pending',
    legacySlot: null,
    firstSlot: null,
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
  live.bridge = input.connect(bridgeChannel.port1, () => live.protocol === 'legacy' && live.legacySlot !== null && live.slots.has(live.legacySlot))
  workers.set(workerKey(key), live)

  live.port.onmessage = (event: MessageEvent) => {
    const parsed = sandboxMessage.safeParse(event.data)
    if (!parsed.success) return input.onRefused(`sent a tree message the host could not read: ${parsed.error.issues[0]?.message ?? 'unknown'}`)
    const message = parsed.data
    switch (message.kind) {
      case 'tree:pong':
        live.awaitingPong = false
        return
      case 'tree:ready':
        if (live.protocol !== 'pending') return
        live.protocol = message.scopedBridge ? 'scoped' : 'legacy'
        for (const [id, slot] of live.slots) sendMount(live, id, slot, input.onRefused)
        return
      case 'tree:failed': {
        const slot = live.slots.get(message.slot)
        for (const listener of slot?.failed ?? []) listener(message.message)
        return input.onRefused(`could not draw '${message.slot}': ${message.message}`)
      }
      case 'tree:host-request': {
        const slot = live.slots.get(message.slot)
        const deny = (code: string, reason: string): void => {
          if (!live.dead) live.port.postMessage({ kind: 'tree:host-reply', slot: message.slot, id: message.id, ok: false, error: { code, message: reason } })
        }
        // A request for a tree nobody is showing any more. Unmount and a request in flight cross
        // constantly, and it is not a fault, but the sandbox is waiting on a promise either way.
        if (!slot) return deny('unmounted', 'this tree is not mounted')
        // Measured before anything is done with it. `payload` is `unknown` on the wire, so this is the
        // only place its size is a question at all.
        const size = batchBytes(message.payload ?? null)
        if (size > TREE_LIMITS.hostRequestBytes) {
          return deny('too_large', `a host request is capped at ${TREE_LIMITS.hostRequestBytes} bytes`)
        }
        if (slot.inFlight >= TREE_LIMITS.hostRequestsPerSlot) {
          return deny('too_many', `no more than ${TREE_LIMITS.hostRequestsPerSlot} host requests at once`)
        }
        const handler = slot.hostRequest
        if (!handler) return deny('unsupported_host', 'this host does not answer tree requests')
        slot.inFlight++
        // A deadline on the owner rather than on the sandbox: the owner is code in this process, so a
        // handler that never settles is a stuck promise, and the tree would wait on it forever.
        let settled = false
        const reply = (result: TreeHostResult): void => {
          if (settled) return
          settled = true
          slot.inFlight--
          // The slot going away mid-request is the ordinary case, not an error: the sandbox rejects its
          // own copy on unmount, so there is nobody left to tell.
          if (live.dead || live.slots.get(message.slot) !== slot) return
          live.port.postMessage({ kind: 'tree:host-reply', slot: message.slot, id: message.id, ...result })
        }
        // `owner.invoke` only. An overlay is settled by a person closing a modal, and ten seconds is
        // not how long somebody takes to crop an image: the deadline was rejecting the sandbox's
        // promise while the editor was still open, so the edit the reader then applied came back to a
        // caller that had already given up and showed them a timeout instead.
        //
        // Nothing hangs without it. Every dismissal path goes through one `clear()`, and the tree
        // unmounting dismisses what it opened (../frames/overlays.ts), so the invocation always
        // settles; the sandbox rejects its own copy on unmount too (../frames/sdk.ts § drop).
        const timer = message.op === 'owner.invoke'
          ? setTimeout(
              () => reply({ ok: false, error: { code: 'timeout', message: 'the owner did not answer in time' } }),
              TREE_LIMITS.hostRequestMs,
            )
          : null
        void handler({ op: message.op, name: message.name, payload: message.payload })
          .then((result) => reply(result))
          .catch((error: unknown) => reply({ ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } }))
          .finally(() => { if (timer !== null) clearTimeout(timer) })
        return
      }
      case 'tree:batch': {
        // The sandbox's own measurement, taken before it posted. Falls back to measuring here only for
        // a bundle built before `bytes` existed (@acorn/protocol/tree/messages.ts says why trusting it
        // gives a hostile bundle nothing).
        const bytes = message.bytes ?? batchBytes(message)
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
    stop(key, message, live)
  }

  live.beat = setInterval(() => {
    if (live.awaitingPong) {
      const reason = 'this plugin stopped responding'
      log.warn(reason, undefined, { 'plugin.id': input.pluginId })
      return stop(key, reason, live)
    }
    live.awaitingPong = true
    live.port.postMessage({ kind: 'tree:ping' })
  }, HEARTBEAT_MS)

  return live
}

function stop(key: TreeWorkerKey, reason: string, expected?: Live): void {
  const id = workerKey(key)
  const live = workers.get(id)
  if (!live || live.dead || (expected && live !== expected)) return
  live.dead = true
  workers.delete(id)
  if (live.beat) clearInterval(live.beat)
  if (live.grace) clearTimeout(live.grace)
  try {
    live.failEverything(reason)
  } finally {
    try {
      for (const slot of live.slots.values()) {
        slot.bridge?.dispose()
        slot.bridgeSide?.close()
      }
      live.bridge.dispose()
    } finally {
      live.bridgeSide.close()
      live.port.onmessage = null
      live.port.close()
      live.worker.terminate()
    }
  }
}

/** Withdraw this exact plugin bundle's runtime authority now, including during its idle grace. */
export function stopTreeWorker(key: TreeWorkerKey, reason: string): void {
  stop(key, reason)
}

/** Test seam, and the teardown a node switch would want: stop every worker now. */
export function _stopAllTreeWorkers(): void {
  for (const live of [...workers.values()]) stop(live.key, 'the host stopped every plugin worker', live)
}
