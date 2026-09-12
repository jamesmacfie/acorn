// The host side of one sandboxed plugin frame's bridge. See docs/plugins.md § Enforcement.
//
// One of these per frame. It holds the binding, the plugin id, node, task, project and declared scopes,
// and the frame cannot influence any of it: every message is checked against values the host read off the
// manifest and chose when it created the frame. That is the whole security model in one sentence, and it
// is why this module has no ambient reads at all.
//
// Effects arrive as `services` rather than being imported. This module is the security choke point and
// has to be exhaustively tested, and client-core's suite runs in plain Node with no DOM
// (packages/client-core/vitest.config.ts says so). Importing the notification ring, the prefs writer and
// the query client here would make the one module that most needs testing the one that cannot be.
// PluginFrame.tsx supplies the real implementations; the tests supply spies. One implementation, but the
// seam pays for itself.
import type {
  PluginBridgeAppearance,
  PluginBridgeEvent,
  PluginBridgeMessage,
  PluginBridgeReply,
  PluginBridgeSelect,
  PluginBridgeSurfaceAction,
  PluginFrameContext,
} from '@acorn/protocol/plugin/bridge.ts'
import { MAX_DOCUMENT_BYTES, MAX_OVERLAY_INPUT_BYTES, MAX_PLUGIN_BYTES, PLUGIN_BRIDGE_DENIED } from '@acorn/protocol/plugin/bridge.ts'
import { MAX_PLUGIN_STATE_BYTES, pluginStateKey } from '@acorn/protocol/plugin/state.ts'
import { isPluginOpenableUrl } from '@acorn/protocol/externalUrl.ts'
import { isAllowedWebviewUrl } from '@acorn/protocol/webview.ts'
import { isNormalizedChord } from '@acorn/protocol/keybindings.ts'
import { emitEvent, recordDuration } from '../../infra/telemetry/emitter'
import { recordFrameTelemetry } from './frameTelemetry'
import { allowApi, isApiMethod, type ApiMethod } from './scopes'

