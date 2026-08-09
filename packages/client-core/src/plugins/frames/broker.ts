// The host side of one sandboxed plugin frame's bridge (docs/plugins.md
// § Enforcement).
//
// One of these per frame. It holds the binding — plugin id, node, task, project, declared scopes — and
// the frame cannot influence any of it: every message is checked against values the host read off the
// manifest and chose when it created the frame. That is the whole security model in one sentence, and
// it is why this module has no ambient reads at all.
//
// Effects arrive as `services` rather than being imported. This module is the security choke point and
// has to be exhaustively tested, and client-core's suite runs in plain Node with no DOM
// (packages/client-core/vitest.config.ts says so, loudly) — importing the notification ring, the prefs
// writer and the query client here would make the one module that most needs testing the one that
// cannot be. PluginFrame.tsx supplies the real implementations; the tests supply spies. One
// implementation, but the seam pays for itself.
import type {
  PluginBridgeAppearance,
  PluginBridgeEvent,
  PluginBridgeMessage,
  PluginBridgeReply,
  PluginBridgeSelect,
  PluginFrameContext,
} from '@acorn/protocol/pluginBridge.ts'
import { PLUGIN_BRIDGE_DENIED } from '@acorn/protocol/pluginBridge.ts'
import { MAX_PLUGIN_STATE_BYTES, pluginStateKey } from '@acorn/protocol/pluginState.ts'
import { allowApi, isApiMethod, type ApiMethod } from './scopes'

// What the frame is, as the host decided it. Nothing here is ever read from a message.
export type FrameBinding = {
  pluginId: string
  // The contribution id this frame renders, and which registry it landed in.
  surface: string
  target: 'pane' | 'refPanel' | 'settings' | 'importer'
  nodeId: string
  taskId?: string
  projectId?: string
  // Manifest-declared scopes and event channels.
  api: readonly string[]
  events: readonly string[]
  // The pane ids this plugin contributed. `openPane` may name one of these and nothing else — a plugin
  // cannot use the bridge to drive the rest of the shell's layout.
  panes: readonly string[]
}

export type FrameApiResult = {
  ok: boolean
  status: number
  body: unknown
  error?: { code: string; message: string; requestId: string; retryable: boolean }
}

// The host effects a bridge is allowed to cause. Deliberately small and closed: adding a member here
// is a deliberate widening of what third-party UI can do.
export type FrameServices = {
  // Forward an ALREADY-ALLOWED call. Pinned to the frame's node by the caller that builds this.
  fetch(method: ApiMethod, path: string, body: unknown, signal: AbortSignal): Promise<FrameApiResult>
  // Attach to one shell event channel; returns the detach.
  subscribe(channel: string, listener: (payload: unknown) => void): () => void
  stateGet(key: string): unknown
  stateSet(key: string, value: unknown): Promise<void>
  toast(title: string, detail?: string): void
  copy(text: string): void
  openPane(paneId: string): void
  // Importer lifecycle. `done` is the host's post-import refresh; `close` is plain dismissal.
  importerDone(): void
  importerClose(): void
}

// A broken plugin must not be able to busy-loop the shell. These are generous for anything honest: a
// frame doing real work sends a handful of messages per interaction.
const MAX_IN_FLIGHT = 100
const MAX_PER_WINDOW = 1000
const WINDOW_MS = 10_000

export type FrameBridge = { dispose(): void }

const denied = (id: number, message: string): PluginBridgeReply => ({
  id,
  ok: false,
  error: { code: PLUGIN_BRIDGE_DENIED, message, requestId: '', retryable: false },
})

const failed = (id: number, code: string, message: string): PluginBridgeReply => ({
  id,
  ok: false,
  error: { code, message, requestId: '', retryable: false },
})

// A message is only a message if it has a positive integer id and a string kind. Anything else is not
// a malformed request — it is not a request, and there is nothing to reply to.
const requestShape = (data: unknown): { id: number; kind: string } | null => {
  if (!data || typeof data !== 'object') return null
  const { id, kind } = data as { id?: unknown; kind?: unknown }
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return null
  if (typeof kind !== 'string') return null
  return { id, kind }
}

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).byteLength

