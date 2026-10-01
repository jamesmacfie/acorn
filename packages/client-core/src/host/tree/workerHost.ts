// Bundle module lifetime and mounted authority are separate owners. Modern SDKs share one worker;
// legacy SDKs share only an immutable authority context and have no idle authority retention.
import { PLUGIN_BRIDGE_VERSION, type PluginFrameContext } from '@acorn/protocol/plugin/bridge.ts'
import { TREE_LIMITS, batchBytes, sandboxMessage, type TreeHostOp, type TreeMutation } from '@acorn/protocol/tree/messages.ts'
import type { KitEvent } from '@acorn/protocol/tree/nodes.ts'
import type { FrameBridge } from '../frames/broker'
import type { TreeTransport } from './TreeHost'
export { treeAuthorityKey, treeModelAuthorityKey, treeDocumentGrant } from './bridgeAuthority'

export const pluginWorkerUrl = (hash: string): string => `/plugin-worker/${hash}.js`
const GRACE_MS = 30_000
const HEARTBEAT_MS = 10_000
const MAX_IDLE_WORKERS = 16
export type TreeHostRequest = { op: TreeHostOp; name: string; payload: unknown }
export type TreeHostResult = { ok: true; body: unknown } | { ok: false; error: { code: string; message: string } }
export type TreeWorkerHandle = {
  mount(slot: string, entry: string, props: unknown): void
  unmount(slot: string): void
  transport(slot: string): TreeTransport
  bridgePort(slot?: string): MessagePort | null
  onHostRequest(slot: string, handler: (request: TreeHostRequest) => Promise<TreeHostResult>): () => void
  release(): void
}
export type AcquireInput = {
  pluginId: string
  hash: string
  /** Host-minted immutable affinity; no slot ids or ambient rebinding. */
  authority?: string
  context?: PluginFrameContext
  hasFocus?(): boolean
  connect(port: MessagePort, hasFocus: () => boolean, legacyContext?: PluginFrameContext): FrameBridge
  onRefused(reason: string): void
}
type Owner = Omit<AcquireInput, 'hasFocus'>
type Lease = { owner: Owner; hasFocus: () => boolean; live: Live; slots: Set<string>; released: boolean; admitted: boolean }
type Slot = {
  lease: Lease
  batch: ((ops: readonly TreeMutation[]) => void)[]
  failed: ((message: string) => void)[]
  hostRequest: ((request: TreeHostRequest) => Promise<TreeHostResult>) | null
  inFlight: number
  pending: Set<() => void>
  bridge: FrameBridge | null
  bridgeSide: MessagePort | null
  mount: { entry: string; props: unknown } | null
  sent: boolean
  pendingMount: boolean
}
type Live = {
  key: string
  owner: Owner
  mode: 'detect' | 'modern' | 'legacy'
  worker: Worker
  port: MessagePort
  bootstrap: MessagePort
  bridge: FrameBridge | null
  slots: Map<string, Slot>
  leases: Set<Lease>
  grace: ReturnType<typeof setTimeout> | null
  beat: ReturnType<typeof setInterval> | null
  awaitingPong: boolean
  dead: boolean
  constructionReady: boolean
  treeReady: boolean
}
const workers = new Map<string, Live>()
const capabilities = new Map<string, 'modern' | 'legacy'>()
const slotCounts = new Map<string, number>()
const capacityUnits = new Map<string, number>()
let ownerSequence = 0
let spawn: (url: string) => Worker = (url) => new Worker(url, { type: 'module' })
export function _setWorkerFactory(factory: ((url: string) => Worker) | null): void {
  spawn = factory ?? ((url) => new Worker(url, { type: 'module' }))
}
const legacyKey = (owner: Owner): string => `${owner.hash}:${owner.authority ?? 'unscoped-test-owner'}`
const cleanup = (dispose: () => void): void => { try { dispose() } catch { /* finish retiring every owned resource */ } }
const retiredOwner = (owner: Owner): Owner => ({ pluginId: owner.pluginId, hash: owner.hash, connect: () => { throw new Error('retired owner') }, onRefused: () => {} })
const focus = (live: Live): boolean => [...live.leases].some((lease) => !lease.released && lease.hasFocus())

