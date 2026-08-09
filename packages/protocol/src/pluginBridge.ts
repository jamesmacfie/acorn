// The wire between a sandboxed plugin frame and the shell that hosts it
// (docs/plugins.md).
//
// A frame has no parent DOM, no `window.acorn`, and `connect-src 'none'`. Its only door is one
// MessagePort, and these are the messages that go through it. Everything here is
// structured-clone-safe by rule: no functions, no class instances, no streams.
//
// Two rules this file exists to hold:
//
//   Scheme-agnostic. Nothing here names `app-plugin://`. The frame sees a port and the host alone
//   knows how frames are served, so the identical protocol runs unchanged in a browser iframe with an
//   opaque origin on a future web client (docs/future/remote.md).
//
//   The frame supplies no identity. There is no `pluginId`, `nodeId` or token on any request: the host
//   bound all three when it created the frame, and a message that tried to carry them would just be
//   ignored. Which is why `path` is the only addressing a request has.
//
// Types rather than Zod schemas, unlike the HTTP wire. The parsing here is hand-rolled in the broker
// (client-core/plugins/frames/broker.ts) because the trust boundary is inverted: an HTTP route
// validates a body it will act on, whereas the broker's job is to decide whether to act at all, and
// that decision is a permission check against a route table rather than a shape check. A schema in
// front of it would validate the shape of a request it is about to deny anyway.
import type { ErrorEnvelope } from './errors'

// The handshake. The host posts exactly this into the frame with the port transferred alongside, and
// the SDK's `connect()` resolves on it. Versioned so a future protocol change is a different number
// rather than a silently mis-parsed message.
export const PLUGIN_BRIDGE_VERSION = 1
export type PluginBridgeHello = { acornBridge: typeof PLUGIN_BRIDGE_VERSION }

// What the frame was opened to look at. Handed over on the port rather than read from the URL by the
// SDK, so the query string stays an implementation detail of how the host happens to serve frames.
//
// `project` is its own field rather than being derived from the task, because the surfaces that need
// it most have no task at all — an importer runs before any project exists, and a project-scoped pane
// opens from the rail.
export type PluginFrameContext = {
  // The contribution id this frame is rendering, as declared in the manifest.
  surface: string
  target: 'pane' | 'refPanel' | 'settings' | 'importer' | 'webview'
  nodeId: string
  taskId?: string
  projectId?: string
  // Reference-panel surfaces only: the external item the panel was opened for, as the host's ref
  // registry knows it. Without it a panel frame has been told to render a thing and not which thing.
  refId?: string
  // The row a declarative rail source was selected on, when the pane was opened by one
  // (docs/plugins.md). Present at connect only when the frame is being
  // created BY that selection; a later selection into an already-mounted frame arrives as a `select`
  // message, because `context` is a snapshot by contract.
  item?: string
  theme: string
  style: string
}

// ── Frame → host ──────────────────────────────────────────────────────────────────────────────────

// An HTTP call against the node this frame is pinned to. `path` is checked against the manifest's
// declared scopes before anything else happens; there is no way to name a different node.
export type PluginBridgeApiRequest = {
  id: number
  kind: 'api'
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  body?: unknown
}

// Server-push. The channel must appear in the manifest's `events` list AND be one the shell actually
// has; subscribing does not create a channel.
export type PluginBridgeSubscribeRequest = { id: number; kind: 'subscribe'; channel: string }

// Namespaced durable storage, keyed `(pluginId, key)` by the host. Distinct from the frame's own
// `localStorage`, which works but is keyed by bundle hash and so rotates with every plugin update.
export type PluginBridgeStateRequest =
  | { id: number; kind: 'state.get'; key: string }
  | { id: number; kind: 'state.set'; key: string; value: unknown }

// The closed verb set. Not "some UI operations": these five and nothing else, because each one is a
// thing the host does on the frame's behalf in the host's own realm.
export type PluginBridgeUiRequest =
  | { id: number; kind: 'ui'; op: 'toast'; title: string; detail?: string }
  | { id: number; kind: 'ui'; op: 'copy'; text: string }
  | { id: number; kind: 'ui'; op: 'openPane'; paneId: string }
  // Importer lifecycle, valid only from a frame whose surface is an importer. `done` closes the modal
  // and triggers the host's post-import refresh; `close` is plain dismissal.
  | { id: number; kind: 'ui'; op: 'importer.done' }
  | { id: number; kind: 'ui'; op: 'importer.close' }

// A webview controller can address only the surface whose binding owns its port. There is no surface,
// plugin or node identifier in the request for plugin code to forge.
export type PluginBridgeWebviewRequest =
  | { id: number; kind: 'webview'; op: 'navigate'; url: string }
  | { id: number; kind: 'webview'; op: 'back' | 'forward' | 'reload' }

// Abandon an in-flight request. The SDK sends this when an AbortSignal fires; the host stops caring
// about the response rather than pretending it can un-send an HTTP request.
export type PluginBridgeCancelRequest = { id: number; kind: 'cancel'; target: number }

export type PluginBridgeRequest =
  | PluginBridgeApiRequest
  | PluginBridgeSubscribeRequest
  | PluginBridgeStateRequest
  | PluginBridgeUiRequest
  | PluginBridgeWebviewRequest
  | PluginBridgeCancelRequest

// ── Host → frame ──────────────────────────────────────────────────────────────────────────────────

// One reply per request id. The failure arm reuses the HTTP envelope verbatim so a plugin author
// handles one error shape whether the call was denied at the bridge or refused by the node.
export type PluginBridgeReply =
  | { id: number; ok: true; status: number; body: unknown }
  | ({ id: number; ok: false } & ErrorEnvelope)

export type PluginWebviewNavigated = { url: string; canGoBack: boolean; canGoForward: boolean; loading: boolean }
export type PluginWebviewBlocked = { url: string; host: string }
export type PluginBridgeEvent = { kind: 'event'; channel: string; payload: unknown }

// Pushed on connect and again whenever the host's appearance changes. `tokens` is a flat map of CSS
// custom property names to their resolved values: pushed rather than served as a stylesheet, because
// a frame's origin is its bundle hash and a cached stylesheet at that origin could never be
// invalidated on a theme switch.
export type PluginBridgeAppearance = {
  kind: 'appearance'
  theme: string
  style: string
  tokens: Record<string, string>
}

export type PluginBridgeReady = { kind: 'ready'; context: PluginFrameContext }

// A row was selected on this plugin's declarative rail source while its pane was already mounted. The
// first such selection arrives in `context`; this is every one after it, because remounting a frame per
// click would throw away everything the plugin had drawn.
export type PluginBridgeSelect = { kind: 'select'; item: string }

export type PluginBridgeMessage =
  | PluginBridgeReply
  | PluginBridgeEvent
  | PluginBridgeAppearance
  | PluginBridgeReady
  | PluginBridgeSelect

// The code the bridge denies with. A domain code rather than `forbidden`, because a plugin author
// seeing this needs to know it is their manifest that is short, not their credentials.
export const PLUGIN_BRIDGE_DENIED = 'plugin_scope_denied'
