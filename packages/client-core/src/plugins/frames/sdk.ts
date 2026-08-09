// The frame half of the bridge — the only runtime code a third-party client bundle imports
// (docs/third-party/phase-3-sandboxed-ui.md § Plugin-side SDK). Reached by plugin authors as
// `@acorn/plugin-api/ui/sdk`.
//
// It lives in client-core rather than in plugin-api because that package is a facade held to
// re-exports-only by an architecture rule, and this is real code. Nothing about it is host code: it
// runs INSIDE the sandbox, in a frame that has no host DOM, no `window.acorn` and no network.
//
// Which is also why it imports nothing but types. It is bundled into a foreign plugin's bundle by that
// plugin's own bundler, so a value import here would drag a slice of the shell across the boundary —
// and Solid in particular would fail the moment two copies met.
//
// Scheme-agnostic by rule: this file never names `app-plugin://`, or any origin at all. It waits for a
// port and knows nothing about how the frame was served, which is what lets the same bundle run in a
// browser iframe on a future web client.
import type {
  PluginBridgeAppearance,
  PluginBridgeMessage,
  PluginBridgeReply,
  PluginFrameContext,
} from '@acorn/protocol/pluginBridge.ts'
import { PLUGIN_BRIDGE_VERSION } from '@acorn/protocol/pluginBridge.ts'

/** The error a rejected bridge call throws. `code` is the API's own vocabulary, so a plugin branches on
 * the same strings whether the call was denied at the bridge or refused by the node. */
export class AcornBridgeError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly requestId: string
  constructor(error: { code: string; message: string; retryable: boolean; requestId: string }) {
    super(error.message || error.code)
    this.name = 'AcornBridgeError'
    this.code = error.code
    this.retryable = error.retryable
    this.requestId = error.requestId
  }
}