export function acquireTreeWorker(input: AcquireInput): TreeWorkerHandle {
  const admissions = capacityUnits.get(input.hash) ?? 0
  if (admissions >= TREE_LIMITS.slotsPerWorker) throw new Error(`${input.pluginId} asked for more than ${TREE_LIMITS.slotsPerWorker} tree owners at once`)
  // Do not retain the acquiring component's focus closure in the module/legacy context factory.
  const owner: Owner = { pluginId: input.pluginId, hash: input.hash, authority: input.authority ?? `isolated-owner:${++ownerSequence}`, context: input.context, connect: input.connect, onRefused: input.onRefused }
  // A classification hint may be evicted while its authority worker is still live. Prefer the
  // actual owner, and derive legacy mode from any live context of this hash before probing again.
  const existing = workers.get(input.hash) ?? workers.get(legacyKey(owner))
  const known = existing?.mode ?? (input.context ? capabilities.get(input.hash) : 'legacy')
    ?? ([...workers.values()].some((worker) => !worker.dead && worker.owner.hash === input.hash && worker.mode === 'legacy') ? 'legacy' : undefined)
  const key = known === 'legacy' ? legacyKey(owner) : input.hash
  const live = existing ?? workers.get(key) ?? start(owner, known ?? 'detect', key)
  const lease: Lease = { owner, hasFocus: input.hasFocus ?? (() => false), live, slots: new Set(), released: false, admitted: true }
  capacityUnits.set(input.hash, admissions + 1)
  live.leases.add(lease)
  if (live.grace) clearTimeout(live.grace)
  live.grace = null

  const slotFor = (id: string): Slot => {
    if (lease.released || lease.live.dead) throw new Error('this plugin tree owner was retired')
    const existing = lease.live.slots.get(id)
    if (existing) {
      if (existing.lease !== lease) throw new Error('this tree belongs to another mounted owner')
      return existing
    }
    const extra = lease.slots.size > 0
    const capacity = capacityUnits.get(lease.owner.hash) ?? 0
    if (extra && capacity >= TREE_LIMITS.slotsPerWorker) throw new Error(`${lease.owner.pluginId} asked for more than ${TREE_LIMITS.slotsPerWorker} trees at once`)
    const count = slotCounts.get(lease.owner.hash) ?? 0
    if (count >= TREE_LIMITS.slotsPerWorker) throw new Error(`${lease.owner.pluginId} asked for more than ${TREE_LIMITS.slotsPerWorker} trees at once`)
    const slot: Slot = { lease, batch: [], failed: [], hostRequest: null, inFlight: 0, pending: new Set(), bridge: null, bridgeSide: null, mount: null, sent: false, pendingMount: false }
    lease.live.slots.set(id, slot)
    lease.slots.add(id)
    slotCounts.set(lease.owner.hash, count + 1)
    if (extra) capacityUnits.set(lease.owner.hash, capacity + 1)
    return slot
  }
  return {
    mount(id, entry, props) {
      const slot = slotFor(id)
      slot.mount = { entry, props }
      slot.pendingMount = true
      sendMount(lease.live, id, slot)
    },
    unmount: (id) => retireSlot(lease.live, id, lease),
    bridgePort: (id) => lease.released || lease.live.dead ? null : lease.live.mode === 'legacy' ? lease.live.bootstrap : id ? lease.live.slots.get(id)?.bridgeSide ?? null : null,
    onHostRequest(id, handler) {
      const slot = slotFor(id)
      slot.hostRequest = handler
      return () => { if (slot.hostRequest === handler) slot.hostRequest = null }
    },
    transport: (id) => ({
      onBatch(listener) {
        const slot = slotFor(id)
        slot.batch.push(listener)
        return () => { const at = slot.batch.indexOf(listener); if (at >= 0) slot.batch.splice(at, 1) }
      },
      onFailed(listener) {
        if (lease.live.dead) { queueMicrotask(() => { if (!lease.released) listener('this plugin stopped responding') }); return () => {} }
        const slot = slotFor(id)
        slot.failed.push(listener)
        return () => { const at = slot.failed.indexOf(listener); if (at >= 0) slot.failed.splice(at, 1) }
      },
      send: (handler: number, event: KitEvent, payload: unknown) => {
        if (!lease.released && !lease.live.dead && lease.live.slots.get(id)?.lease === lease) {
          try { lease.live.port.postMessage({ kind: 'tree:event', slot: id, handler, event, payload }) }
          catch (error) { stop(lease.live, error instanceof Error ? error.message : String(error)) }
        }
      },
    }),
    release() {
      if (lease.released) return
      lease.released = true
      for (const id of [...lease.slots]) retireSlot(lease.live, id, lease)
      const current = lease.live
      current.leases.delete(lease)
      dropAdmission(lease)
      // Release the component's container reference even when a caller retains its retired handle.
      lease.hasFocus = () => false
      lease.owner = retiredOwner(lease.owner)
      if (!current.dead && current.mode === 'detect' && current.leases.size
        && ![...current.leases].some((other) => legacyKey(other.owner) === legacyKey(current.owner))) {
        rotateDetection(current)
        return
      }
      if (current.dead || current.leases.size) return
      if (current.mode !== 'modern') return stop(current, 'no authority leases left')
      current.grace = setTimeout(() => stop(current, 'no trees left'), GRACE_MS)
      // Refresh idle recency before deciding which idle module to evict.
      if (workers.get(current.key) === current) { workers.delete(current.key); workers.set(current.key, current) }
      const idle = [...workers.values()].filter((worker) => worker.mode === 'modern' && !worker.leases.size && !worker.dead)
      while (idle.length > MAX_IDLE_WORKERS) stop(idle.shift()!, 'idle plugin worker capacity')
    },
  }
}

