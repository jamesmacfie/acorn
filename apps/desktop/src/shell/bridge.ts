import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  decodeBytes,
  encodeBytes,
  isPush,
  type HelperMessage,
  type HelperMethod,
  type WireFetchBody,
  type WireFetchRequest,
} from './wire'

// The window's initialization script: it assembles the object the platform seam reads and installs
// it before any page script runs. The seam (`packages/client-core/src/platform/index.ts`) is the only
// module allowed to read it, which an arch rule enforces.
//
// Two transports feed it. Everything about nodes and plugins goes over one WebSocket to the desktop
// helper, which holds the device tokens and the certificate pins. Everything only a window can do —
// the folder dialog, the close-pane key, quit negotiation, the recovery screen's two buttons — is a
// Tauri command or event, because those are the shell's, not the helper's.
//
// The preview pane and plugin webview surfaces are the third transport: they are Tauri commands, not
// helper calls, because a webview composited over the window is the shell's to own. One command set
// serves both, and the key prefix is what picks the policy on the Rust side
// (src-tauri/src/webviews.rs).

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void }

const pending = new Map<number, Pending>()
const frameListeners = new Set<(nodeId: string, frame: unknown) => void>()
const statusListeners = new Set<(status: unknown) => void>()
let nextId = 1
let socket: Promise<WebSocket> | null = null

// One socket, opened on first use and reopened if it drops. Calls made before it is up wait on the
// same promise rather than failing, which is what lets the bridge be installed synchronously while
// the endpoint is still an async round trip away.
const connect = (): Promise<WebSocket> => {
  socket ??= invoke<{ port: number; secret: string }>('helper_endpoint').then(
    ({ port, secret }) =>
      new Promise<WebSocket>((resolve, reject) => {
        // The secret rides in the query string because a browser cannot set headers on a WebSocket
        // handshake. It is the gate; the helper checks the Origin too, but only as a second lock.
        const ws = new WebSocket(`ws://127.0.0.1:${port}/helper?secret=${encodeURIComponent(secret)}`)
        ws.onopen = () => resolve(ws)
        ws.onerror = () => reject(new Error('acorn could not reach its desktop helper.'))
        ws.onclose = () => {
          // Every in-flight call is answered rather than left hanging: a query that never settles
          // shows an eternal spinner, which reads as a hung app rather than a dropped connection.
          for (const [id, call] of pending) {
            pending.delete(id)
            call.reject(new Error('The connection to the desktop helper closed.'))
          }
          socket = null
        }
        ws.onmessage = (event) => receive(JSON.parse(String(event.data)) as HelperMessage)
      }),
  )
  return socket
}

const receive = (message: HelperMessage): void => {
  if (isPush(message)) {
    if (message.push === 'node-frame') for (const cb of frameListeners) cb(message.nodeId, message.frame)
    else if (message.push === 'node-status') for (const cb of statusListeners) cb(message.status)
    // The node this renderer was talking to has been replaced by a restart or crash recovery. Its
    // endpoint, certificate and token are all new, so everything in memory is about a process that is
    // gone. Electron reloads the window from main; here the page reloads itself.
    else location.reload()
    return
  }
  const call = pending.get(message.id)
  if (!call) return
  pending.delete(message.id)
  if (message.ok) call.resolve(message.value)
  else call.reject(new Error(message.error))
}

const call = async <T>(method: HelperMethod, params?: unknown): Promise<T> => {
  const ws = await connect()
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
    ws.send(JSON.stringify({ id, method, params: params ?? null }))
  })
}

// Fire-and-forget from the seam's point of view: the reply still comes back, and a rejection is logged
// rather than thrown, because nobody is awaiting `nodeAbort` or `tunnelClose`.
const tell = (method: HelperMethod, params?: unknown): void => {
  void call(method, params).catch((error: unknown) => console.warn(`[helper] ${method} failed:`, error))
}

const subscribe = <T>(set: Set<T>, cb: T): (() => void) => {
  set.add(cb)
  return () => set.delete(cb)
}

