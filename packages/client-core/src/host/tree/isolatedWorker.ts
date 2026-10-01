// A tree bundle runs in a Worker created by a host-owned document at the bundle's plugin origin.
// The renderer never evaluates plugin bytes at app://acorn, including during startup or failure.
import { PLUGIN_BRIDGE_VERSION } from '@acorn/protocol/plugin/bridge.ts'

export type TreeSandbox = {
  postMessage(message: { acornBridge: typeof PLUGIN_BRIDGE_VERSION; treeSlotBridge?: 1 }, transfer: Transferable[]): void
  terminate(): void
  onerror: ((event: ErrorEvent) => void) | null
}

const RELAY_DEADLINE_MS = 10_000
const HASH = /^[0-9a-f]{64}$/

export const pluginTreeRelayOrigin = (hash: string, rendererOrigin = globalThis.location?.origin): string => {
  if (!HASH.test(hash)) throw new Error('invalid plugin bundle hash')
  if (rendererOrigin === 'http://app.localhost') return `http://app-plugin.${hash}`
  if (rendererOrigin === 'https://app.localhost') return `https://app-plugin.${hash}`
  if (rendererOrigin && rendererOrigin !== 'app://acorn') throw new Error('unknown renderer origin for a plugin worker')
  return `app-plugin://${hash}`
}

export const pluginTreeRelayUrl = (hash: string, nonce: string): string => {
  if (!HASH.test(hash)) throw new Error('invalid plugin bundle hash')
  return `app-plugin://${hash}/worker.html#${nonce}`
}

/** Worker-shaped host handle. Only the relay window can receive the initial ports. */
export function createIsolatedTreeWorker(hash: string, rendererOrigin = globalThis.location?.origin): TreeSandbox {
  const origin = pluginTreeRelayOrigin(hash, rendererOrigin)
  const nonce = crypto.randomUUID()
  const frame = document.createElement('iframe')
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin')
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  frame.style.display = 'none'
  frame.src = pluginTreeRelayUrl(hash, nonce)

  let ended = false
  let ready = false
  let pending: { message: { acornBridge: typeof PLUGIN_BRIDGE_VERSION; treeSlotBridge?: 1 }; transfer: Transferable[] } | null = null
  const sandbox: TreeSandbox = {
    onerror: null,
    postMessage(message, transfer) {
      if (ended || ready || pending || message.acornBridge !== PLUGIN_BRIDGE_VERSION || transfer.length !== 2) {
        throw new Error('invalid tree worker handshake')
      }
      pending = { message, transfer }
    },
    terminate() { teardown() },
  }

  const teardown = (): void => {
    if (ended) return
    ended = true
    clearTimeout(deadline)
    window.removeEventListener('message', onMessage)
    frame.remove()
    if (pending) for (const endpoint of pending.transfer) { try { (endpoint as MessagePort).close?.() } catch { /* finish retiring every untransferred endpoint */ } }
    pending = null
  }
  const fail = (reason: string): void => {
    if (ended) return
    teardown()
    sandbox.onerror?.(new ErrorEvent('error', { message: reason }))
  }
  const onMessage = (event: MessageEvent): void => {
    // An unrelated frame (even one at this hash origin) cannot request or receive the ports.
    const target = frame.contentWindow
    if (ended || !target || event.source !== target || event.origin !== origin) return
    const data = event.data as { kind?: unknown; nonce?: unknown } | null
    if (!data || data.nonce !== nonce) return
    if (data.kind === 'acorn:tree-relay-error') return fail('the isolated plugin worker failed to start')
    if (data.kind !== 'acorn:tree-relay-ready' || ready || !pending) return
    ready = true
    clearTimeout(deadline)
    const hello = pending
    pending = null
    try {
      target.postMessage({ kind: 'acorn:tree-relay-start', nonce, hello: hello.message }, origin, hello.transfer)
    } catch {
      fail('the isolated plugin worker could not receive its bridge')
    }
  }
  const deadline = setTimeout(() => fail('the isolated plugin worker did not start'), RELAY_DEADLINE_MS)
  window.addEventListener('message', onMessage)
  document.body.append(frame)
  return sandbox
}