function dropAdmission(lease: Lease): void {
  if (!lease.admitted) return
  lease.admitted = false
  const remaining = (capacityUnits.get(lease.owner.hash) ?? 1) - 1
  if (remaining) capacityUnits.set(lease.owner.hash, remaining)
  else capacityUnits.delete(lease.owner.hash)
}

function rotateDetection(live: Live): void {
  const next = live.leases.values().next().value as Lease
  const leases = [...live.leases]
  const slots = [...live.slots]
  live.leases.clear()
  live.slots.clear()
  // The TUI factory owns asynchronous termination and defers a replacement thread until it exits.
  stop(live, 'initial authority retired before classification')
  try {
    const replacement = start(next.owner, 'detect', live.owner.hash)
    for (const lease of leases) { lease.live = replacement; replacement.leases.add(lease) }
    for (const [id, slot] of slots) replacement.slots.set(id, slot)
  } catch (error) {
    for (const [id, slot] of slots) {
      live.slots.set(id, slot)
      for (const failed of slot.failed) cleanup(() => failed('plugin bootstrap replacement failed'))
      retireSlot(live, id, slot.lease)
    }
    for (const lease of leases) {
      cleanup(() => lease.owner.onRefused(String(error)))
      dropAdmission(lease)
      lease.owner = retiredOwner(lease.owner)
      lease.hasFocus = () => false
    }
  }
}

function retireSlot(live: Live, id: string, lease: Lease): void {
  const slot = live.slots.get(id)
  if (!slot || slot.lease !== lease) return
  live.slots.delete(id)
  if (lease.slots.size > 1) capacityUnits.set(lease.owner.hash, (capacityUnits.get(lease.owner.hash) ?? 1) - 1)
  lease.slots.delete(id)
  const remaining = (slotCounts.get(live.owner.hash) ?? 1) - 1
  if (remaining) slotCounts.set(live.owner.hash, remaining)
  else slotCounts.delete(live.owner.hash)
  for (const cancel of slot.pending) cancel()
  slot.pending.clear()
  slot.hostRequest = null
  slot.batch.length = 0
  slot.failed.length = 0
  if (slot.bridge) cleanup(() => slot.bridge!.dispose())
  slot.bridge = null
  slot.bridgeSide = null
  if (!live.dead && slot.sent) cleanup(() => live.port.postMessage({ kind: 'tree:unmount', slot: id }))
  slot.mount = null
}

