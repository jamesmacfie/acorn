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
  target: 'pane' | 'refPanel' | 'settings' | 'importer' | 'webview' | 'overlay'
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
  // Host-validated upper bound for the chords this frame may keep. The SDK starts with this set and
  // lets runtime code narrow it; undeclared chords are never claimable.
  claimsKeys?: string[]
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

// The closed verb set. Not "some UI operations": these six and nothing else, because each one is a
// thing the host does on the frame's behalf in the host's own realm.
export type PluginBridgeUiRequest =
  | { id: number; kind: 'ui'; op: 'toast'; title: string; detail?: string }
  | { id: number; kind: 'ui'; op: 'copy'; text: string }
  | { id: number; kind: 'ui'; op: 'openPane'; paneId: string }
  // Hand an `https` URL to the host, which then runs the same content-link ladder every shell surface
  // runs: in-app when a recogniser claims it, the owner's browser otherwise. The frame passes a URL and
  // learns nothing back — WHERE it lands, and which presentation it lands in, are the host's, because it
  // is the side that knows which surface this port belongs to. A frame's anchor cannot navigate itself
  // (the sandbox has no `allow-popups` and `will-frame-navigate` pins every subframe to its own origin),
  // so before this verb every link inside a frame's rendered content was inert.
  | { id: number; kind: 'ui'; op: 'openUrl'; url: string }
  // Importer lifecycle, valid only from a frame whose surface is an importer. `done` closes the modal
  // and triggers the host's post-import refresh; `close` is plain dismissal.
  | { id: number; kind: 'ui'; op: 'importer.done' }
  | { id: number; kind: 'ui'; op: 'importer.close' }

// The document a composed pane shares with its frame (docs/future/monaco.md § Communication between
// regions). Valid only from a frame whose pane declares a `document-over-frame` layout; every other
// surface is denied, because there is no document on the other side of the port to touch.
//
// Three operations, each with a proven consumer in the pane that forced this contract: `read` is the
// Run button needing the current SQL, `write` is the saved-query picker loading one into the editor,
// and `flush` is "make sure my write route has the latest before I act on it". Nothing about the
// EDITOR crosses — no cursor, no selection, no decorations — because those are the host's and the
// growth rule sends anything richer to an LSP-shaped route instead.
export type PluginBridgeDocumentRequest =
  | { id: number; kind: 'document'; op: 'read' }
  | { id: number; kind: 'document'; op: 'write'; text: string }
  | { id: number; kind: 'document'; op: 'flush' }

/** The ceiling on a document in either direction — what the host will load into an editor, and what a
 * frame may write back into one. Here rather than beside the editor because both ends of the port have
 * to agree on it, and refused whole rather than truncated: half a document in an editor that will
 * happily save it back is data loss wearing the shape of a rendering limit. */
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024

// A webview controller can address only the surface whose binding owns its port. There is no surface,
// plugin or node identifier in the request for plugin code to forge.
export type PluginBridgeWebviewRequest =
  | { id: number; kind: 'webview'; op: 'navigate'; url: string }
  | { id: number; kind: 'webview'; op: 'back' | 'forward' | 'reload' }

// Abandon an in-flight request. The SDK sends this when an AbortSignal fires; the host stops caring
// about the response rather than pretending it can un-send an HTTP request.
export type PluginBridgeCancelRequest = { id: number; kind: 'cancel'; target: number }
export type PluginBridgeKeydown = { kind: 'keydown'; chord: string }

// The acknowledgement. The SDK posts it the moment `connect()` resolves, and it is the only message a
// frame is REQUIRED to send: the host starts a deadline when it transfers the port and shows a labelled
// placeholder if nothing ever comes back, because a bundle that throws at module scope renders a blank
// rectangle and reports nothing at all.
//
// No id and no reply. It is not a request, so the broker's request parser drops it and only the arrival
// matters — which also means any OTHER message from the frame is just as good an ack, and the host treats
// it as one.
export type PluginBridgeConnected = { kind: 'connected' }

export type PluginBridgeRequest =
  | PluginBridgeApiRequest
  | PluginBridgeSubscribeRequest
  | PluginBridgeStateRequest
  | PluginBridgeUiRequest
  | PluginBridgeDocumentRequest
  | PluginBridgeWebviewRequest
  | PluginBridgeCancelRequest
  | PluginBridgeKeydown
  | PluginBridgeConnected

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

// A surface-scoped command the host resolved on this frame's behalf — the chord landed in the host's
// half of a composed pane (its editor), where a frame could never have seen it. `command` is the id the
// manifest declared, and the frame handles it exactly as it would its own button click.
//
// The host guarantees the pane's document has been FLUSHED to the plugin's write route before this is
// posted. Without that guarantee every plugin independently rediscovers "it ran the previous version of
// my query", which is the class of bug this whole contract exists to make unwriteable.
export type PluginBridgeSurfaceAction = { kind: 'surfaceAction'; command: string }

export type PluginBridgeMessage =
  | PluginBridgeReply
  | PluginBridgeEvent
  | PluginBridgeAppearance
  | PluginBridgeReady
  | PluginBridgeSelect
  | PluginBridgeSurfaceAction

// The code the bridge denies with. A domain code rather than `forbidden`, because a plugin author
// seeing this needs to know it is their manifest that is short, not their credentials.
export const PLUGIN_BRIDGE_DENIED = 'plugin_scope_denied'
