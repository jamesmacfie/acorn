import { TREE_PROTOCOL_VERSION } from '@acorn/protocol/tree/nodes.ts'
import { AcornBridgeError, type AcornBridge } from './bridgeTypes'
import { attach, disposeBridgePort } from './bridgePort'
import { createRemoteRoot, type RemoteRoot } from '../remoteRoot'

// ── The tree path ─────────────────────────────────────────────────────────────────────────────────
//
// The second render path (docs/plugins.md § The tree contract). Same bundle, same bridge, same
// sandbox rules; what differs is that the code emits a tree of kit node names instead of pixels, and
// the host mounts its own components for them.
//
// Framework-free like the rest of this file. The Solid adapter is `acorn-plugin-sdk/remote`.

/** What the host handed this slot, and how to hear about it changing. */
export type TreeMount = {
  /** Which renderer the host asked for, so one bundle can serve several. */
  readonly entry: string
  /** The remote root to draw into. */
  readonly root: RemoteRoot
  /** The props the host mounted with. A snapshot; `onProps` carries every later one. */
  props(): unknown
  /** The host re-mounted this slot with new props. Register before you render. */
  onProps(listener: (props: unknown) => void): void
  /** Your teardown, run when the host unmounts this slot. */
  onUnmount(dispose: () => void): void
  /**
   * The two things a tree may ask the host for, as opposed to describe to it.
   *
   * On the mount rather than on the bridge because these calls address the extension point owner.
   * They ride the tree channel with the host-minted slot. API, state, UI, and document calls use this
   * mount's own bridge port, which carries the same slot authority by possession.
   *
   * Both reject with an `AcornBridgeError` carrying a code. Neither takes a plugin, point or slot id;
   * there is nothing here to forge.
   */
  readonly host: {
    /**
     * Call one action the owning extension point declared and this slot's owner bound
     * (docs/plugins.md § Asking the owner).
     *
     * The owner's answer to a request, not a setter: a tree asks the composer to replace an attachment
     * and the composer decides whether to. Payload and result are JSON under 64 KiB, and eight may be
     * outstanding at once.
     */
    invoke<TResult = unknown>(action: string, payload?: unknown): Promise<TResult>
    /**
     * Present the one overlay this contribution's own manifest descriptor associated, and wait for it
     * (docs/plugins.md § Companion overlays).
     *
     * Resolves with whatever the overlay passed to `bridge.ui.close(result)`, or `null` for every
     * dismissal: Escape, the backdrop, the close button, this tree unmounting, another overlay opening.
     * `overlayId` must be the name the descriptor declared; anything else is denied rather than opened.
     *
     * A person's act. The host accepts it only while focus is inside this tree, and at most once a
     * second, so a bundle cannot put a modal in front of a reader from a timer. A host with no overlay
     * frames at all, which is what a terminal is, rejects with `unsupported_host`; draw your static
     * fallback and carry on.
     */
    openOverlay<TResult = unknown>(overlayId: string, input?: unknown): Promise<TResult | null>
  }
}

export type TreeRender = (bridge: AcornBridge, mount: TreeMount) => void

let treePort: MessagePort | null = null
// Whether the host's hello has landed. Load-bearing on its own: a frame's hello carries one port, so
// `treePort` stays null forever there, and without this flag `mountTree` would wait on a message that
// has already been and gone.
let helloSeen = false

export function acceptTreePort(port: MessagePort | null): void {
  treePort = port
  helloSeen = true
}

export function resetTreePort(): void {
  treePort = null
  helloSeen = false
}

export function acceptedTreePort(): MessagePort | null {
  return helloSeen ? treePort : null
}

type Pending = { resolve(value: unknown): void; reject(error: unknown): void }

type MountedSlot = {
  root: RemoteRoot
  props: unknown
  onProps: ((props: unknown) => void)[]
  dispose: (() => void)[]
  /** Host requests this slot is waiting on, by request id (`TreeMount.host`). */
  pending: Map<number, Pending>
  bridgePort: MessagePort
}

