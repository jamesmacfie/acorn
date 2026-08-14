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
  PluginBridgeSurfaceAction,
  PluginFrameContext,
} from '@acorn/protocol/pluginBridge.ts'
import { MAX_DOCUMENT_BYTES, PLUGIN_BRIDGE_DENIED } from '@acorn/protocol/pluginBridge.ts'
import { MAX_PLUGIN_STATE_BYTES, pluginStateKey } from '@acorn/protocol/pluginState.ts'
import { isPluginOpenableUrl } from '@acorn/protocol/externalUrl.ts'
import { isAllowedWebviewUrl } from '@acorn/protocol/webview.ts'
import { isNormalizedChord } from '@acorn/protocol/keybindings.ts'
import { allowApi, isApiMethod, type ApiMethod } from './scopes'

// What the frame is, as the host decided it. Nothing here is ever read from a message.
export type FrameBinding = {
  pluginId: string
  // The contribution id this frame renders, and which registry it landed in.
  surface: string
  target: 'pane' | 'refPanel' | 'settings' | 'importer' | 'webview' | 'overlay'
  nodeId: string
  taskId?: string
  projectId?: string
  // Manifest-declared scopes and event channels.
  api: readonly string[]
  events: readonly string[]
  // The pane ids this plugin contributed. `openPane` may name one of these and nothing else — a plugin
  // cannot use the bridge to drive the rest of the shell's layout.
  panes: readonly string[]
  // Populated only for a webview binding, from the manifest row the host read.
  hosts?: readonly string[]
  // Host-validated declaration for this exact surface.
  claimsKeys: readonly string[]
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
  // Resolve an https URL somewhere: in-app if a content-link recogniser claims it, the owner's browser
  // otherwise. Returns nothing on purpose — see the `openUrl` case below for why the frame is told
  // neither the outcome nor when it happened.
  openUrl(url: string): void
  // Whether input focus is currently inside this frame's document — the host-side evidence that an
  // `openUrl` came from a person interacting with the frame (a click or keypress gives the iframe
  // focus) rather than from code running behind a surface the reader is not touching. Supplied by
  // the component that owns the iframe element; the broker cannot see the DOM.
  frameHasFocus(): boolean
  // Importer lifecycle. `done` is the host's post-import refresh; `close` is plain dismissal.
  importerDone(): void
  importerClose(): void
  webviewNavigate?(url: string): Promise<boolean>
  webviewCommand?(action: 'back' | 'forward' | 'reload'): Promise<boolean>
  keydown(chord: string): void
  // The document a composed pane's host region is drawing, supplied ONLY when this frame shares its
  // rectangle with one. Its absence is the whole permission check for the `document` verb — there is no
  // scope to declare, because the grant is structural: a frame either has a document beside it or it
  // does not, and which one is a fact about the manifest the host already read.
  //
  // Shaped inline rather than imported from editor/documentModel, for the reason at the top of this
  // file: the broker is the choke point that must stay testable in plain Node, and that module reaches a
  // registry at import time.
  document?: {
    read(): string
    write(text: string): void
    flush(): Promise<void>
  }
}

// A broken plugin must not be able to busy-loop the shell. These are generous for anything honest: a
// frame doing real work sends a handful of messages per interaction.
const MAX_IN_FLIGHT = 100
const MAX_PER_WINDOW = 1000
const WINDOW_MS = 10_000