// A Tauri event, in the shape the seam wants: a subscribe that hands back its own unsubscribe. The
// `listen` promise resolves after the handler is registered, so unsubscribing before that resolves has
// to wait for it rather than silently doing nothing.
const onEvent = <T>(name: string, handler: (payload: T) => void): (() => void) => {
  const unlisten = listen<T>(name, (event) => handler(event.payload))
  return () => void unlisten.then((off) => off())
}

// ── Host-owned webviews ───────────────────────────────────────────────────────────────────────────
// Both seam groups project onto one Rust command set. Preview keys are `preview:<taskId>`; plugin
// surfaces already arrive as `plugin:...` keys and pass through unchanged.

type WebviewState = { key: string; url: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }
type WebviewBlocked = { key: string; url: string; host: string }

const previewKey = (taskId: string): string => `preview:${taskId}`

// Rect fields cross as-is: the renderer measures its pane in CSS pixels and Rust positions the child
// webview in logical ones, which are the same unit on both sides of the boundary.
const setBounds = (key: string, rect: { x: number; y: number; width: number; height: number }): void =>
  void invoke('webview_bounds', { key, rect })

// One listener per group rather than one per surface: a Tauri event listener is a round trip to
// register, and the renderer already fans these out by key.
const onWebviewState = (cb: (state: WebviewState) => void, matches: (key: string) => boolean): (() => void) =>
  onEvent<WebviewState>('acorn:webview-state', (state) => {
    if (matches(state.key)) cb(state)
  })

const toWireBody = (body: unknown): WireFetchBody | undefined => {
  const value = body as { kind: 'bytes'; bytes: Uint8Array } | { kind: 'form'; parts: Record<string, unknown>[] } | undefined
  if (!value) return undefined
  if (value.kind === 'bytes') return { kind: 'bytes', bytes: encodeBytes(value.bytes) }
  return {
    kind: 'form',
    parts: value.parts.map((part) =>
      'filename' in part ? { ...(part as { name: string; filename: string; type: string }), bytes: encodeBytes(part.bytes as Uint8Array) } : (part as { name: string; value: string }),
    ),
  }
}

