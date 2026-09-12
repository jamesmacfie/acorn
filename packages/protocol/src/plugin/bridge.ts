// The wire between a sandboxed plugin frame and the shell that hosts it (docs/plugins.md).
//
// A frame has no parent DOM, no `window.acorn`, and `connect-src 'none'`. Its only door is one
// MessagePort, and these are the messages that go through it. Everything here is
// structured-clone-safe by rule: no functions, no class instances, no streams.
//
// Two rules this file holds. Nothing here names `app-plugin://`: the frame sees a port and the host
// alone knows how frames are served, so the same protocol runs unchanged in a browser iframe with an
// opaque origin. And the frame supplies no identity: no `pluginId`, `nodeId` or token on any request,
// because the host bound all three when it created the frame. That is why `path` is the only
// addressing a request has.
//
// Types rather than Zod schemas, unlike the HTTP wire: the parsing here is hand-rolled in the broker
// (client-core/host/frames/broker.ts) because the trust boundary is inverted. An HTTP route
// validates a body it will act on; the broker's job is to decide whether to act at all, which is a
// permission check against a route table rather than a shape check. A schema in front of it would
// validate the shape of a request it is about to deny anyway.
import type { ErrorEnvelope } from '../errors'

// The handshake. The host posts exactly this into the frame with the port transferred alongside, and
// the SDK's `connect()` resolves on it. Versioned so a future protocol change is a different number
// rather than a silently mis-parsed message.
export const PLUGIN_BRIDGE_VERSION = 1
export type PluginBridgeHello = { acornBridge: typeof PLUGIN_BRIDGE_VERSION }

