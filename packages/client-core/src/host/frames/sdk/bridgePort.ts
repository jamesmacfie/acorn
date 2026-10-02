import type {
  PluginBridgeAppearance,
  PluginBridgeMessage,
  PluginBridgeReply,
  PluginFrameContext,
} from '@acorn/protocol/plugin/bridge.ts'
import { eventChord, hasCommandModifier, isBrowserEditingChord, isNormalizedChord, isPluginKeyClaim, isTypingTarget } from '@acorn/protocol/keybindings.ts'
import { AcornBridgeError, type AcornBridge, type PluginByteResponse } from './bridgeTypes'
import { createBridgeTelemetry } from './bridgeTelemetry'

type Pending = { resolve(value: unknown): void; reject(error: unknown): void; cleanup?(): void }

// Applied to the document rather than handed to the plugin as values, so a plugin's CSS is written
// against `var(--bg)` and `[data-theme]` exactly as first-party CSS is, and the same stylesheet works in
// a frame and in the shell.
function applyAppearance(appearance: PluginBridgeAppearance): void {
  const root = globalThis.document?.documentElement
  if (!root) return
  root.dataset.theme = appearance.theme
  root.dataset.style = appearance.style
  for (const [name, value] of Object.entries(appearance.tokens)) root.style.setProperty(name, value)
}

let detachKeyForwarding: (() => void) | null = null
const bridgeDisposers = new WeakMap<MessagePort, () => void>()

export function disposeBridgePort(port: MessagePort): void {
  bridgeDisposers.get(port)?.()
  bridgeDisposers.delete(port)
}

export function resetBridgePort(): void {
  detachKeyForwarding?.()
  detachKeyForwarding = null
}