export type AcornBridgeApi = {
  get<T>(path: string, options?: { signal?: AbortSignal }): Promise<T>
  post<T>(path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T>
  patch<T>(path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T>
  del<T>(path: string, options?: { signal?: AbortSignal }): Promise<T>
}

// Named for what it is rather than for the app: `Acorn` on @acorn/plugin-api/ui is the shell component,
// and two things called Acorn in one plugin's imports is a trap.
export type AcornBridge = {
  /** What this frame was opened to look at. A snapshot, not reactive — a frame is recreated when its
   * subject changes. */
  readonly context: PluginFrameContext
  readonly api: AcornBridgeApi
  events: {
    /** Subscribe to a shell channel the manifest declared. Returns the unsubscribe. */
    on(channel: string, listener: (payload: unknown) => void): () => void
  }
  state: {
    get<T>(key: string): Promise<T | null>
    set(key: string, value: unknown): Promise<void>
  }
  ui: {
    toast(title: string, detail?: string): Promise<void>
    copy(text: string): Promise<void>
    /** Open another of this plugin's own panes. */
    openPane(paneId: string): Promise<void>
    /** Importer surfaces only: finish, letting the host close the modal and refresh. */
    done(): Promise<void>
    /** Importer surfaces only: dismiss without having imported anything. */
    close(): Promise<void>
  }
  /** Called on every appearance change, and once on connect. The tokens are already applied to
   * `:root` by the time this fires; the callback is for anything a plugin draws itself (a canvas, a
   * chart) that has to be repainted. */
  onAppearance(listener: (appearance: { theme: string; style: string }) => void): () => void
  /** A row was selected on this plugin's declarative rail source while this pane was already open. The
   * selection that OPENED the pane is `context.item` instead — this fires only for the ones after it. */
  onSelect(listener: (item: string) => void): () => void
}

type Pending = { resolve(value: unknown): void; reject(error: unknown): void }

const isHello = (data: unknown): boolean =>
  !!data && typeof data === 'object' && (data as { acornBridge?: unknown }).acornBridge === PLUGIN_BRIDGE_VERSION

// Applied to the document rather than handed to the plugin as values: a plugin's CSS is written against
// `var(--bg)` and `[data-theme]` exactly as first-party CSS is, so the same stylesheet works in a frame
// and (for a plugin that is later adopted first-party) in the shell.
function applyAppearance(appearance: PluginBridgeAppearance): void {
  const root = globalThis.document?.documentElement
  if (!root) return
  root.dataset.theme = appearance.theme
  root.dataset.style = appearance.style
  for (const [name, value] of Object.entries(appearance.tokens)) root.style.setProperty(name, value)
}

/**
 * Wait for the host's handshake and return the bridge. Resolves once — a frame has exactly one port for
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
      // Only the transferred port matters, so there is no origin check to get wrong: a message with no
      // port is not the handshake, and the port is unforgeable.
      if (!isHello(event.data)) return
      const port = event.ports?.[0]
      if (!port) return
      target.removeEventListener?.('message', onWindowMessage)
      resolve(attach(port))
    }
    target.addEventListener('message', onWindowMessage)
  })
}

function attach(port: MessagePort): Promise<AcornBridge> {
  return new Promise<AcornBridge>((ready) => {
    const pending = new Map<number, Pending>()
    const listeners = new Map<string, Set<(payload: unknown) => void>>()
    const appearanceListeners = new Set<(appearance: { theme: string; style: string }) => void>()
    const selectListeners = new Set<(item: string) => void>()
    const subscribing = new Map<string, Promise<unknown>>()
    let seq = 0
    let context: PluginFrameContext | null = null

    const settle = (reply: PluginBridgeReply): void => {
      const waiter = pending.get(reply.id)
      if (!waiter) return
      pending.delete(reply.id)
      if (reply.ok) waiter.resolve(reply.body)
      else waiter.reject(new AcornBridgeError(reply.error))
    }

    port.onmessage = (event: MessageEvent) => {
      const message = event.data as PluginBridgeMessage
      if (!message || typeof message !== 'object') return
      if ('id' in message) return settle(message)
      switch (message.kind) {
        case 'ready':
          context = message.context
          ready(api)
          return
        case 'event':
          for (const listener of listeners.get(message.channel) ?? []) listener(message.payload)
          return
        case 'appearance': {
          applyAppearance(message)
          for (const listener of appearanceListeners) listener({ theme: message.theme, style: message.style })
          return
        }
        case 'select':
          for (const listener of selectListeners) listener(message.item)
          return
      }
    }
    port.start?.()

    const request = <T>(message: Record<string, unknown>, signal?: AbortSignal): Promise<T> => {
      const id = ++seq
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
        port.postMessage({ ...message, id })
        if (!signal) return
        if (signal.aborted) return void abort(id, reject, signal)
        signal.addEventListener('abort', () => abort(id, reject, signal), { once: true })
      })
    }

    // An abort tells the host to stop caring and rejects locally. There is no un-sending an HTTP
    // request, and pretending otherwise would be a lie a caller could act on.
    const abort = (id: number, reject: (error: unknown) => void, signal: AbortSignal): void => {
      if (!pending.delete(id)) return
      port.postMessage({ id: ++seq, kind: 'cancel', target: id })
      reject(signal.reason ?? new Error('aborted'))
    }

    const call = <T>(method: string, path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T> =>
      request<T>({ kind: 'api', method, path, ...(body === undefined ? {} : { body }) }, options?.signal)

    const api: AcornBridge = {
      get context() {
        if (!context) throw new Error('acorn: context is only available after connect() resolves')
        return context
      },
      api: {
        get: (path, options) => call('GET', path, undefined, options),
        post: (path, body, options) => call('POST', path, body, options),
        patch: (path, body, options) => call('PATCH', path, body, options),
        del: (path, options) => call('DELETE', path, undefined, options),
      },
      events: {
        on(channel, listener) {
          const set = listeners.get(channel) ?? new Set()
          set.add(listener)
          listeners.set(channel, set)
          // One subscribe per channel however many local listeners there are. A rejected subscribe is
          // reported once and not retried: the manifest is not going to change mid-session.
          if (!subscribing.has(channel)) {
            subscribing.set(
              channel,
              request({ kind: 'subscribe', channel }).catch((error: unknown) => {
                console.error(`[acorn] could not subscribe to ${channel}:`, error)
              }),
            )
          }
          return () => set.delete(listener)
        },
      },
      state: {
        get: <T>(key: string) => request<T | null>({ kind: 'state.get', key }),
        set: async (key, value) => void (await request({ kind: 'state.set', key, value })),
      },
      ui: {
        toast: async (title, detail) => void (await request({ kind: 'ui', op: 'toast', title, ...(detail === undefined ? {} : { detail }) })),
        copy: async (text) => void (await request({ kind: 'ui', op: 'copy', text })),
        openPane: async (paneId) => void (await request({ kind: 'ui', op: 'openPane', paneId })),
        done: async () => void (await request({ kind: 'ui', op: 'importer.done' })),
        close: async () => void (await request({ kind: 'ui', op: 'importer.close' })),
      },
      onAppearance(listener) {
        appearanceListeners.add(listener)
        return () => appearanceListeners.delete(listener)
      },
      onSelect(listener) {
        selectListeners.add(listener)
        return () => void selectListeners.delete(listener)
      },
    }
  })
}

/** Test seam. `connect()` memoizes a per-frame connection, and a suite that asserts on one handshake
 * must not inherit the previous one's port. */
export function _resetConnection(): void {
  connection = null
}