// What the frame is, as the host decided it. Nothing here is ever read from a message.
export type FrameBinding = {
  pluginId: string
  // The contribution id this frame renders, and which registry it landed in. `remote` is the tree
  // path: the same bridge, over a worker port instead of a frame’s. `inline` is a rectangle standing
  // in another plugin's pane, which grants it nothing of that plugin's (@acorn/protocol/plugin/bridge.ts).
  surface: string
  target: 'pane' | 'refPanel' | 'settings' | 'importer' | 'webview' | 'overlay' | 'coreSlot' | 'remote' | 'inline'
  nodeId: string
  taskId?: string
  projectId?: string
  // Manifest-declared scopes and event channels.
  api: readonly string[]
  events: readonly string[]
  // The pane ids this plugin contributed. `openPane` may name one of these and nothing else. A plugin
  // cannot use the bridge to drive the rest of the shell's layout.
  panes: readonly string[]
  destinations?: readonly { id: string; targetKind: string }[]
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

/** `FrameApiResult` for a call that asked for bytes. The success arm never went near a JSON parser; the
 *  failure arm did, because a refusal is JSON however the request was framed. */
export type FrameBytesResult =
  | { ok: true; status: number; bytes: Uint8Array; type: string; filename: string | null }
  | { ok: false; status: number; error?: { code: string; message: string; requestId: string; retryable: boolean } }

// The host effects a bridge is allowed to cause. Deliberately small and closed: adding a member here is a
// deliberate widening of what third-party UI can do.
export type FrameServices = {
  // Forward an already-allowed call. Pinned to the frame's node by the caller that builds this.
  fetch(method: ApiMethod, path: string, body: unknown, signal: AbortSignal): Promise<FrameApiResult>
  // The same, for a call whose body is bytes in one direction or both. Separate rather than a mode on
  // `fetch`, because the two differ in what they do to the response: this one must not put it through a
  // JSON parser, which is exactly what the other one does.
  fetchBytes(
    method: 'GET' | 'POST',
    path: string,
    body: { bytes: Uint8Array; type: string; filename?: string } | undefined,
    signal: AbortSignal,
  ): Promise<FrameBytesResult>
  // Attach to one shell event channel; returns the detach.
  subscribe(channel: string, listener: (payload: unknown) => void): () => void
  stateGet(key: string): unknown
  stateSet(key: string, value: unknown): Promise<void>
  toast(title: string, detail?: string): void
  copy(text: string): void
  openPane(paneId: string): void
  openTarget?(target: { kind: string; resourceId: string; subresourceId?: string }): void
  // Resolve an https URL somewhere: in-app if a content-link recogniser claims it, the owner's browser
  // otherwise. Returns nothing on purpose; see the `openUrl` case below for why the frame is told neither
  // the outcome nor when it happened.
  openUrl(url: string): void
  // Whether input focus is currently inside this frame's document, the host-side evidence that an
  // `openUrl` came from a person interacting with the frame (a click or keypress gives the iframe focus)
  // rather than from code running behind a surface the reader is not touching. Supplied by the component
  // that owns the iframe element; the broker cannot see the DOM.
  frameHasFocus(): boolean
  // Importer lifecycle. `done` is the host's post-import refresh; `close` is plain dismissal.
  importerDone(): void
  // `result` is an overlay's answer for whoever opened it. Absent for an importer, and absent for an
  // overlay dismissed rather than answered, which the opener sees as `null` either way.
  importerClose(result?: unknown): void
  webviewNavigate?(url: string): Promise<boolean>
  webviewCommand?(action: 'back' | 'forward' | 'reload'): Promise<boolean>
  keydown(chord: string): void
  // The document a composed pane's host region is drawing, supplied only when this frame shares its
  // rectangle with one. Its absence is the whole permission check for the `document` verb: there is no
  // scope to declare, because the grant is structural. A frame either has a document beside it or it does
  // not, and which one is a fact about the manifest the host already read.
  //
  // Shaped inline rather than imported from editor/documentModel, for the reason at the top of this file:
  // the broker is the choke point that must stay testable in plain Node, and that module reaches a
  // registry at import time.
  document?: {
    read(): string
    write(text: string): void
    flush(): Promise<void>
  }
}

// A broken plugin must not be able to busy-loop the shell. These are generous for anything honest: a frame
// doing real work sends a handful of messages per interaction.
const MAX_IN_FLIGHT = 100
const MAX_PER_WINDOW = 1000
const WINDOW_MS = 10_000

// The message kinds a histogram is kept for. Closed, because the kind arrives from the frame and a
// seam name built from attacker-controlled text is an unbounded map: anything else lands in `other`
// and the switch below answers it with `unknown bridge message`.
const MEASURED_KINDS: ReadonlySet<string> = new Set([
  'api', 'api.bytes', 'subscribe', 'state.get', 'state.set', 'ui', 'document', 'webview', 'cancel', 'keydown', 'telemetry',
])

// A navigation is a person's act, so one per second is generous: a real reader clicks one link and then
// reads what opened. This is the cap on how fast a focused frame can push the reader around, because the
// focus check alone is a raised bar rather than a wall: a visible frame's own script can pull focus to
// itself. If that is ever abused the upgrade is real user-activation plumbing through the sandbox, not a
// longer window here.
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

// A message is only a message if it has a positive integer id and a string kind. Anything else is not a
// malformed request. It is not a request, and there is nothing to reply to.
const requestShape = (data: unknown): { id: number; kind: string } | null => {
  if (!data || typeof data !== 'object') return null
  const { id, kind } = data as { id?: unknown; kind?: unknown }
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return null
  if (typeof kind !== 'string') return null
  return { id, kind }
}

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).byteLength

/** Does this value fit the overlay conversation's ceiling, and is it something structured clone would
 *  have carried anyway? A cycle or a BigInt fails both questions at once, which is why one `try` answers
 *  them together. */
