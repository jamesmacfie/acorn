import { PLUGIN_BRIDGE_VERSION } from '@acorn/protocol/plugin/bridge.ts'
import type { AcornBridge } from './bridgeTypes'
import { attach, resetBridgePort } from './bridgePort'
import { acceptTreePort, acceptedTreePort, resetTreePort, runTreeChannel, type TreeRender } from './treeChannel'

const isHello = (data: unknown): boolean =>
  !!data && typeof data === 'object' && (data as { acornBridge?: unknown }).acornBridge === PLUGIN_BRIDGE_VERSION

/**
 * Wait for the host's handshake and return the bridge. Resolves once: a frame has exactly one port for
 * its lifetime, and a second call returns the same connection.
 */
export function connect(): Promise<AcornBridge> {
  connection ??= handshake()
  return connection
}

let connection: Promise<AcornBridge> | null = null

function handshake(): Promise<AcornBridge> {
  return new Promise<AcornBridge>((resolve, reject) => {
    const target = globalThis as unknown as {
      addEventListener?: (type: string, listener: (event: MessageEvent) => void) => void
      removeEventListener?: (type: string, listener: (event: MessageEvent) => void) => void
    }
    if (!target.addEventListener) return reject(new Error('acorn: no window to receive the bridge on'))

    const onWindowMessage = (event: MessageEvent) => {
      // Only the transferred port matters, so there's no origin check to get wrong: a message with no
      // port isn't the handshake, and the port is unforgeable.
      if (!isHello(event.data)) return
      const port = event.ports?.[0]
      if (!port) return
      target.removeEventListener?.('message', onWindowMessage)
      // A worker host transfers a second port beside the bridge's: the tree channel. A frame host
      // transfers one, so this is undefined there and `mountTree` refuses, which is the honest answer
      // for a bundle asking a rectangle to draw a tree.
      acceptTreePort(event.ports?.[1] ?? null)
      resolve(attach(port))
    }
    target.addEventListener('message', onWindowMessage)
  })
}

/**
 * Register this bundle's tree renderers and wait for the host to mount them.
 *
 * Keyed by entry name rather than the single callback the design sketched, because one worker serves
 * every tree its bundle contributes (a tool card per call, a section per tray) and the host has to say
 * which. The manifest's `contributions.extensions[].remote` names a key here; a name with no key is a
 * placeholder and a roster row, not a crash.
 *
 * ```ts
 * mountTree({ toolCard: solidTree(ToolCard) })
 * ```
 */
export function mountTree(renderers: Record<string, TreeRender>): void {
  void connect().then(() => {
    // `connect()` resolving means the hello has landed, so the answer is already known either way.
    // A surface with no tree channel is a rectangle, and saying so is more use than hanging.
    const port = acceptedTreePort()
    if (!port) throw new Error('acorn: mountTree needs a tree channel, and this surface has none')
    runTreeChannel(port, renderers)
  }).catch((error: unknown) => {
    console.error('[acorn] mountTree failed:', error)
  })
}

/** Test seam. `connect()` memoizes a per-frame connection, and a suite that asserts on one handshake
 * must not inherit the previous one's port. */
export function _resetConnection(): void {
  resetBridgePort()
  connection = null
  resetTreePort()
}