function sendMount(live: Live, id: string, slot: Slot): void {
  if (live.dead || !live.constructionReady || live.mode === 'detect' || !slot.mount || !slot.pendingMount) return
  if (!live.treeReady && (live.mode === 'modern' || slot.sent)) return
  const message = { kind: 'tree:mount', slot: id, ...slot.mount }
  if (slot.sent || live.mode === 'legacy') {
    try { live.port.postMessage(message); slot.sent = true; slot.pendingMount = false }
    catch (error) { failMount(live, id, slot, error) }
    return
  }
  const channel = new MessageChannel()
  let bridge: FrameBridge | null = null
  try {
    bridge = slot.lease.owner.connect(channel.port1, slot.lease.hasFocus)
    live.port.postMessage({ ...message, slotBridge: 1 }, [channel.port2])
    slot.bridge = bridge
    slot.bridgeSide = channel.port1
    slot.sent = true
    slot.pendingMount = false
  } catch (error) {
    if (bridge) cleanup(() => bridge!.dispose())
    else cleanup(() => channel.port1.close())
    cleanup(() => channel.port2.close())
    failMount(live, id, slot, error)
  }
}

function failMount(live: Live, id: string, slot: Slot, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error)
  for (const failed of slot.failed) cleanup(() => failed(reason))
  cleanup(() => slot.lease.owner.onRefused(reason))
  retireSlot(live, id, slot.lease)
}

function classify(live: Live, mode: 'modern' | 'legacy'): void {
  if (live.dead || live.mode !== 'detect') return
  capabilities.delete(live.owner.hash)
  capabilities.set(live.owner.hash, mode)
  if (capabilities.size > 256) capabilities.delete(capabilities.keys().next().value!)
  live.mode = mode
  if (mode === 'legacy') {
    if (workers.get(live.key) === live) workers.delete(live.key)
    live.key = legacyKey(live.owner)
    workers.set(live.key, live)
    live.bridge = live.owner.connect(live.bootstrap, () => focus(live), live.owner.context)
    for (const lease of [...live.leases]) {
      if (legacyKey(lease.owner) === live.key) continue
      const key = legacyKey(lease.owner)
      const target = workers.get(key) ?? start(lease.owner, 'legacy', key)
      live.leases.delete(lease)
      target.leases.add(lease)
      lease.live = target
      for (const id of lease.slots) {
        const slot = live.slots.get(id)!
        live.slots.delete(id)
        target.slots.set(id, slot)
        sendMount(target, id, slot)
      }
    }
  }
  // Modern module lifetime must not retain the first mounted factory or its grants.
  if (mode === 'modern') live.owner = { ...retiredOwner(live.owner), onRefused: live.owner.onRefused }
  for (const [id, slot] of live.slots) sendMount(live, id, slot)
  if (!live.leases.size) stop(live, 'no authority leases left')
}