// A navigation is a person's act, so one per second is generous — a real reader clicks one link and
// then reads what opened. This is the cap on how fast a focused frame can push the reader around,
// because the focus check alone is a raised bar rather than a wall: a visible frame's own script can
// pull focus to itself. If that is ever abused the upgrade is real user-activation plumbing through
// the sandbox, not a longer window here.
const OPEN_URL_MIN_GAP_MS = 1000

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
  // Called once, on the first message of ANY kind from the frame — the SDK's `connected` ack, or a real
  // request from a bundle built before that ack existed. It is the host's only evidence that the bundle
  // evaluated, and it cancels the handshake deadline in PluginFrame.
  onConnected?(): void
}): FrameBridge {
  const { port, binding, services, onMisbehaving } = input
  let spoke = false

  const inFlight = new Map<number, AbortController>()
  const detachers: (() => void)[] = []
  const subscribed = new Set<string>()
  let windowStart = Date.now()
  let windowCount = 0
  let lastOpenUrlAt = 0
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
      case 'openUrl': {
        const url = data.url
        // The boundary. A URL from a frame is untrusted input on its way to the navigation layer, so the
        // scheme is decided here against the same policy a manifest's `openUrl` descriptor is held to
        // (@acorn/protocol/externalUrl.ts) — `file:`, `javascript:`, `data:` and the frame's own
        // `app-plugin://` origin are all refused by that one clause, and none of them reaches the host.
        if (typeof url !== 'string' || !isPluginOpenableUrl(url)) {
          return void post(denied(id, 'openUrl may only be given an https URL'))
        }
        // A navigation must be a person's act. A click or keypress inside the frame's document gives
        // the iframe focus, so honouring the verb only while the frame holds it means background code
        // cannot move the reader — the SDK's `openLinkOnClick` satisfies this for free. See
        // OPEN_URL_MIN_GAP_MS above for why the throttle backs the focus check up.
        if (!services.frameHasFocus()) {
          return void post(denied(id, 'openUrl works from a click or key handler — the frame must be focused'))
        }
        const now = Date.now()
        if (now - lastOpenUrlAt < OPEN_URL_MIN_GAP_MS) {
          return void post(denied(id, 'openUrl is limited to one navigation per second'))
        }
        lastOpenUrlAt = now
        // The reply goes out BEFORE the effect, which is the opposite of every other verb here. The
        // ladder can replace the reference panel this very frame is rendering inside — that is the whole
        // point of the refPanel presentation — and doing so disposes this bridge from inside the call, so
        // a reply posted afterwards is one `post` would silently drop. Whether an already-queued message
        // survives the port closing is the runtime's business (Node's MessageChannel drops it, which is
        // why the suite pins the teardown rather than the ordering) and by then the frame's document is
        // going away too; posting first is simply the order with no failure mode of its own.
        //
        // `ok` means ACCEPTED and nothing more. Reporting whether the URL resolved in-app or opened the
        // browser would tell a frame where the host sent the reader, which is not its business.
        post({ id, ok: true, status: 200, body: null })
        services.openUrl(url)
        return
      }
      case 'importer.done':
      case 'importer.close': {
        // The surface decides, not the message. An importer frame decides when it is done; it never
        // decides how the shell reacts, and a pane cannot claim to be an importer at all.
        //
        // `close` — the SDK's `ui.close()` — is the one an OVERLAY also gets, because dismissing itself
        // is the whole gesture of a picker: pick a thing, then get out of the way. `done` stays importer-
        // only, since what it means is "run the host's post-import refresh", which an overlay has no
        // business asking for. The wire spelling stays `importer.*` so every shipped frame SDK keeps
        // working; what an author calls is `acorn.ui.close()`.
        const dismissible = binding.target === 'importer' || (op === 'importer.close' && binding.target === 'overlay')
        if (!dismissible) {
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

  // The composed pane's shared document (docs/future/monaco.md § Communication between regions). Three
  // operations, and the interesting thing about them is what is NOT here: no cursor, no selection, no
  // decorations, no "open this other document". Each of those is either the host's state or an
  // LSP-shaped route, and the growth rule sends new asks to the second rather than to this list.
  const handleDocument = async (id: number, data: Record<string, unknown>): Promise<void> => {
    const doc = services.document
    if (!doc) {
      post(denied(id, 'document operations need a pane whose layout declares a document region'))
      return
    }
    const op = data.op
    try {
      switch (op) {
        case 'read':
          post({ id, ok: true, status: 200, body: { text: doc.read() } })
          return
        case 'write': {
          const text = data.text
          if (typeof text !== 'string') {
            post(failed(id, 'bad_request', 'a document write needs text'))
            return
          }
          // The same ceiling the read path enforces, applied in the other direction: a frame must not be
          // able to push a document into the editor that the editor would then refuse to load back.
          if (utf8Bytes(text) > MAX_DOCUMENT_BYTES) {
            post(failed(id, 'bad_request', `documents are capped at ${MAX_DOCUMENT_BYTES} bytes`))
            return
          }
          doc.write(text)
          post({ id, ok: true, status: 200, body: null })
          return
        }
        case 'flush':
          await doc.flush()
          post({ id, ok: true, status: 200, body: null })
          return
        default:
          post(failed(id, 'bad_request', `unknown document op ${String(op)}`))
      }
    } catch (error) {
      post(failed(id, 'internal', error instanceof Error ? error.message : String(error)))
    }
  }

  const handleWebview = async (id: number, data: Record<string, unknown>): Promise<void> => {
    if (binding.target !== 'webview') {
      post(denied(id, 'webview operations are only valid from a webview surface'))
      return
    }
    const op = data.op
    try {
      if (op === 'navigate') {
        const url = data.url
        if (typeof url !== 'string' || !isAllowedWebviewUrl(url, binding.hosts ?? [])) {
          post(denied(id, 'navigate must stay inside this surface’s declared hosts'))
          return
        }
        if (!services.webviewNavigate || !(await services.webviewNavigate(url))) {
          post(failed(id, 'unavailable', 'the host webview is not available'))
          return
        }
      } else if (op === 'back' || op === 'forward' || op === 'reload') {
        if (!services.webviewCommand || !(await services.webviewCommand(op))) {
          post(failed(id, 'unavailable', 'the host webview is not available'))
          return
        }
      } else {
        post(failed(id, 'bad_request', `unknown webview op ${String(op)}`))
        return
      }
      post({ id, ok: true, status: 200, body: null })
    } catch (error) {
      post(failed(id, 'internal', error instanceof Error ? error.message : String(error)))
    }
  }

  port.onmessage = (event: MessageEvent) => {
    if (!alive) return
    if (!event.data || typeof event.data !== 'object') return
    const data = event.data as Record<string, unknown>
    if (typeof data.kind !== 'string') return
    // Before the budget check, deliberately: even a frame whose first act is to flood the port has
    // demonstrably started, and reporting it as "failed to start" as well as "misbehaving" would be two
    // placeholders racing for one rectangle.
    if (!spoke) {
      spoke = true
      input.onConnected?.()
    }
    const budget = overBudget()
    if (budget) return kill(budget)
    if (data.kind === 'keydown') {
      if (typeof data.chord === 'string' && isNormalizedChord(data.chord)) services.keydown(data.chord)
      return
    }
    const shape = requestShape(data)
    if (!shape) return
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
      case 'document':
        void handleDocument(shape.id, data)
        return
      case 'webview':
        void handleWebview(shape.id, data)
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

/** Push a host-owned event such as webview navigation into its controller frame. */
export const postBridgeEvent = (port: MessagePort, channel: string, payload: unknown): void => {
  port.postMessage({ kind: 'event', channel, payload } satisfies PluginBridgeEvent)
}

/** Deliver a surface-scoped command the host resolved on this frame's behalf, because the chord landed
 * in the host's half of a composed pane. The CALLER owes the flush-before-action guarantee — it is the
 * side that holds the document. */
export const postSurfaceAction = (port: MessagePort, command: string): void => {
  port.postMessage({ kind: 'surfaceAction', command } satisfies PluginBridgeSurfaceAction)
}