export function attach(port: MessagePort, options: { mode?: AcornBridge['treeBridgeMode']; onDispose?(dispose: () => void): void } = {}): Promise<AcornBridge> {
  return new Promise<AcornBridge>((ready, rejectReady) => {
    const pending = new Map<number, Pending>()
    const listeners = new Map<string, Set<(payload: unknown) => void>>()
    const appearanceListeners = new Set<(appearance: { theme: string; style: string }) => void>()
    const selectListeners = new Set<(item: string) => void>()
    const actionListeners = new Set<(command: string) => void>()
    const subscribing = new Map<string, Promise<unknown>>()
    let seq = 0
    let context: PluginFrameContext | null = null
    let claimed = new Set<string>()
    let active = true
    let didReady = false

    const dispose = () => {
      if (!active) return
      active = false
      const error = new AcornBridgeError({ code: 'unmounted', message: 'the host unmounted this tree', retryable: false, requestId: '' })
      for (const waiter of pending.values()) {
        waiter.cleanup?.()
        waiter.reject(error)
      }
      pending.clear()
      if (!didReady) rejectReady(error)
      listeners.clear()
      appearanceListeners.clear()
      selectListeners.clear()
      actionListeners.clear()
      subscribing.clear()
      keyTarget.removeEventListener?.('keydown', onKeyDown, { capture: true })
      port.onmessage = null
      port.close()
    }
    bridgeDisposers.set(port, dispose)

    const keyTarget = globalThis as unknown as {
      addEventListener?: (type: 'keydown', listener: (event: KeyboardEvent) => void, options?: { capture?: boolean }) => void
      removeEventListener?: (type: 'keydown', listener: (event: KeyboardEvent) => void, options?: { capture?: boolean }) => void
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      const chord = eventChord(event)
      if (!chord || claimed.has(chord)) return
      // Copy, cut, paste, undo and select-all belong to the browser, not the shell: there's no host
      // binding to resolve, and cancelling them is what stopped a selection inside a frame from ever
      // reaching the clipboard. A frame that genuinely wants one claims it, handled above.
      if (isBrowserEditingChord(chord)) return
      // Don't cancel a browser behaviour for a value the host's chord grammar will reject. Space is the
      // important case: eventChord can describe it, but it isn't a bindable acorn chord.
      if (!isNormalizedChord(chord)) return
      // Bare keys belong to text entry. Modified application chords still forward, so shell escape
      // hatches such as the palette work while an input inside the frame is focused.
      if (isTypingTarget(event.target) && chord !== 'escape' && !hasCommandModifier(chord)) return
      // Bare first-party bindings still reach the shell, but the frame keeps its own browser default.
      // Only application-modified chords and Escape are plausibly shell-owned enough to cancel locally.
      if (chord === 'escape' || hasCommandModifier(chord)) event.preventDefault()
      port.postMessage({ kind: 'keydown', chord })
    }

    const settle = (reply: PluginBridgeReply): void => {
      const waiter = pending.get(reply.id)
      if (!waiter) return
      pending.delete(reply.id)
      waiter.cleanup?.()
      if (reply.ok) waiter.resolve(reply.body)
      else waiter.reject(new AcornBridgeError(reply.error))
    }

    port.onmessage = (event: MessageEvent) => {
      if (!active) return
      const message = event.data as PluginBridgeMessage
      if (!message || typeof message !== 'object') return
      if ('id' in message) return settle(message)
      switch (message.kind) {
        case 'ready':
          context = message.context
          claimed = new Set((message.context.claimsKeys ?? []).filter(isPluginKeyClaim))
          // The ack, before the plugin's own code gets the bridge: reaching this line proves the bundle
          // evaluated and called connect(), which is what the host's handshake deadline asks about. A
          // frame that dies at module scope never gets here, and the host draws a labelled placeholder
          // instead of a blank rectangle.
          if (!didReady) {
            didReady = true
            if (!options.mode) {
              keyTarget.addEventListener?.('keydown', onKeyDown, { capture: true })
              detachKeyForwarding = () => keyTarget.removeEventListener?.('keydown', onKeyDown, { capture: true })
            }
            port.postMessage({ kind: 'connected', ...(options.mode === 'bootstrap' ? { treeSlotBridge: 1 } : {}) })
            ready(api)
          }
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

    const request = <T>(message: Record<string, unknown>, signal?: AbortSignal): Promise<T> => {
      if (!active) return Promise.reject(new AcornBridgeError({ code: 'unmounted', message: 'the host unmounted this tree', retryable: false, requestId: '' }))
      const id = ++seq
      return new Promise<T>((resolve, reject) => {
        const waiter: Pending = { resolve: resolve as (value: unknown) => void, reject }
        pending.set(id, waiter)
        try { port.postMessage({ ...message, id }) } catch (error) { pending.delete(id); reject(error); return }
        if (!signal) return
        if (signal.aborted) return void abort(id, reject, signal)
        const onAbort = () => abort(id, reject, signal)
        waiter.cleanup = () => signal.removeEventListener('abort', onAbort)
        signal.addEventListener('abort', onAbort, { once: true })
      })
    }

    // An abort tells the host to stop caring and rejects locally. There's no un-sending an HTTP request,
    // and pretending otherwise would be a lie a caller could act on.
    const abort = (id: number, reject: (error: unknown) => void, signal: AbortSignal): void => {
      const waiter = pending.get(id)
      if (!waiter) return
      pending.delete(id)
      waiter.cleanup?.()
      port.postMessage({ id: ++seq, kind: 'cancel', target: id })
      reject(signal.reason ?? new Error('aborted'))
    }

    const call = <T>(method: string, path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T> =>
      request<T>({ kind: 'api', method, path, ...(body === undefined ? {} : { body }) }, options?.signal)

    const { telemetry, log } = createBridgeTelemetry(port)

    const onEvent = (channel: string, listener: (payload: unknown) => void): (() => void) => {
      if (!active) return () => {}
      const set = listeners.get(channel) ?? new Set()
      set.add(listener)
      listeners.set(channel, set)
      // Webview state is emitted by the host that owns this surface. It's intrinsic to a webview
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
      ...(options.mode ? { treeBridgeMode: options.mode } : {}),
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
        getBytes: (path, options) => request<PluginByteResponse>({ kind: 'api.bytes', method: 'GET', path }, options?.signal),
        postBytes: <T,>(path: string, body: { bytes: Uint8Array; type: string; filename?: string }, options?: { signal?: AbortSignal }) =>
          request<T>({
            kind: 'api.bytes',
            method: 'POST',
            path,
            bytes: body.bytes,
            type: body.type,
            ...(body.filename === undefined ? {} : { filename: body.filename }),
          }, options?.signal),
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
        openDestination: async (destinationId, resourceId, subresourceId) => void (await request({
          kind: 'ui', op: 'openDestination', destinationId, resourceId,
          ...(subresourceId === undefined ? {} : { subresourceId }),
        })),
        openTask: async (taskId) => void (await request({ kind: 'ui', op: 'openTask', taskId })),
        openUrl: async (url) => void (await request({ kind: 'ui', op: 'openUrl', url })),
        done: async () => void (await request({ kind: 'ui', op: 'importer.done' })),
        close: async (result) => void (await request({ kind: 'ui', op: 'importer.close', ...(result === undefined ? {} : { result }) })),
      },
      document: {
        read: async () => (await request<{ text?: string }>({ kind: 'document', op: 'read' }))?.text ?? '',
        write: async (text, options) => void (await request({ kind: 'document', op: 'write', text, ...(options ? { expectedText: options.expectedText } : {}) })),
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
      telemetry,
      log,
      keys: {
        claim(chords) {
          if (!active) return
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
        if (!active) return () => {}
        appearanceListeners.add(listener)
        return () => appearanceListeners.delete(listener)
      },
      onSelect(listener) {
        if (!active) return () => {}
        selectListeners.add(listener)
        return () => void selectListeners.delete(listener)
      },
      onSurfaceAction(listener) {
        if (!active) return () => {}
        actionListeners.add(listener)
        return () => void actionListeners.delete(listener)
      },
    }
    try { options.onDispose?.(dispose); if (active) port.start?.() } catch (error) { rejectReady(error); dispose() }
  })
}
