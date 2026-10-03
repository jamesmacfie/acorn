# The renderer bridge and the connection broker

This page covers the `window.acorn` surface the shell injects, the binary terminal channel, the
native dialogs and notifications, and the broker that holds every Node connection. Read it before you
add a bridge method or change how the renderer reaches a Node. It's part of
[desktop shell](../shell.md).

## The renderer bridge

`apps/desktop/src/shell/bridge.ts` is built as one IIFE and injected as the window's initialization
script, which runs before any page script. It assembles the narrow, validated `window.acorn` surface
the platform seam reads: broker request and response bytes, stream frames and status, fleet
operations, lifecycle actions, the three file dialogs, the notification group, and the webview
commands. It never exposes a Node token, a certificate, a database handle, or a process object.

The `plugins` group exposes `plugins-install` and `plugins-remove` beside state, cache writes, trust
recording, and development grants. The helper validates the source, reads the manifest, hashes the
bundle, and returns metadata, so no executable bytes reach the renderer this way. `plugins-state`
includes provenance, the source label, and the validated device manifest, so the client can check
admission again. A host missing install or remove fails platform contract validation.

The bridge is the implementation of the platform seam, and only
`packages/client-core/src/infra/platform/` reads it, enforced by `boundaries.test.ts`.
`platform/contract.ts` states what each capability group looks like, and `src/shell/bridge.test.ts`
runs it against the real bridge under stub Tauri bindings, so a renamed key fails a test. The presence
of a key is never a product capability.

The same bridge serves frames and tree workers. `packages/client-core/src/host/frames/broker.ts` takes
a `MessagePort` without knowing what's on the other end, and `host/frames/scopes.ts` decides every call
the same way for both. A tree binding carries `target: 'remote'`, which grants nothing: it has no
document, webview, or dialog, so verbs that need those refuse it.

### Terminal bytes

Terminal output is the one non-JSON message on the helper socket. The helper's push channel carries a
binary frame tagged with the Node ID, wrapping the Node's frame tagged with the session ID
([the one binary frame](../api-reference/websocket.md)). The bridge sets `binaryType =
'arraybuffer'`, removes the Node ID, and hands the rest to
`packages/client-core/src/infra/node/wsClient.ts` through the seam's `onBytes`, the one place the bytes
become text. Request and response bodies stay base64 in JSON messages.

The helper accepts at most 16 MiB per incoming serialized request, base64 and envelope included, which
fits an 8 MiB binary body. A larger request closes with WebSocket code 1009 before dispatch. Replies
aren't limited this way: custody caps an HTTP response body at 64 MiB before encoding, about 85.4 MiB
as base64. The browser WebSocket API has no receive ceiling, so the broker owns the response bound and
the 8 MiB Node-event bound.

### Dialogs

The file dialogs are the folder picker, `pick_files`, and `save_file`. The last two carry bytes, not
paths, base64 both ways because the Tauri channel is JSON. A Node isn't always on this machine, so a
path would name a file it can't open. The shell owns the dialog and the read or write, and the
renderer never learns where the file went.

### Notifications and the dock

The `notify` group is a system notification, a click on one, and the number on the dock icon
(`apps/desktop/src-tauri/src/commands.rs`). [The gate](../notifications/gate.md) decides which notices
raise a banner. All three belong to the shell, because a banner and an app icon belong to the window's
process. `tauri-plugin-notification` is initialized only for `app.notification()`. The renderer never
calls the plugin's own commands, so `capabilities/default.json` still grants only `core:default`, and
a preview page or plugin webview can't raise a banner wearing acorn's icon.

Window focus never opens a notification target. On macOS, `src-tauri/src/notifications.rs` posts
through `mac-notification-sys` and waits for the response on a background thread. Only a click on the
banner focuses the window and emits `acorn:notification-activated` with that banner's notice ID.
Delivery, dismissal, and returning through the Dock or Cmd-Tab keep the view. Other platforms use the
Tauri notification plugin, which has no activation callback, so their banners don't select a task. The
command's boolean acknowledges submission only.