export const withinOverlayBudget = (value: unknown): boolean => {
  try {
    return utf8Bytes(JSON.stringify(value ?? null) ?? 'null') <= MAX_OVERLAY_INPUT_BYTES
  } catch {
    return false
  }
}

export function createFrameBridge(input: {
  port: MessagePort
  binding: FrameBinding
  services: FrameServices
  context: PluginFrameContext
  // Called when the rate limiter trips. The port is already dead by then; the host shows a "plugin
  // misbehaving" placeholder in place of the surface.
  onMisbehaving(reason: string): void
  // Called once, on the first message of any kind from the frame: the SDK's `connected` ack, or a real
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
  // outstanding work. A frame that opens 100 slow requests and never awaits them is as bad as one that
  // sends 10k fast ones.
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

  /** The rate limiter tripping, as a record. An event and not an error: the host is working exactly
   *  as designed, and what the owner wants to know is which plugin keeps hitting the ceiling. */
  const reportOverBudget = (reason: string): void => {
    emitEvent(binding.pluginId, 'bridge.overbudget', {
      seam: 'bridge.message',
      'plugin.surface': binding.surface,
      'bridge.limit': reason.startsWith('more than ' + MAX_IN_FLIGHT) ? 'in-flight' : 'rate',
    })
  }

  const handleApi = async (id: number, data: Record<string, unknown>): Promise<void> => {
    const { method, path, body } = data as { method?: unknown; path?: unknown; body?: unknown }
    if (typeof path !== 'string' || !isApiMethod(method)) {
      post(failed(id, 'bad_request', 'an api request needs a method and a path'))
      return
    }
    const decision = allowApi(binding, method, path)
    if (!decision.allowed) {
      // Never reaches services.fetch. The e2e suite asserts exactly this by spying at the broker: a denied
      // path must not produce a request, not merely a discarded response.
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

  // The same call as `handleApi`, for a route whose body is bytes (docs/plugins.md § Binary bridge
  // calls). The two share one thing and it is the important one: `allowApi` decides before either looks
  // at a body, so the byte path cannot be used to reach a path the JSON path would refuse.
  const handleApiBytes = async (id: number, data: Record<string, unknown>): Promise<void> => {
    const { method, path, bytes, type, filename } = data as {
      method?: unknown; path?: unknown; bytes?: unknown; type?: unknown; filename?: unknown
    }
    if (typeof path !== 'string' || (method !== 'GET' && method !== 'POST')) {
      post(failed(id, 'bad_request', 'a byte request needs GET or POST and a path'))
      return
    }
    const decision = allowApi(binding, method, path)
    if (!decision.allowed) {
      // Same guarantee as the JSON path, and the same test pins it: a denied path must never produce a
      // request. Checked here, before the body is read, so a 12 MiB POST at another plugin's namespace
      // is refused without being looked at.
      post(denied(id, decision.reason))
      return
    }
    let body: { bytes: Uint8Array; type: string; filename?: string } | undefined
    if (method === 'POST') {
      if (!(bytes instanceof Uint8Array)) {
        post(failed(id, 'bad_request', 'a byte POST needs a Uint8Array body'))
        return
      }
      if (bytes.byteLength > MAX_PLUGIN_BYTES) {
        post(failed(id, 'bad_request', `binary bridge calls are capped at ${MAX_PLUGIN_BYTES} bytes`))
        return
      }
      // Advisory metadata, bounded here so a frame cannot use a header as a side channel. What the
      // bytes actually are is decided by whatever receives them.
      if (type !== undefined && (typeof type !== 'string' || type.length > 128)) {
        post(failed(id, 'bad_request', 'a byte body’s type must be a short media type'))
        return
      }
      if (filename !== undefined && (typeof filename !== 'string' || filename.length > 500)) {
        post(failed(id, 'bad_request', 'a byte body’s filename must be a short name'))
        return
      }
      body = {
        bytes,
        type: typeof type === 'string' && type ? type : 'application/octet-stream',
        ...(typeof filename === 'string' && filename ? { filename } : {}),
      }
    }
    const controller = new AbortController()
    inFlight.set(id, controller)
    try {
      const result = await services.fetchBytes(method, path, body, controller.signal)
      if (!inFlight.has(id)) return // cancelled while in flight; the frame stopped caring
      if (!result.ok) {
        post({
          id,
          ok: false,
          error: result.error ?? { code: 'internal', message: `${method} failed with ${result.status}`, requestId: '', retryable: result.status >= 500 },
        })
        return
      }
      if (result.bytes.byteLength > MAX_PLUGIN_BYTES) {
        post(failed(id, 'too_large', `binary bridge calls are capped at ${MAX_PLUGIN_BYTES} bytes`))
        return
      }
      post({ id, ok: true, status: result.status, body: { bytes: result.bytes, type: result.type, filename: result.filename } })
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
    // Declared in the manifest, and a channel the shell actually has. `services.subscribe` returning null
    // is the second half: subscribing does not create a channel.
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
        // Own panes only. The allowlist is the manifest's own contribution ids, so this cannot be used to
        // drive first-party layout.
        if (typeof paneId !== 'string' || !binding.panes.includes(paneId)) {
          return void post(denied(id, 'openPane may only name a pane this plugin contributed'))
        }
        services.openPane(paneId)
        return void post({ id, ok: true, status: 200, body: null })
      }
      case 'openDestination': {
        const destinationId = data.destinationId
        const resourceId = data.resourceId
        const subresourceId = data.subresourceId
        const destination = typeof destinationId === 'string'
          ? binding.destinations?.find((entry) => entry.id === destinationId)
          : undefined
        if (!destination || typeof resourceId !== 'string' || !resourceId || resourceId.length > 300
          || (subresourceId !== undefined && (typeof subresourceId !== 'string' || subresourceId.length > 300))) {
          return void post(denied(id, 'openDestination must name a declared destination and bounded resource'))
        }
        services.openTarget?.({ kind: destination.targetKind, resourceId, ...(subresourceId === undefined ? {} : { subresourceId }) })
        return void post({ id, ok: true, status: 200, body: null })
      }
      case 'openUrl': {
        const url = data.url
        // The boundary. A URL from a frame is untrusted input on its way to the navigation layer, so the
        // scheme is decided here against the same policy a manifest's `openUrl` descriptor is held to
        // (@acorn/protocol/externalUrl.ts). `file:`, `javascript:`, `data:` and the frame's own
        // `app-plugin://` origin are all refused by that one clause, and none of them reaches the host.
        if (typeof url !== 'string' || !isPluginOpenableUrl(url)) {
          return void post(denied(id, 'openUrl may only be given an https URL'))
        }
        // A navigation must be a person's act. A click or keypress inside the frame's document gives the
        // iframe focus, so honouring the verb only while the frame holds it means background code cannot
        // move the reader, which the SDK's `openLinkOnClick` satisfies for free. See OPEN_URL_MIN_GAP_MS
        // above for why the throttle backs the focus check up.
        if (!services.frameHasFocus()) {
          return void post(denied(id, 'openUrl works from a click or key handler: the frame must be focused'))
        }
        const now = Date.now()
        if (now - lastOpenUrlAt < OPEN_URL_MIN_GAP_MS) {
          return void post(denied(id, 'openUrl is limited to one navigation per second'))
        }
        lastOpenUrlAt = now
        // The reply goes out before the effect, the opposite of every other verb here. The ladder can
        // replace the reference panel this very frame is rendering inside, which is the whole point of the
        // refPanel presentation, and doing so disposes this bridge from inside the call, so a reply posted
        // afterwards is one `post` would silently drop. Whether an already-queued message survives the port
        // closing is the runtime's business (Node's MessageChannel drops it, which is why the suite pins
        // the teardown rather than the ordering) and by then the frame's document is going away too;
        // posting first is simply the order with no failure mode of its own.
        //
        // `ok` means accepted and nothing more. Reporting whether the URL resolved in-app or opened the
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
        // `close`, the SDK's `ui.close()`, is the one an overlay also gets, because dismissing itself is
        // the whole gesture of a picker: pick a thing, then get out of the way. `done` stays importer-only,
        // since what it means is "run the host's post-import refresh", which an overlay has no business
        // asking for. The wire spelling stays `importer.*` so every shipped frame SDK keeps working; what
        // an author calls is `acorn.ui.close()`.
        const dismissible = binding.target === 'importer' || (op === 'importer.close' && binding.target === 'overlay')
        if (!dismissible) {
          return void post(denied(id, `${op} is only valid from an importer surface`))
        }
        if (op === 'importer.done') services.importerDone()
        else {
          // A result is an overlay answering the tree that opened it (docs/plugins.md § Companion
          // overlays). An importer has nobody awaiting a value, so supplying one there is a frame
          // built against the wrong surface and is refused rather than dropped.
          const result = (data as { result?: unknown }).result
          if (result !== undefined && binding.target !== 'overlay') {
            return void post(denied(id, 'only an overlay closes with a result'))
          }
          if (result !== undefined && !withinOverlayBudget(result)) {
            return void post(failed(id, 'bad_request', `an overlay result is capped at ${MAX_OVERLAY_INPUT_BYTES} bytes`))
          }
          services.importerClose(result)
        }
        return void post({ id, ok: true, status: 200, body: null })
      }
      default:
        return void post(failed(id, 'bad_request', `unknown ui op ${String(op)}`))
    }
  }

  // The composed pane's shared document (docs/editor.md § Communication between regions).
  // Three operations, and the interesting thing about them is what is not here: no cursor, no selection,
  // no decorations, no "open this other document". Each of those is either the host's state or an
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
    if (budget) {
      reportOverBudget(budget)
      return kill(budget)
    }
    // A histogram and never a span: a frame doing real work sends a handful of messages per
    // interaction, and one drawing a chart sends thousands (docs/telemetry.md § Hot seams are
    // metrics). The kind is in the seam name rather than an attribute, because a histogram is
    // keyed by seam and `api` and `state.set` are different questions.
    const kind = MEASURED_KINDS.has(data.kind) ? data.kind : 'other'
    const from = performance.now()
    // Synchronous only. The handlers below that return a promise reply on their own schedule, and
    // measuring to the reply would be measuring the node rather than the bridge, which
    // `api.request` already does.
    //
    // No attributes. A histogram is keyed by owner and seam, and the collector keeps the first
    // sample's attributes for the whole window, so anything that varies between samples would
    // report one frame's value for all of them.
    const measured = <T>(run: () => T): T => {
      try {
        return run()
      } finally {
        recordDuration(binding.pluginId, `bridge.message.${kind}`, performance.now() - from)
      }
    }
    if (data.kind === 'keydown') {
      return measured(() => {
        if (typeof data.chord === 'string' && isNormalizedChord(data.chord)) services.keydown(data.chord)
      })
    }
    // Like `keydown` and `connected`, this one has no id and gets no reply: telemetry never fails
    // the thing it describes, so there is no outcome to await (./frameTelemetry.ts). The owner is
    // the binding's, never the message's, which is what stops a frame filing a record under another
    // plugin's name.
    if (data.kind === 'telemetry') {
      return measured(() => recordFrameTelemetry(binding.pluginId, data.record))
    }
    const shape = requestShape(data)
    if (!shape) return
    return measured(() => {
      switch (shape.kind) {
        case 'api':
          void handleApi(shape.id, data)
          return
        case 'api.bytes':
          void handleApiBytes(shape.id, data)
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
    })
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

/** Deliver a surface-scoped command the host resolved on this frame's behalf, because the chord landed in
 * the host's half of a composed pane. The caller owes the flush-before-action guarantee; it is the side
 * that holds the document. */
export const postSurfaceAction = (port: MessagePort, command: string): void => {
  port.postMessage({ kind: 'surfaceAction', command } satisfies PluginBridgeSurfaceAction)
}