// What the frame was opened to look at. Handed over on the port rather than read from the URL by the
// SDK, so the query string stays an implementation detail of how the host happens to serve frames.
//
// `project` is its own field rather than being derived from the task, because the surfaces that need
// it most have no task at all. An importer runs before any project exists, and a project-scoped pane
// opens from the rail.
export type PluginFrameContext = {
  // The contribution id this frame is rendering, as declared in the manifest.
  surface: string
  // `coreSlot` is a rectangle drawn where one of acorn's own surfaces normally is, and the frame is
  // told so for the same reason every other target is: it may want to lay out differently. It grants
  // nothing. The bridge's allowlist is keyed on scopes, never on this field.
  //
  // `remote` is the one value that is not a rectangle at all: the bundle is drawing a tree of the
  // host's own components rather than pixels (docs/plugins.md § The tree contract). It has no
  // document, no webview and no modal to dismiss, so the verbs those gate on refuse it by default.
  //
  // `inline` is a rectangle drawn as a sibling of another plugin's pane, where that plugin's manifest
  // declared a `rectangle` extension point (docs/plugins.md § Cooperative extension points). Like
  // `coreSlot`, being told so grants nothing: the bridge's allowlist is keyed on scopes, and standing
  // inside somebody else's pane gives a frame none of that plugin's reach.
  target: 'pane' | 'refPanel' | 'settings' | 'importer' | 'webview' | 'overlay' | 'coreSlot' | 'remote' | 'inline'
  nodeId: string
  taskId?: string
  projectId?: string
  // Reference-panel surfaces only: the external item the panel was opened for, as the host's ref
  // registry knows it. Without it a panel frame has been told to render a thing and not which thing.
  refId?: string
  // The row a declarative rail source was selected on, when the pane was opened by one
  // (docs/plugins.md). Present at connect only when the frame is being created by that selection; a
  // later selection into an already-mounted frame arrives as a `select` message, because `context` is
  // a snapshot by contract.
  item?: string
  // Overlay surfaces only, and only when a remote tree opened this one as its companion
  // (docs/plugins.md § Companion overlays): what the opener handed over. A snapshot like the rest of
  // this record, and the only thing the frame is told about who opened it.
  //
  // Data, and small: bounded to MAX_OVERLAY_INPUT_BYTES below. An overlay that needs a file gets its id
  // here and fetches the bytes through its own plugin's route, exactly as it would from a pane.
  input?: unknown
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

/**
 * The same call, for a route whose body is bytes in one direction or both (docs/plugins.md § Binary
 * bridge calls).
 *
 * A separate kind rather than a flag on the request above, so a JSON call can never acquire byte
 * semantics by getting a field wrong: the broker branches on the kind before it looks at anything else,
 * and the two handlers share only the permission check.
 *
 * `path` is checked by exactly the same `allowApi` decision, at exactly the same point — before the body
 * is touched at all. A plugin's own namespace is reachable and another plugin's is not, whichever kind
 * of call asks.
 *
 * No streaming. The desktop broker fully buffers a node response already, so a chunked API here would be
 * a shape with no transport under it. `MAX_PLUGIN_BYTES` is the memory bound instead.
 */
export type PluginBridgeApiBytesRequest = {
  id: number
  kind: 'api.bytes'
  method: 'GET' | 'POST'
  path: string
  // POST only. Transferred where the runtime allows it, so a 10 MiB image crosses the port once.
  bytes?: Uint8Array
  // Advisory, both directions. The receiving store re-sniffs magic bytes and re-normalizes the name;
  // nothing downstream trusts what a sandbox said its bytes were.
  type?: string
  filename?: string
}

/** The ceiling on a binary bridge call in either direction.
 *
 * Above the agents store's 10 MiB attachment limit and well below anything that would be a memory
 * problem: an explicit bound with room for one allowed attachment plus its envelope. The store's own
 * limit stays authoritative for what may be stored; this only bounds what may cross a port. */
export const MAX_PLUGIN_BYTES = 12 * 1024 * 1024

/** What a successful `api.bytes` call resolves to. Rides the ordinary reply envelope's `body`, because
 * a `Uint8Array` is structured-clone-safe and a parallel reply type would be a second envelope to keep
 * in step for no gain. The request kind is what carries the security property, not the reply's shape. */
export type PluginBridgeApiBytesBody = { bytes: Uint8Array; type: string; filename: string | null }

// Server-push. The channel must appear in the manifest's `events` list and be one the shell actually
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
  | { id: number; kind: 'ui'; op: 'openDestination'; destinationId: string; resourceId: string; subresourceId?: string }
  // Hand an `https` URL to the host, which runs the same content-link ladder every shell surface
  // runs: in-app when a recogniser claims it, the owner's browser otherwise. The frame passes a URL
  // and learns nothing back, because the host is the side that knows which surface this port belongs
  // to. A frame's anchor cannot navigate itself: the sandbox has no `allow-popups`, and
  // `will-frame-navigate` pins every subframe to its own origin.
  | { id: number; kind: 'ui'; op: 'openUrl'; url: string }
  // Importer lifecycle, valid only from a frame whose surface is an importer. `done` closes the modal
  // and triggers the host's post-import refresh; `close` is plain dismissal.
  | { id: number; kind: 'ui'; op: 'importer.done' }
  // `result` is an overlay closing with an answer for whoever opened it (docs/plugins.md § Companion
  // overlays). Refused from an importer, which has `done` for "I finished" and nobody awaiting a value,
  // and bounded to MAX_OVERLAY_INPUT_BYTES in the same way the input is.
  | { id: number; kind: 'ui'; op: 'importer.close'; result?: unknown }

// The document a composed pane shares with its frame (docs/editor.md § Communication
// between regions). Valid only from a frame whose pane declares a `document-over-frame` layout;
// every other surface is denied, because there is no document on the other side of the port to
// touch.
//
// Three operations, each with a proven consumer in the pane that forced this contract: `read` is the
// Run button needing the current SQL, `write` is the saved-query picker loading one into the editor,
// and `flush` is "make sure my write route has the latest before I act on it". Nothing about the
// editor crosses: no cursor, no selection, no decorations. Those stay the host's, and the growth
// rule sends anything richer to an LSP-shaped route instead.
export type PluginBridgeDocumentRequest =
  | { id: number; kind: 'document'; op: 'read' }
  | { id: number; kind: 'document'; op: 'write'; text: string }
  | { id: number; kind: 'document'; op: 'flush' }

/** The ceiling on a document in either direction: what the host will load into an editor, and what a
 * frame may write back into one. Here rather than beside the editor because both ends of the port have
 * to agree on it, and refused whole rather than truncated. Half a document in an editor that will
 * happily save it back is data loss wearing the shape of a rendering limit. */
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024

/** The ceiling on an overlay invocation's input and on the result it closes with. Both directions, one
 * number, because they are the two halves of one conversation and neither is a payload: an input names
 * what to open and a result names what came back. Anything with bytes in it belongs on a route. */
export const MAX_OVERLAY_INPUT_BYTES = 64 * 1024

// A webview controller can address only the surface whose binding owns its port. There is no surface,
// plugin or node identifier in the request for plugin code to forge.
export type PluginBridgeWebviewRequest =
  | { id: number; kind: 'webview'; op: 'navigate'; url: string }
  | { id: number; kind: 'webview'; op: 'back' | 'forward' | 'reload' }

// Abandon an in-flight request. The SDK sends this when an AbortSignal fires; the host stops caring
// about the response rather than pretending it can un-send an HTTP request.
export type PluginBridgeCancelRequest = { id: number; kind: 'cancel'; target: number }
export type PluginBridgeKeydown = { kind: 'keydown'; chord: string }

// One telemetry record from inside a frame (docs/telemetry.md, docs/plugin-authoring.md § Telemetry
// from a frame).
//
// A frame has no `ctx`, so this is the whole of its telemetry API. It carries the five record kinds
// the model already has, minus everything the host is the only side able to state: no `owner`, which
// the host stamps from the binding, no `runtime`, and no trace or span id, which the host mints so a
// frame's span hangs under whatever interaction opened it.
//
// A span arrives finished, with a duration the frame measured, because the two ends of one span
// would otherwise be two messages the rate window could split.
export type PluginBridgeTelemetryRecord =
  | { type: 'event'; name: string; attrs?: PluginBridgeTelemetryAttrs }
  | { type: 'count' | 'gauge'; name: string; value: number; attrs?: PluginBridgeTelemetryAttrs }
  | { type: 'span'; name: string; durationMs: number; status?: 'ok' | 'error'; attrs?: PluginBridgeTelemetryAttrs }
  | { type: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; message: string; attrs?: PluginBridgeTelemetryAttrs }
  | { type: 'error'; name: string; message?: string; attrs?: PluginBridgeTelemetryAttrs }

/** Scalars only, the same rule every attribute map in the model follows: an object is where a request
 *  body hides, and no sink's column model can index one anyway. The host drops anything else. */
export type PluginBridgeTelemetryAttrs = Record<string, string | number | boolean | null>

// No id and no reply, like `connected` and `keydown`. Telemetry never fails the thing it describes,
// so there is no outcome for the frame to await and nothing it could do with one. The message still
// counts against the port's rate window, which is what stops a frame emitting in a loop: it kills
// itself long before the collector notices.
export type PluginBridgeTelemetry = { kind: 'telemetry'; record: PluginBridgeTelemetryRecord }

// The acknowledgement. The SDK posts it the moment `connect()` resolves, and it is the only message
// a frame is required to send: the host starts a deadline when it transfers the port and shows a
// labelled placeholder if nothing ever comes back, because a bundle that throws at module scope
// renders a blank rectangle and reports nothing at all.
//
// No id and no reply. It is not a request, so the broker's request parser drops it and only the
// arrival matters, which also means any other message from the frame is just as good an ack, and the
// host treats it as one.
export type PluginBridgeConnected = { kind: 'connected' }

export type PluginBridgeRequest =
  | PluginBridgeApiRequest
  | PluginBridgeApiBytesRequest
  | PluginBridgeSubscribeRequest
  | PluginBridgeStateRequest
  | PluginBridgeUiRequest
  | PluginBridgeDocumentRequest
  | PluginBridgeWebviewRequest
  | PluginBridgeCancelRequest
  | PluginBridgeKeydown
  | PluginBridgeTelemetry
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

// A surface-scoped command the host resolved on this frame's behalf. The chord landed in the host's
// half of a composed pane (its editor), where a frame could never have seen it. `command` is the id
// the manifest declared, and the frame handles it exactly as it would its own button click. See
// docs/plugins.md § Loaded plugins: the client half (surface actions) for the flush guarantee this
// depends on.
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