macOS attaches a banner to an installed app, and `tauri dev` runs a bare binary. So
`notifications.rs` looks up the installed acorn and uses its identity, which needs an acorn in
`/Applications` or a `tauri build` bundle the system has seen. Otherwise it falls back to
`com.apple.Terminal`, because an identity macOS can't resolve can't post at all.

### The title bar

On macOS the window uses `TitleBarStyle::Transparent` (`src-tauri/src/lib.rs`), so the title bar
paints the window's background and can follow the theme. Rust can't read a CSS property, so the bridge
reads `body`'s computed background, which carries `--bg`, and calls `set_window_background` on load and
on every appearance change. The window starts with the default theme's `--bg`. This isn't a seam
member, and no product code knows about it.

## Connection broker

`@acorn/custody/broker/nodeBroker.ts` runs in the helper. For each Node it owns the endpoint and
certificate fingerprint, a pinned `https.Agent` and device token, one authenticated WebSocket, and
request aborts, stream routing, reconnect backoff, and connection state.

The renderer calls `nodeFetch(nodeId, request)` and the stream methods over the helper socket. The
broker adds the bearer, checks the pinned certificate, and returns response bytes. Node states are
`online`, `degraded`, `offline`, `incompatible`, and `revoked`. Nothing asks the webview engine to talk
to a Node, so there's no certificate-override path to get wrong.

The broker buffers each response before it crosses to the renderer, so ordinary responses are capped
at 64 MiB. A plugin bundle download has the bundle format's 8 MiB limit, the unverified pairing probe
16 KiB, and the pinned pairing result 64 KiB. Each limit rejects an oversized `Content-Length` before
reading, and counts chunks when the length is absent or wrong. A response limit error fails that read
and doesn't mean the Node is offline.

Both ends run a ping and pong watchdog. A sequence gap or watchdog failure makes the Node stale, and
the client reconnects and refetches. The exception is `ws:shed`, which says the Node dropped
invalidation frames because this socket was behind. That's congestion, not loss, so the broker
forwards it ([backpressure](../terminal/activity.md#backpressure)). A write is never queued while a Node is
offline.

The helper forwards one Node's frames. It reads which Node is active from the requests it answers:
`node-fetch` and `node-send` name a Node, and the last one named is active
(`apps/desktop/src/helper/helperServer.ts`). Other Nodes' frames are dropped before they cross the
process boundary, except `node-status`, which the fleet list needs for every Node.

### Fleet membership

`@acorn/custody/broker/fleetStore.ts` holds which Nodes this client knows, where they are, and which
certificate to pin, in `fleet.json`. The renderer gets a token-free `NodeRecord` built by explicit field
selection, so a new stored field can't leak by default. `fleet.json` is `0600`, and each token is its
own encrypted blob in `deviceTokenStore.ts`, so reading a label never needs a decryption, and a machine
with no keychain forgets tokens instead of blocking. The local Node's token predates its `nodeId`, so
it's keyed by a fixed scope.

The local Node is a singleton: exactly one, and it can't be unpaired. Replacing the data root brings
the same machine back under a new `nodeId`, so `remember()` replaces any other row marked local when a
local Node arrives. Every local row shares one token scope, so the write refreshes the live Node's
token.

### Adopting a provided Node

A Node a plugin's Node provider produced can be adopted through the helper's `node-adopt` handler
([plugins](../plugins.md) § Node providers). The renderer names a source Node, a provider ID, and a
provider Node ID, and nothing else. The helper asks that Node's `POST /v1/core/nodes/adopt` for the
endpoint, fingerprint, and device token, probes the endpoint itself, and refuses a certificate whose
fingerprint isn't the one the provider vouched for. So the renderer can't invent a Node, and no token
crosses the bridge.

The provider's word replaces you comparing a fingerprint, which is the trust you granted when you
connected it. The record keeps `provider` provenance: which provider, which provider Node ID, and which
Node listed it. An adopted row has no `deviceId`, because the far Node's device row belongs to the
control plane, so it can be unpaired but not revoked.