function start(owner: Owner, mode: Live['mode'], key: string): Live {
  let worker: Worker | null = null
  let bridgeChannel: MessageChannel | null = null
  let treeChannel: MessageChannel | null = null
  let live: Live | null = null
  try {
    worker = spawn(pluginWorkerUrl(owner.hash))
    bridgeChannel = new MessageChannel()
    treeChannel = new MessageChannel()
    const readiness = (worker as Worker & { ready?: Promise<void> }).ready
    const current: Live = { key, owner, mode, worker, port: treeChannel.port1, bootstrap: bridgeChannel.port1, bridge: null, slots: new Map(), leases: new Set(), grace: null, beat: null, awaitingPong: false, dead: false, constructionReady: !readiness, treeReady: false }
    live = current
    if (mode === 'legacy') current.bridge = owner.connect(current.bootstrap, () => focus(current), owner.context)
    else {
      const bootstrapMessage: MessagePort['onmessage'] = (event) => {
        if (current.dead) return
        const data = event.data as { kind?: string; treeSlotBridge?: number; id?: number }
        if (!data || typeof data !== 'object') return
        try {
          if (current.mode === 'detect') classify(current, data.kind === 'connected' && data.treeSlotBridge === 1 ? 'modern' : 'legacy')
          if (current.mode === 'legacy' && current.bootstrap.onmessage !== bootstrapMessage) current.bootstrap.onmessage?.(event)
          else if (typeof data.id === 'number') current.bootstrap.postMessage({ id: data.id, ok: false, error: { code: 'tree_bridge_required', message: 'tree operations use the bridge passed to this mount', retryable: false, requestId: '' } })
        } catch (error) { cleanup(() => current.owner.onRefused(String(error))); stop(current, 'plugin bridge setup failed') }
      }
      current.bootstrap.onmessage = bootstrapMessage
      current.bootstrap.start()
      // Metadata grants no API/document handles. Legacy connect().context sees the correct immutable
      // first context before its acknowledgement promotes this worker, without evaluating it twice.
      current.bootstrap.postMessage({ kind: 'ready', context: owner.context, treeBridgeMode: 'bootstrap' })
    }
    current.port.onmessage = (event) => handleTreeMessage(current, event)
    current.port.start()
    worker.onerror = (event: ErrorEvent | Event) => {
      if (current.dead || workers.get(current.key) !== current) return
      const reason = 'message' in event && typeof event.message === 'string' ? event.message : 'the plugin worker threw'
      cleanup(() => current.owner.onRefused(reason))
      stop(current, reason)
    }
    current.beat = setInterval(() => {
      if (current.dead || workers.get(current.key) !== current) return
      if (current.awaitingPong) return stop(current, 'this plugin stopped responding')
      current.awaitingPong = true
      // Construction waiting has the same two-beat deadline, without queueing traffic on a channel
      // whose transferred endpoint is still owned by a deferred native adapter.
      if (!current.constructionReady) return
      try { current.port.postMessage({ kind: 'tree:ping' }) }
      catch (error) { stop(current, error instanceof Error ? error.message : String(error)) }
    }, HEARTBEAT_MS)
    worker.postMessage({ acornBridge: PLUGIN_BRIDGE_VERSION, treeSlotBridge: mode === 'legacy' ? undefined : 1 }, [bridgeChannel.port2, treeChannel.port2])
    workers.set(key, current)
    if (mode === 'modern') current.owner = { ...retiredOwner(current.owner), onRefused: current.owner.onRefused }
    if (readiness) void readiness.then(() => {
      if (current.dead) return
      current.constructionReady = true
      current.awaitingPong = false
      for (const [id, slot] of current.slots) sendMount(current, id, slot)
    }).catch((error: unknown) => {
      if (current.dead) return
      cleanup(() => current.owner.onRefused(String(error)))
      stop(current, 'plugin worker construction failed')
    })
    return current
  } catch (error) {
    if (live?.beat) clearInterval(live.beat)
    if (live?.bridge) cleanup(() => live!.bridge!.dispose())
    else cleanup(() => bridgeChannel?.port1.close())
    cleanup(() => bridgeChannel?.port2.close())
    cleanup(() => treeChannel?.port1.close())
    cleanup(() => treeChannel?.port2.close())
    cleanup(() => worker?.terminate())
    throw error
  }
}