export function runTreeChannel(port: MessagePort, renderers: Record<string, TreeRender>): void {
  const slots = new Map<string, MountedSlot>()
  // One sequence for the whole channel, and a pending map per slot. The host quotes the id back beside
  // the slot it arrived on, so two trees can have a request in flight under the same number and neither
  // can settle the other's.
  let requestSeq = 0

  const drop = (id: string): void => {
    const slot = slots.get(id)
    if (!slot) return
    slots.delete(id)
    // Rejected rather than left hanging. The host rejects its own copy on unmount too, but a bundle
    // whose worker outlives one slot would otherwise hold a promise nobody will ever settle.
    for (const waiter of slot.pending.values()) {
      waiter.reject(new AcornBridgeError({ code: 'unmounted', message: 'the host unmounted this tree', retryable: false, requestId: '' }))
    }
    slot.pending.clear()
    for (const dispose of slot.dispose) {
      try { dispose() } catch (error) { console.error('[acorn] tree teardown threw:', error) }
    }
    slot.root.dispose()
    disposeBridgePort(slot.bridgePort)
  }

  const ask = <T>(slotId: string, op: 'owner.invoke' | 'overlay.open', name: string, payload: unknown): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const slot = slots.get(slotId)
      if (!slot) {
        reject(new AcornBridgeError({ code: 'unmounted', message: 'this tree is not mounted', retryable: false, requestId: '' }))
        return
      }
      const id = ++requestSeq
      slot.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      port.postMessage({ kind: 'tree:host-request', slot: slotId, id, op, name, ...(payload === undefined ? {} : { payload }) })
    })

  const mount = (id: string, entry: string, props: unknown, bridgePort?: MessagePort): void => {
    const existing = slots.get(id)
    if (existing) {
      existing.props = props
      for (const listener of existing.onProps) listener(props)
      return
    }
    const render = renderers[entry]
    if (!render) {
      port.postMessage({ kind: 'tree:failed', slot: id, message: `no renderer named '${entry}'` })
      return
    }
    if (!bridgePort || typeof bridgePort.postMessage !== 'function') {
      port.postMessage({ kind: 'tree:failed', slot: id, message: 'this tree has no scoped bridge' })
      return
    }
    const slot: MountedSlot = {
      // Measured here, on the sandbox's own thread, and declared on the message. The host used to
      // stringify every batch again to check it against the cap, on the thread that also has to draw
      // (docs/plugins.md § The tree contract).
      //
      // Spelled out rather than imported from @acorn/protocol/tree/messages.ts, which is the same three
      // lines: that module pulls zod in, and nothing this file imports may reach a stranger's bundle
      // (tools/arch/boundaries.test.ts).
      root: createRemoteRoot((ops) => {
        const message = { kind: 'tree:batch', slot: id, ops }
        let bytes: number | null = null
        try {
          bytes = new TextEncoder().encode(JSON.stringify(message)).byteLength
        } catch {
          // A cycle or a BigInt somewhere in the props. Post it without a measurement and let the host
          // fail the same way it did before this field existed.
        }
        port.postMessage(bytes === null ? message : { ...message, bytes })
      }),
      props,
      onProps: [],
      dispose: [],
      pending: new Map(),
      bridgePort,
    }
    slots.set(id, slot)
    void attach(bridgePort).then((bridge) => {
      if (slots.get(id) !== slot) return
      try {
        render(bridge, {
          entry,
          root: slot.root,
          props: () => slot.props,
          onProps: (listener) => slot.onProps.push(listener),
          onUnmount: (dispose) => slot.dispose.push(dispose),
          host: {
            invoke: <TResult,>(action: string, payload?: unknown) => ask<TResult>(id, 'owner.invoke', action, payload),
            openOverlay: <TResult,>(overlayId: string, input?: unknown) => ask<TResult | null>(id, 'overlay.open', overlayId, input),
          },
        })
      } catch (error: unknown) {
        drop(id)
        port.postMessage({ kind: 'tree:failed', slot: id, message: error instanceof Error ? error.message : String(error) })
      }
    }).catch((error: unknown) => {
      if (slots.get(id) !== slot) return
      drop(id)
      port.postMessage({ kind: 'tree:failed', slot: id, message: error instanceof Error ? error.message : String(error) })
    })
  }

  port.onmessage = (event: MessageEvent) => {
    const message = event.data as { kind?: string; slot?: string; entry?: string; props?: unknown; handler?: number; payload?: unknown; bridgePort?: MessagePort }
    if (!message || typeof message !== 'object') return
    switch (message.kind) {
      case 'tree:mount':
        if (typeof message.slot === 'string' && typeof message.entry === 'string') mount(message.slot, message.entry, message.props, message.bridgePort)
        return
      case 'tree:unmount':
        if (typeof message.slot === 'string') drop(message.slot)
        return
      case 'tree:event': {
        // The handler id is the sandbox's own; the host only ever quotes one back. An id the sandbox
        // has forgotten is a stale click on a torn-down node, which is nothing.
        const slot = typeof message.slot === 'string' ? slots.get(message.slot) : undefined
        if (slot && typeof message.handler === 'number') slot.root.dispatch(message.handler, message.payload)
        return
      }
      case 'tree:host-reply': {
        const slot = typeof message.slot === 'string' ? slots.get(message.slot) : undefined
        const reply = message as unknown as { id?: number; ok?: boolean; body?: unknown; error?: { code: string; message: string } }
        if (!slot || typeof reply.id !== 'number') return
        const waiter = slot.pending.get(reply.id)
        // An id this slot has forgotten is a reply to a request it already gave up on, which is nothing.
        if (!waiter) return
        slot.pending.delete(reply.id)
        if (reply.ok) waiter.resolve(reply.body)
        else {
          waiter.reject(new AcornBridgeError({
            code: reply.error?.code ?? 'internal',
            message: reply.error?.message ?? 'the host refused this request',
            retryable: false,
            requestId: '',
          }))
        }
        return
      }
      case 'tree:ping':
        port.postMessage({ kind: 'tree:pong' })
        return
    }
  }
  port.start?.()
  port.postMessage({ kind: 'tree:ready', version: TREE_PROTOCOL_VERSION, entries: Object.keys(renderers), scopedBridge: true })
}