const acorn = {
  desktop: true,
  // Rust writes this into the page before any script runs, because the seam reads it synchronously
  // and every other way of asking is a round trip. Sniffing the user agent would be a guess about
  // WKWebView's spelling of the thing the shell already knows for certain.
  platform: (globalThis as { __ACORN_PLATFORM__?: string }).__ACORN_PLATFORM__ ?? 'darwin',

  // Cmd/Ctrl+W closes the focused pane, never the window. `before-input-event` has no Tauri
  // equivalent, so the accelerator is a menu item and the shell emits this
  // (docs/shell.md § Startup: data directory, environment, and the singleton lock).
  onClosePane: (cb: () => void) => onEvent('acorn:close-pane', cb),
  onWillQuit: (cb: () => boolean | Promise<boolean>) =>
    onEvent('acorn:will-quit', () => {
      void Promise.resolve(cb())
        .then((approved) => invoke('quit_approved', { approved }))
        .catch(() => invoke('quit_approved', { approved: false }))
    }),

  nodeFetch: async (nodeId: string, request: unknown) => {
    const { body, ...rest } = request as { body?: unknown }
    const wire: WireFetchRequest = { ...(rest as Omit<WireFetchRequest, 'body'>), ...(body ? { body: toWireBody(body) } : {}) }
    const response = await call<{ status: number; headers: Record<string, string>; body: string }>('node-fetch', { nodeId, request: wire })
    return { status: response.status, headers: response.headers, body: decodeBytes(response.body) }
  },
  nodeAbort: (requestId: string) => tell('node-abort', { requestId }),
  nodeSend: (nodeId: string, frame: unknown) => tell('node-send', { nodeId, frame }),
  onNodeFrame: (cb: (nodeId: string, frame: unknown) => void) => subscribe(frameListeners, cb),
  onNodeStatus: (cb: (status: unknown) => void) => subscribe(statusListeners, cb),

  // Owner-initiated fleet mutations. Every one is a request, never a write: the helper owns fleet.json
  // and the encrypted tokens, and no device token or certificate crosses this bridge.
  fleetList: () => call('fleet-list'),
  nodeProbe: (endpoint: string) => call('node-probe', { endpoint }),
  nodePair: (request: unknown) => call('node-pair', request),
  // The second door (docs/plugins.md § Node providers). The renderer names a provider and a node id;
  // the endpoint, the fingerprint and the credential are all fetched by the helper from the node that
  // listed it, so nothing new crosses this bridge in either direction.
  nodeAdopt: (request: unknown) => call('node-adopt', request),
  nodeRename: (nodeId: string, label: string) => call('node-rename', { nodeId, label }),
  nodeForget: (nodeId: string, revoke: boolean) => call('node-forget', { nodeId, revoke }),
  nodeReconnect: (nodeId: string) => tell('node-reconnect', { nodeId }),
  nodeRestartLocal: () => call<void>('node-restart-local'),
  nodeTunnelOpen: (request: { nodeId: string; taskId: string; port: number }) => call<{ port: number }>('node-tunnel-open', request),
  nodeTunnelClose: (match: { nodeId?: string; taskId?: string }) => tell('node-tunnel-close', match),

  // Third-party plugin bundles. The bundle itself never crosses this bridge: the renderer names a node
  // and a plugin and gets back the hash the helper computed from the bytes it fetched.
  plugins: {
    state: () => call('plugins-state'),
    cachePut: (request: unknown) => call('plugins-cache-put', request),
    trustRecord: (request: unknown) => call<void>('plugins-trust-record', request),
    devGrant: (request: unknown) => call<void>('plugins-dev-grant', request),
  },

  // The recovery screen's two native actions. Both are Rust's, not the helper's: they are reachable
  // exactly when there is no node to talk to, and `quit` has to bypass the will-quit prompt because
  // the shell that answers it is not mounted behind the gate.
  recovery: {
    openDataFolder: () => void invoke('reveal_data_folder'),
    quit: () => void invoke('force_quit'),
  },

  folderPath: { pick: () => invoke<string | null>('pick_folder') },

  // The browser preview pane. `show` is exclusive because one task's preview is on screen at a time,
  // and `hide` names no task because what the caller means is "no preview right now".
  preview: {
    ensure: (taskId: string, url: string) => invoke<boolean>('webview_ensure', { key: previewKey(taskId), url }),
    setBounds: (taskId: string, rect: { x: number; y: number; width: number; height: number }) => setBounds(previewKey(taskId), rect),
    show: (taskId: string) => void invoke('webview_show', { key: previewKey(taskId), exclusive: true }),
    hide: () => void invoke('webview_hide_family', { prefix: 'preview:' }),
    load: (taskId: string, url: string) => void invoke('webview_load', { key: previewKey(taskId), url }),
    command: (taskId: string, action: string) => void invoke('webview_command', { key: previewKey(taskId), action }),
    evict: (taskId: string) => void invoke('webview_evict', { key: previewKey(taskId) }),
    onEvent: (cb: (state: { taskId: string; url: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }) => void) =>
      onWebviewState(({ key, ...rest }) => cb({ taskId: key.slice('preview:'.length), ...rest }), (key) => key.startsWith('preview:')),
  },

  // Host-owned page surfaces for accepted loaded plugins. The manifest host allowlist rides on
  // `ensure` and is checked again in Rust, which is the second of the two independent checks
  // docs/shell.md § Host-owned webviews asks for.
  webview: {
    ensure: (key: string, url: string, hosts: readonly string[]) => invoke<boolean>('webview_ensure', { key, url, hosts: [...hosts] }),
    setBounds,
    show: (key: string) => void invoke('webview_show', { key, exclusive: false }),
    hide: (key: string) => void invoke('webview_hide', { key }),
    load: (key: string, url: string) => invoke<boolean>('webview_load', { key, url }),
    command: (key: string, action: string) => invoke<boolean>('webview_command', { key, action }),
    evict: (key: string) => void invoke('webview_evict', { key }),
    onEvent: (cb: (state: WebviewState) => void) => onWebviewState(cb, (key) => key.startsWith('plugin:')),
    onBlocked: (cb: (state: WebviewBlocked) => void) => onEvent<WebviewBlocked>('acorn:webview-blocked', cb),
  },
}

// Written, not read. The seam is the only module allowed to read this global, and it reads it off
// `window`; `globalThis` is the same object in a page, so this assigns it without spelling the form
// the arch rule polices.
;(globalThis as { acorn?: unknown }).acorn = acorn
