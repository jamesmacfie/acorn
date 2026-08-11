// The frame half of the bridge — the only runtime code a third-party client bundle imports
// (docs/plugins.md). Reached by plugin authors as
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
  PluginWebviewBlocked,
  PluginWebviewNavigated,
} from '@acorn/protocol/pluginBridge.ts'
import { PLUGIN_BRIDGE_VERSION } from '@acorn/protocol/pluginBridge.ts'
import { eventChord, hasCommandModifier, isNormalizedChord, isPluginKeyClaim, isTypingTarget } from '@acorn/protocol/keybindings.ts'

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

// Five verbs, matching `PluginBridgeApiRequest.method` exactly. `put` was missing until a frame needed
// one: the protocol and the broker both carried PUT from the start, and only this facade did not, so a
// plugin whose own routes take a full-replacement body had no way to call them. A method absent here is
// a method no plugin can reach, however permissive the table underneath.
export type AcornBridgeApi = {
  get<T>(path: string, options?: { signal?: AbortSignal }): Promise<T>
  post<T>(path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T>
  put<T>(path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T>
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
    /**
     * Hand an `https` URL to the host. It resolves in-app when something recognises it — another
     * provider's reference panel, a task pane — and opens the owner's browser otherwise. Anything but
     * `https` is refused, and the promise resolving says only that the host accepted the URL: which of
     * those happened is not the frame's business, because the frame does not know which surface it is.
     *
     * Prefer `openLinkOnClick` below for anchors in rendered content; this is the verb underneath it.
     */
    openUrl(url: string): Promise<void>
    /** Importer surfaces only: finish, letting the host close the modal and refresh. */
    done(): Promise<void>
    /** Dismiss the surface: an importer modal without having imported anything, or an overlay once its
     * picker has picked. Refused from any other surface — a pane does not get to close itself. */
    close(): Promise<void>
  }
  /**
   * The document this frame shares its pane with, when its manifest declared a `document-over-frame`
   * layout. The host draws that editor — its theme, its workers, its dirty state, its ⌘S — and these
   * three methods are the entire seam between it and the plugin's own half of the rectangle.
   *
   * Denied from any other surface, structurally: a frame that has no document beside it has nothing
   * these could address.
   */
  document: {
    /** The editor's current text, including edits not yet written to the plugin's own route. */
    read(): Promise<string>
    /** Replace it. Goes through the model, so it joins the undo stack and schedules the host's autosave
     * exactly as typing would. */
    write(text: string): Promise<void>
    /** Write anything pending to the plugin's declared write route and wait for it. Rarely needed by
     * hand: the host already flushes before it delivers a surface action. */
    flush(): Promise<void>
  }
  webview: {
    navigate(url: string): Promise<void>
    back(): Promise<void>
    forward(): Promise<void>
    reload(): Promise<void>
    onNavigated(listener: (state: PluginWebviewNavigated) => void): () => void
    onBlocked(listener: (state: PluginWebviewBlocked) => void): () => void
  }
  keys: {
    /** Replace the active claim set with a subset of this surface's manifest declaration. */
    claim(chords: readonly string[]): void
  }
  /** Called on every appearance change, and once on connect. The tokens are already applied to
   * `:root` by the time this fires; the callback is for anything a plugin draws itself (a canvas, a
   * chart) that has to be repainted. */
  onAppearance(listener: (appearance: { theme: string; style: string }) => void): () => void
  /** A row was selected on this plugin's declarative rail source while this pane was already open. The
   * selection that OPENED the pane is `context.item` instead — this fires only for the ones after it. */
  onSelect(listener: (item: string) => void): () => void
  /**
   * One of this surface's declared commands fired — from its chord pressed inside the host's editor,
   * from the palette, or from anywhere else the host runs a command. `command` is the id the manifest
   * declared.
   *
   * Handle it exactly as you would the equivalent button click; the trigger is not your business. The
   * host has already flushed the shared document, so reading it back through your own route is safe.
   */
  onSurfaceAction(listener: (command: string) => void): () => void
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
let detachKeyForwarding: (() => void) | null = null

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
    const actionListeners = new Set<(command: string) => void>()
    const subscribing = new Map<string, Promise<unknown>>()
    let seq = 0
    let context: PluginFrameContext | null = null
    let claimed = new Set<string>()

    const keyTarget = globalThis as unknown as {
      addEventListener?: (type: 'keydown', listener: (event: KeyboardEvent) => void, options?: { capture?: boolean }) => void
      removeEventListener?: (type: 'keydown', listener: (event: KeyboardEvent) => void, options?: { capture?: boolean }) => void
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      const chord = eventChord(event)
      if (!chord || claimed.has(chord)) return
      // Do not cancel a browser behavior for a value the host's chord grammar will reject. Space is
      // the important case: eventChord can describe it, but it is not a bindable Acorn chord.
      if (!isNormalizedChord(chord)) return
      // Bare keys belong to text entry. Modified application chords still forward so shell escape
      // hatches such as the palette work while an input inside the frame is focused.
      if (isTypingTarget(event.target) && chord !== 'escape' && !hasCommandModifier(chord)) return
      // Bare first-party bindings still reach the shell, but the frame keeps its own browser/UI
      // default. Only application-modified chords and Escape are plausibly shell-owned enough to
      // cancel locally before the host resolves them.
      if (chord === 'escape' || hasCommandModifier(chord)) event.preventDefault()
      port.postMessage({ kind: 'keydown', chord })
    }

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
          claimed = new Set((message.context.claimsKeys ?? []).filter(isPluginKeyClaim))
          keyTarget.addEventListener?.('keydown', onKeyDown, { capture: true })
          detachKeyForwarding = () => keyTarget.removeEventListener?.('keydown', onKeyDown, { capture: true })
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
        case 'surfaceAction':
          for (const listener of actionListeners) listener(message.command)
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

    const onEvent = (channel: string, listener: (payload: unknown) => void): (() => void) => {
      const set = listeners.get(channel) ?? new Set()
      set.add(listener)
      listeners.set(channel, set)
      // Webview state is emitted by the host that owns this surface. It is intrinsic to a webview
      // binding, not a node event the manifest must separately request.
      const localWebviewEvent = context?.target === 'webview'
        && (channel === 'webview:navigated' || channel === 'webview:blocked')
      if (!localWebviewEvent && !subscribing.has(channel)) {
        subscribing.set(
          channel,
          request({ kind: 'subscribe', channel }).catch((error: unknown) => {
            console.error(`[acorn] could not subscribe to ${channel}:`, error)
          }),
        )
      }
      return () => set.delete(listener)
    }

    const api: AcornBridge = {
      get context() {
        if (!context) throw new Error('acorn: context is only available after connect() resolves')
        return context
      },
      api: {
        get: (path, options) => call('GET', path, undefined, options),
        post: (path, body, options) => call('POST', path, body, options),
        put: (path, body, options) => call('PUT', path, body, options),
        patch: (path, body, options) => call('PATCH', path, body, options),
        del: (path, options) => call('DELETE', path, undefined, options),
      },
      events: {
        on: onEvent,
      },
      state: {
        get: <T>(key: string) => request<T | null>({ kind: 'state.get', key }),
        set: async (key, value) => void (await request({ kind: 'state.set', key, value })),
      },
      ui: {
        toast: async (title, detail) => void (await request({ kind: 'ui', op: 'toast', title, ...(detail === undefined ? {} : { detail }) })),
        copy: async (text) => void (await request({ kind: 'ui', op: 'copy', text })),
        openPane: async (paneId) => void (await request({ kind: 'ui', op: 'openPane', paneId })),
        openUrl: async (url) => void (await request({ kind: 'ui', op: 'openUrl', url })),
        done: async () => void (await request({ kind: 'ui', op: 'importer.done' })),
        close: async () => void (await request({ kind: 'ui', op: 'importer.close' })),
      },
      document: {
        read: async () => (await request<{ text?: string }>({ kind: 'document', op: 'read' }))?.text ?? '',
        write: async (text) => void (await request({ kind: 'document', op: 'write', text })),
        flush: async () => void (await request({ kind: 'document', op: 'flush' })),
      },
      webview: {
        navigate: async (url) => void (await request({ kind: 'webview', op: 'navigate', url })),
        back: async () => void (await request({ kind: 'webview', op: 'back' })),
        forward: async () => void (await request({ kind: 'webview', op: 'forward' })),
        reload: async () => void (await request({ kind: 'webview', op: 'reload' })),
        onNavigated: (listener) => onEvent('webview:navigated', listener as (payload: unknown) => void),
        onBlocked: (listener) => onEvent('webview:blocked', listener as (payload: unknown) => void),
      },
      keys: {
        claim(chords) {
          const declared = new Set((context?.claimsKeys ?? []).filter(isPluginKeyClaim))
          const next = new Set<string>()
          for (const chord of chords) {
            if (!declared.has(chord)) {
              console.warn(`[acorn] ignored undeclared key claim ${chord}`)
              continue
            }
            next.add(chord)
          }
          claimed = next
        },
      },
      onAppearance(listener) {
        appearanceListeners.add(listener)
        return () => appearanceListeners.delete(listener)
      },
      onSelect(listener) {
        selectListeners.add(listener)
        return () => void selectListeners.delete(listener)
      },
      onSurfaceAction(listener) {
        actionListeners.add(listener)
        return () => void actionListeners.delete(listener)
      },
    }
  })
}