function handleTreeMessage(live: Live, event: MessageEvent): void {
  if (live.dead) return
  const parsed = sandboxMessage.safeParse(event.data)
  if (!parsed.success) return live.owner.onRefused(`sent a tree message the host could not read: ${parsed.error.issues[0]?.message ?? 'unknown'}`)
  const message = parsed.data
  if (!live.treeReady) {
    live.treeReady = true
    for (const [id, pending] of live.slots) sendMount(live, id, pending)
  }
  if (message.kind === 'tree:pong') { live.awaitingPong = false; return }
  if (message.kind === 'tree:ready') return
  const slot = live.slots.get(message.slot)
  if (message.kind === 'tree:failed') {
    for (const failed of slot?.failed ?? []) failed(message.message)
    live.owner.onRefused(`could not draw '${message.slot}': ${message.message}`)
    return
  }
  if (message.kind === 'tree:batch') {
    const bytes = message.bytes ?? batchBytes(message)
    if (bytes > TREE_LIMITS.batchBytes) return live.owner.onRefused(`dropped a ${bytes}-byte batch, over the ${TREE_LIMITS.batchBytes}-byte cap`)
    for (const listener of slot?.batch ?? []) listener(message.ops as readonly TreeMutation[])
    return
  }
  const deny = (code: string, reason: string): void => {
    live.port.postMessage({ kind: 'tree:host-reply', slot: message.slot, id: message.id, ok: false, error: { code, message: reason } })
  }
  if (!slot) return deny('unmounted', 'this tree is not mounted')
  if (batchBytes(message.payload ?? null) > TREE_LIMITS.hostRequestBytes) return deny('too_large', `a host request is capped at ${TREE_LIMITS.hostRequestBytes} bytes`)
  if (slot.inFlight >= TREE_LIMITS.hostRequestsPerSlot) return deny('too_many', `no more than ${TREE_LIMITS.hostRequestsPerSlot} host requests at once`)
  const handler = slot.hostRequest
  if (!handler) return deny('unsupported_host', 'this host does not answer tree requests')
  slot.inFlight++
  let settled = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const cancel = (): void => {
    if (settled) return
    settled = true
    slot.inFlight--
    slot.pending.delete(cancel)
    if (timer !== null) clearTimeout(timer)
  }
  const reply = (result: TreeHostResult): void => {
    if (settled) return
    cancel()
    // A reused slot id is a different owner, even when it exists in this generation's map.
    if (live.dead || live.slots.get(message.slot) !== slot) return
    live.port.postMessage({ kind: 'tree:host-reply', slot: message.slot, id: message.id, ...result })
  }
  slot.pending.add(cancel)
  if (message.op === 'owner.invoke') timer = setTimeout(() => reply({ ok: false, error: { code: 'timeout', message: 'the owner did not answer in time' } }), TREE_LIMITS.hostRequestMs)
  void Promise.resolve().then(() => {
    if (settled || live.dead || live.slots.get(message.slot) !== slot) return
    return handler({ op: message.op, name: message.name, payload: message.payload })
  }).then((result) => { if (result) reply(result) }).catch((error: unknown) => reply({ ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } }))
}

function stop(live: Live, reason: string): void {
  if (live.dead) return
  live.dead = true
  if (workers.get(live.key) === live) workers.delete(live.key)
  if (live.beat) clearInterval(live.beat)
  if (live.grace) clearTimeout(live.grace)
  live.beat = null
  live.grace = null
  // External failure listeners may throw. Retirement still reaches every owned handle.
  for (const [id, slot] of [...live.slots]) {
    for (const failed of slot.failed) { try { failed(reason) } catch { /* isolate callers */ } }
    retireSlot(live, id, slot.lease)
  }
  for (const lease of live.leases) {
    dropAdmission(lease)
    lease.hasFocus = () => false
    lease.owner = retiredOwner(lease.owner)
  }
  live.leases.clear()
  if (live.bridge) cleanup(() => live.bridge!.dispose())
  else { live.bootstrap.onmessage = null; cleanup(() => live.bootstrap.close()) }
  live.bridge = null
  live.port.onmessage = null
  cleanup(() => live.port.close())
  live.worker.onerror = null
  cleanup(() => live.worker.terminate())
  live.owner = retiredOwner(live.owner)
}

export function _stopAllTreeWorkers(): void {
  for (const live of [...workers.values()]) stop(live, 'the host stopped every plugin worker')
}