export function createFrameBridge(input: {
  port: MessagePort
  binding: FrameBinding
  services: FrameServices
  context: PluginFrameContext
  // Called when the rate limiter trips. The port is already dead by then; the host shows a
  // "plugin misbehaving" placeholder in place of the surface.
  onMisbehaving(reason: string): void
}): FrameBridge {
  const { port, binding, services, onMisbehaving } = input

  const inFlight = new Map<number, AbortController>()
  const detachers: (() => void)[] = []
  const subscribed = new Set<string>()
  let windowStart = Date.now()
  let windowCount = 0
  let alive = true

  const post = (message: PluginBridgeMessage): void => {
    if (!alive) return
    port.postMessage(message)
  }

  const kill = (reason: string): void => {
    if (!alive) return
    alive = false
    teardown()
    onMisbehaving(reason)
  }

  function teardown(): void {
    for (const controller of inFlight.values()) controller.abort()
    inFlight.clear()
    for (const detach of detachers.splice(0)) detach()
    subscribed.clear()
    port.onmessage = null
    port.close()
  }

  // True when this message is over budget. Two independent limits: a sustained rate, and a ceiling on
  // outstanding work — a frame that opens 100 slow requests and never awaits them is as bad as one
  // that sends 10k fast ones.
  const overBudget = (): string | null => {
    const now = Date.now()
    if (now - windowStart > WINDOW_MS) {
      windowStart = now
      windowCount = 0
    }
    if (++windowCount > MAX_PER_WINDOW) return `more than ${MAX_PER_WINDOW} bridge messages in ${WINDOW_MS / 1000}s`
    if (inFlight.size >= MAX_IN_FLIGHT) return `more than ${MAX_IN_FLIGHT} requests in flight`
    return null
  }

  const handleApi = async (id: number, data: Record<string, unknown>): Promise<void> => {
    const { method, path, body } = data as { method?: unknown; path?: unknown; body?: unknown }
    if (typeof path !== 'string' || !isApiMethod(method)) {
      post(failed(id, 'bad_request', 'an api request needs a method and a path'))
      return
    }
    const decision = allowApi(binding, method, path)
    if (!decision.allowed) {
      // Never reaches services.fetch. The e2e suite asserts exactly this by spying at the broker: a
      // denied path must not produce a request, not merely a discarded response.
      post(denied(id, decision.reason))
      return
    }
    const controller = new AbortController()
    inFlight.set(id, controller)
    try {
      const result = await services.fetch(method, path, body, controller.signal)
      if (!inFlight.has(id)) return // cancelled while in flight; the frame stopped caring
      if (result.ok) post({ id, ok: true, status: result.status, body: result.body })
      else {
        post({
          id,
          ok: false,
          error: result.error ?? { code: 'internal', message: `${method} failed with ${result.status}`, requestId: '', retryable: result.status >= 500 },
        })
      }
    } catch (error) {
      if (inFlight.has(id)) post(failed(id, 'internal', error instanceof Error ? error.message : String(error)))
    } finally {
      inFlight.delete(id)
    }
  }

  const handleSubscribe = (id: number, data: Record<string, unknown>): void => {
    const channel = data.channel
    if (typeof channel !== 'string') {
      post(failed(id, 'bad_request', 'a subscribe needs a channel'))
      return
    }
    // Declared in the manifest, and a channel the shell actually has. `services.subscribe` returning
    // null is the second half: subscribing does not create a channel.
    if (!binding.events.includes(channel)) {
      post(denied(id, `${channel} is not in the plugin's declared events`))
      return
    }
    if (subscribed.has(channel)) {
      post({ id, ok: true, status: 200, body: null })
      return
    }
    let detach: () => void
    try {
      detach = services.subscribe(channel, (payload) => post({ kind: 'event', channel, payload } satisfies PluginBridgeEvent))
    } catch (error) {
      post(failed(id, 'bad_request', error instanceof Error ? error.message : String(error)))
      return
    }
    subscribed.add(channel)
    detachers.push(detach)
    post({ id, ok: true, status: 200, body: null })
  }

  const handleState = async (id: number, kind: string, data: Record<string, unknown>): Promise<void> => {
    const key = data.key
    if (typeof key !== 'string' || !key) {
      post(failed(id, 'bad_request', 'a state operation needs a key'))
      return
    }
    const scoped = pluginStateKey(binding.pluginId, key)
    if (kind === 'state.get') {
      post({ id, ok: true, status: 200, body: services.stateGet(scoped) ?? null })
      return
    }
    const serialized = JSON.stringify(data.value ?? null)
    if (utf8Bytes(serialized) > MAX_PLUGIN_STATE_BYTES) {
      post(failed(id, 'bad_request', `state values are capped at ${MAX_PLUGIN_STATE_BYTES} bytes`))
      return
    }
    try {
      await services.stateSet(scoped, data.value ?? null)
      post({ id, ok: true, status: 200, body: null })
    } catch (error) {
      post(failed(id, 'internal', error instanceof Error ? error.message : String(error)))
    }
  }

  const handleUi = (id: number, data: Record<string, unknown>): void => {
    const op = data.op
    switch (op) {
      case 'toast': {
        const title = typeof data.title === 'string' ? data.title : ''
        if (!title) return void post(failed(id, 'bad_request', 'a toast needs a title'))
        services.toast(title, typeof data.detail === 'string' ? data.detail : undefined)
        return void post({ id, ok: true, status: 200, body: null })
      }
      case 'copy': {
        if (typeof data.text !== 'string') return void post(failed(id, 'bad_request', 'copy needs text'))
        services.copy(data.text)
        return void post({ id, ok: true, status: 200, body: null })
      }
      case 'openPane': {
        const paneId = data.paneId
        // Own panes only. The allowlist is the manifest's own contribution ids, so this cannot be used
        // to drive first-party layout.
        if (typeof paneId !== 'string' || !binding.panes.includes(paneId)) {
          return void post(denied(id, 'openPane may only name a pane this plugin contributed'))
        }
        services.openPane(paneId)
        return void post({ id, ok: true, status: 200, body: null })
      }
      case 'importer.done':
      case 'importer.close': {
        // The surface decides, not the message. An importer frame decides when it is done; it never
        // decides how the shell reacts, and a pane cannot claim to be an importer at all.
        if (binding.target !== 'importer') {
          return void post(denied(id, `${op} is only valid from an importer surface`))
        }
        if (op === 'importer.done') services.importerDone()
        else services.importerClose()
        return void post({ id, ok: true, status: 200, body: null })
      }
      default:
        return void post(failed(id, 'bad_request', `unknown ui op ${String(op)}`))
    }
  }

  port.onmessage = (event: MessageEvent) => {
    if (!alive) return
    const shape = requestShape(event.data)
    if (!shape) return
    const budget = overBudget()
    if (budget) return kill(budget)
    const data = event.data as Record<string, unknown>
    switch (shape.kind) {
      case 'api':
        void handleApi(shape.id, data)
        return
      case 'subscribe':
        handleSubscribe(shape.id, data)
        return
      case 'state.get':
      case 'state.set':
        void handleState(shape.id, shape.kind, data)
        return
      case 'ui':
        handleUi(shape.id, data)
        return
      case 'cancel': {
        const target = data.target
        if (typeof target === 'number') {
          inFlight.get(target)?.abort()
          inFlight.delete(target)
        }
        return
      }
      default:
        post(failed(shape.id, 'bad_request', `unknown bridge message ${shape.kind}`))
    }
  }

  port.start?.()
  // The frame's SDK resolves `connect()` on this, so it goes out before anything else can.
  post({ kind: 'ready', context: input.context })

  return {
    dispose(): void {
      if (!alive) return
      alive = false
      teardown()
    },
  }
}

/** Push an appearance change into a live frame. Separate from the bridge so the host can call it on a
 * theme switch without holding the port itself. */
export const postAppearance = (port: MessagePort, appearance: Omit<PluginBridgeAppearance, 'kind'>): void => {
  port.postMessage({ kind: 'appearance', ...appearance } satisfies PluginBridgeAppearance)
}

/** Push a rail-row selection into a live frame, for the same reason postAppearance exists: the host has
 * to reach a mounted frame without holding its port (docs/plugins.md). */
export const postSelect = (port: MessagePort, item: string): void => {
  port.postMessage({ kind: 'select', item } satisfies PluginBridgeSelect)
}