/**
 * Delegated click handler for anchors inside a frame's own rendered content — a ticket description, a
 * comment, an error body. Returns whether the click was taken.
 *
 * Here rather than left to each frame because the plumbing is identical everywhere and the wrong version
 * of it is silent: an anchor in a frame cannot navigate anything (the iframe sandbox has no
 * `allow-popups`, and Electron pins every subframe to its own origin), so a frame that forgets this
 * handler renders links that simply do nothing. One helper beats every plugin rediscovering that.
 *
 * On @acorn/plugin-api/ui/sdk beside `connect`, and NOT on the /ui barrel beside `renderMarkdown`, even
 * though the two are used on the same line. `renderMarkdown` qualifies there because it is pure — text
 * in, markup out — while this needs the bridge, and /ui is a barrel of Solid components that a
 * non-Solid frame must be able to skip entirely. The sdk is what every frame already imports.
 *
 * Modified clicks are taken too, unlike the shell's equivalent (client-core/registries/contentLinks.ts),
 * and that difference is deliberate: in the shell a cmd-click is the reader asking for a browser tab, so
 * the anchor's default is preserved. In a frame there is no default to preserve — the sandbox swallows
 * it — so treating a cmd-click as a plain click is the difference between working and dead.
 *
 * A non-https href is left alone. `mailto:` is the honest casualty: `renderMarkdown` allows it, the
 * bridge verb does not, and a frame cannot open a mail client any more than it can open a tab.
 */
export function openLinkOnClick(bridge: AcornBridge, event: MouseEvent): boolean {
  if (event.defaultPrevented || event.button !== 0) return false
  const href = (event.target as HTMLElement | null)?.closest?.('a')?.getAttribute('href')
  // The same scheme test the host will apply. Checked here as well so a link the host would refuse keeps
  // its (inert) default rather than becoming a denied bridge call and a console error per click.
  if (!href?.trim().toLowerCase().startsWith('https://')) return false
  event.preventDefault()
  void bridge.ui.openUrl(href).catch((error: unknown) => {
    console.error(`[acorn] could not open ${href}:`, error)
  })
  return true
}

/** Test seam. `connect()` memoizes a per-frame connection, and a suite that asserts on one handshake
 * must not inherit the previous one's port. */
export function _resetConnection(): void {
  detachKeyForwarding?.()
  detachKeyForwarding = null
  connection = null
}
