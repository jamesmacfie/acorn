# Desktop shell

The desktop shell is a Tauri v2 application: a small Rust process that owns the window, the two
custom schemes, the menu, native dialogs, and one key in the OS keychain, plus a Node helper process
it supervises. It owns no product data and no feature engines. The node service is built separately
and staged into the bundle; the shell starts it and brokers access to it.

Everything here is shipped behaviour. The migration that produced it, including the arguments for
each decision and what the Electron host did instead, was planned in `docs/future/tauri/`, which was
deleted once every phase landed; git history holds that record.

## The shell process

`apps/desktop/src-tauri/src/lib.rs` registers the `app://acorn` and `app-plugin://` schemes,
supervises the helper, and opens the window. Boot order is the reverse of what a Tauri app usually
does: `setup` blocks on the helper, so the broker is warm and the node is listening before the
window exists. The renderer's first act is to ask for the fleet, and a window that opened first
would have nothing to render but the recovery screen.

The Rust half is deliberately small. Three modules serve content (`app_scheme.rs`,
`plugin_scheme.rs`, `webviews.rs`), one supervises the helper (`helper.rs`), one holds the data key
(`keychain.rs`), and two carry the window's own surface (`commands.rs`, `menu.rs`). Custody is
TypeScript.

`packages/custody` is the other half, composed by its `src/index.ts`: service supervision and
the restart policy, the connection broker and its fleet, device-token custody, the plugin cache and
trust store, and the preview tunnels. It runs as its own process under the bundled Node, and
`apps/desktop/src/helper/helperMain.ts` is its entry point. Rust talks to it over stdin and stdout in
lines: one handshake line in, one ready line out, then commands. Never through argv or the
environment, because the handshake carries the data key and argv is world-readable.

The renderer talks to it over one loopback WebSocket, authenticated by a per-launch secret and
checked against the window's origin on upgrade. That socket is what Electron's preload and `ipcMain`
pair used to be, and it carries the same vocabulary: `apps/desktop/src/shell/wire.ts` is the list.

The shell must not import plugin engines, database handles, or node source. Domain behaviour belongs
in the node's own graph.

### Startup: data directory, environment, and the singleton lock

The writable app-data root, holding the SQLite databases, blobs, worktrees, and notes, is
`apps/node/.acorn` in a dev checkout, so a checkout's data stays with the checkout. A packaged build
uses the OS application-data path. The shell's own custody root is a separate directory: `fleet.json`
and the encrypted device tokens belong to this application, not to the node. Packaged, that is the
application-data directory itself with the node's root beneath it; in a checkout it is
`apps/node/.acorn/shell`.

Secrets load from `.env` in two places, in order: the build's own file, then a user-provided `.env`
inside the data directory, which wins. `SESSION_ENC_KEY` falls through to the node's own generated
key if neither file supplies it, resolved before the listener starts accepting connections.

`tauri_plugin_single_instance` makes a second launch focus the running window instead of starting a
second process. The data root's own exclusive lock (`node-core/server/storage/dataRoot.ts`) is the real mutual
exclusion; the single-instance lock only keeps a second launch from getting as far as contending for
it.

Quitting negotiates with the renderer first. Quit is a custom menu item rather than
`PredefinedMenuItem::quit`, because the predefined one routes through `[NSApp terminate:]` and skips
the event loop, so the negotiation would never run. The menu item and `RunEvent::ExitRequested` both
emit the same event to the renderer, which collects any concerns and answers with `quit_approved`.
The recovery screen's `force_quit` skips the negotiation, because the prompt is answered by the app
shell, which is not mounted while the recovery gate is showing.

### Keys and custody

Rust holds one secret: a 32-byte data key in the OS keychain, under service `acorn` and account
`data-key`. It reaches the helper in the stdin handshake and is never written to disk on that side.
Device tokens are encrypted under it with AES-256-GCM, which is what `safeStorage` used to do.

One key rather than one per token: per-token keychain items mean a prompt per node and ACL churn on
every rebuild. The file fallback, a `0600` file beside the fleet, is not an edge case on macOS. A
keychain item's ACL binds to the code signature, so while the app is ad-hoc signed every rebuild
either re-prompts or loses access. A dev build skips the keychain entirely and uses the file. That is
the same fail-quiet stance `deviceTokenStore.ts` takes and the same blast radius as the node's own
`session.key`.

A packaged build's first launch adopts an Electron-era custody root if it finds one:
`packages/custody/src/custody/legacyCustody.ts` copies `fleet.json`, the trust store, and the
content-addressed plugin cache, and re-encrypts the device tokens from Chromium's `os_crypt` under
the data key. Rust reads the old keychain item and passes both in the handshake.

## Node child

The helper starts the staged `service.js` under the runtime it is itself running, the bundled Node:

```ts
spawn(process.execPath, [entry], {
  stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
})
```

The node sends a versioned service-protocol `start` response carrying its `nodeId`, endpoint,
certificate fingerprint and PEM, and local device token. The helper adopts that record into the
broker only after the listener is ready. Startup failures fail closed; a crash after startup is
retried with bounded exponential backoff and eventually shows the recovery screen without creating a
new data root.

The crash budget (`@acorn/custody/supervision/crashBudget.ts`) allows five restarts inside a
ten-minute window, waiting 1, 2, 4, 8, then 16 seconds before each one. A sixth crash inside the
window gives up and shows the recovery screen instead of restarting into the same fault. An earlier,
tighter policy, roughly 250 ms doubling and capped at three crashes in sixty seconds, meant a service
crashing on something durable, a corrupt database or a port it could never bind, burned its whole
budget in under two seconds and gave up before a person could read anything on screen. Each start
persists whatever device token the node ended up using and reuses it on every start, crash recovery
included, since a restart must not mint a new device row and the node's endpoint can change between
restarts. The recovery screen is a native dialog, because the shell that would render it is behind
the gate it is about to show; its Retry button forgives the spent budget, since an owner asking for a
retry may have just freed the port. It also names why the last attempt failed, when the service said
anything — another node already holding the data root, a port it could not bind — because those
messages go to stderr, and the dialog is the only place an owner would ever read them.

The node owns SQLite, migrations, HTTP and WebSocket listeners, PTYs, tmux, worktrees, Git,
processes, workflows, Docker, provider clients, reconciliation, and shutdown draining. Quit asks it
to close the listener, dispose plugin engines, close SQLite, and release the data-root lock with a
30-second overall deadline.

The supervised child and the standalone node consume the same `apps/node/src/composition/composition.ts`
graph and the same reconciliation and drain plan. The shell supplies supervision and native adapters;
it does not assemble a parallel plugin graph.

## Renderer origin and protocol handler

The renderer loads from `app://acorn` and the node serves no assets.
`apps/desktop/src-tauri/src/app_scheme.rs` maps bundled files from the staged client, returns
`index.html` for client-side deep routes, and sets the renderer Content-Security-Policy on every
response.

The traversal guard runs after percent-decoding, because `..` arrives encoded and intact until the
decode does. It refuses any `..` component outright rather than normalising, since a normaliser that
agrees with the filesystem about symlinks is a much harder thing to be sure of than a refusal.

A request for `/v2/` or `/api/` gets a 404 in the wire's own JSON envelope rather than the shell's
HTML. Nothing legitimate asks this origin for a node route, but the renderer's HTTP client falls back
to a same-origin fetch when it has no active node yet, and a 200 full of markup that the caller
parses as JSON is the worst answer available.

Development proxies the Vite dev server through this same handler rather than loading `devUrl`
directly, so developers exercise the origin the shipped app uses.

The CSP is a response header rather than an `index.html` meta tag, because a header cannot be
overridden by markup injected into the document, and a meta tag can be preceded by content it
therefore fails to cover. `connect-src` names `'self'`, Tauri's own IPC protocol, and the helper's
exact loopback WebSocket port. No wildcard port: the handler knows the port because the helper
reported it, so no other local service becomes reachable. Renderer code still cannot reach a node
directly, because a node needs the pinned agent and the bearer that only the helper holds.

`ipc:` and `http://ipc.localhost` are there because Tauri's IPC is a custom protocol too. Without
them every `invoke` falls back to a slower postMessage path, which still works, and that is what
makes the omission easy to ship unnoticed. They reach only the commands in `commands.rs`, and
`capabilities/default.json` says which those are. That file is scoped by webview label, never by
window: naming a window grants `core:default` to every webview in it, and this window hosts the
preview pane and plugin webview surfaces, which are pages this application does not write. A Rust
test reads the JSON back and fails if `windows` reappears.

`frame-src` names only `app-plugin:`, since plugin frames are the one thing the renderer embeds. The
preview pane is a child webview rather than a frame, so widening this for `http(s)` would buy
nothing. Two more directives carry their own reason: `style-src 'unsafe-inline'` is required because
Shiki emits `style="color:#…"` attributes into HTML that reaches `innerHTML`, and style attributes
are gated independently of `el.style.x = v` assignments; `img-src https:` exists for GitHub avatars
rendered in PR authorship (`kit/components/content/UserAvatar.tsx`), and narrowing it to the two GitHub avatar hosts is a
one-line change once nothing else renders a remote image.

Development widens the policy in one branch: Vite's HMR socket and the inline preamble its plugins
inject. A packaged build passes `None` and gets neither. A Rust test asserts the dev widening is
absent from the packaged policy.

### The syntax-highlighter worker's separate policy

One response gets a different policy for a reason that is a fact about workers, not about acorn: a
dedicated worker loaded from a same-origin URL takes its Content-Security-Policy from that script's
own response headers, not from the document that created it. So the highlight worker's script can
carry `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'none'`, which buys
Shiki's Oniguruma engine, measured at 4.6 times the pure-JavaScript one, `wasm-unsafe-eval`, while
the document keeps the policy it has. The worker ends up with strictly fewer capabilities than the
renderer code it moved out of: no network, no DOM, no bridge to the shell, nothing fetchable. It
takes strings and returns colors, and `shiki/wasm` is the inlined build, so even the WebAssembly
module arrives as part of the script rather than as a fetch, which is what lets the worker's own
`connect-src 'none'` stand. Phase 0 measured this in WKWebView three ways: the document still cannot
instantiate WASM, the worker can, and the identical bytes served with the document's header cannot.

Only a worker's top-level script response sets its policy this way; the grammar chunks that worker
imports are governed by the worker's own `script-src 'self'` and need nothing here. The renderer's
worker output format is `es`, not the default `iife`, specifically so the worker can code-split:
under `iife` every grammar gets inlined into one 3.1 MB file, where the ES module form ships roughly
250 KB plus the one or two grammars a given diff actually touches. It must never become an inlined
blob worker either: a `blob:` worker inherits the document's CSP, so the relaxation would silently
stop applying and Oniguruma would fail inside it.

`app_scheme.rs` identifies the one response that gets the relaxed policy by filename, matching
`/assets/worker-highlighter.worker-<hash>.js`. The `worker-` prefix on the entry name
(`apps/desktop/vite.config.ts`) is required, not cosmetic: Vite emits two files derived from
`highlighter.worker.ts`, the worker entry itself and a roughly 270-byte main-thread wrapper that
constructs it, and without a distinguishing prefix both would be named
`highlighter.worker-<hash>.js` with no way to tell them apart. Monaco's five workers keep the plain
`[name]` pattern, so they get their own names and the document's ordinary policy. If a future bundler
change renames the worker entry, the pattern stops matching, the worker falls back to the document's
policy, Oniguruma fails inside it, and `highlight/worker.ts` logs the failure and falls back to the
main thread: degraded and loud, which is the failure mode this area was built to have.

### The plugin worker

A loaded plugin has a second way to draw. Instead of an iframe whose pixels it owns, its bundle can
run in a dedicated Web Worker and emit a *tree*: names of the host's own components, with props, as a
stream of mutations the renderer applies. The host mounts its components for those names, so what the
reader gets has the shell's focus handling, keyboard model, ARIA and style pack, none of which an
iframe can borrow. `docs/plugins.md` § The client half of a loaded plugin has the plugin-facing half;
this section is the shell's.

The worker script is the plugin's own bundle, served by `app_scheme.rs` at
`app://acorn/plugin-worker/<sha256>.js` from the same content-addressed cache the plugin scheme reads.
It is served from *this* origin rather than from `app-plugin://<hash>` because a worker script has to
be same-origin with the document that starts it; there is no way to point `new Worker()` at another
scheme. The hash in the path is validated as 64 lowercase hex digits before the read, so the path can
name a bundle this device holds and nothing else, and a hash the cache does not hold is a 404 rather
than a fall-through to the client root — a Worker handed the shell's `index.html` would be a strange
failure to debug.

The bytes are identical to what the frame origin serves as `/client.js`, and so is the trust decision:
the owner accepted a bundle hash, and a worker is that hash with a different host. Nothing about the
worker path asks a second question.

Its policy is its own, for the reason the highlighter's is (above): a same-origin worker takes its CSP
from its own script's response headers. `PLUGIN_WORKER_CSP` is
`default-src 'none'; script-src 'self'; connect-src 'none'` — tighter than the highlighter's, with no
`wasm-unsafe-eval`, because a plugin bundle is a stranger's code and nothing a tree draws needs one.
`connect-src 'none'` is the load-bearing directive it shares with the frame origin: fetch, XHR,
WebSocket and `sendBeacon` all fail inside the worker, so the transferred `MessagePort` is the only way
out of it. The document's `worker-src` names `'self' blob:` and never the plugin scheme.

The renderer's half is `packages/client-core/src/host/tree/`: `workerHost.ts` owns one worker per
bundle hash, shared by every tree that bundle draws and stopped a grace period after the last one
unmounts; `TreeHost.tsx` validates and applies each batch and is the only thing that turns a handler id
into a function. A worker that misses two heartbeats is terminated and every tree it served shows a
labelled placeholder.

### The renderer bridge

`apps/desktop/src/shell/bridge.ts` is built as one IIFE and injected as the window's initialization
script, which runs before any page script. It assembles the narrow, validated `window.acorn` surface
the platform seam reads: broker request and response bytes, stream frames and status, fleet
operations, lifecycle actions, the three file dialogs, and the webview commands. It never exposes a
node token, a certificate, a database handle, or a process object.

The file dialogs are the folder picker, `pick_files`, and `save_file`. The last two carry bytes, not
paths: the renderer sends a byte array to save and receives one per file it picked, base64 in both
directions because the Tauri channel is JSON. Bytes rather than paths because the node this renderer
talks to is not always on this machine, so a path would name a file the node cannot open. The shell
owns the dialog and the read or write, and the renderer never learns where the file went.

The same bridge serves both render paths. `packages/client-core/src/host/frames/broker.ts` takes a `MessagePort` and knows
nothing about where the other end is: an iframe gets one over `window.postMessage`, a plugin worker
gets one in its first message, and `packages/client-core/src/host/frames/scopes.ts` decides every call the same way for both. A tree
binding carries `target: 'remote'`, which grants nothing — it has no document, no webview and no modal
to dismiss, so the verbs that gate on those refuse it.

That surface is the implementation of the platform seam, and the renderer never reads it directly.
`packages/client-core/src/infra/platform/` is the only module allowed to touch the global, enforced by
`boundaries.test.ts`. The two are checked against each other rather than assumed to agree:
`platform/contract.ts` states what a live capability group has to look like, and
`src/shell/bridge.test.ts` runs it against the real bridge under stub Tauri bindings, so a renamed
key fails a test instead of quietly nulling a group. Presence of a key is therefore never a product
capability. The folder picker in particular is a folder picker. It used to sit under a `terminal` key
whose presence gated the whole terminal, agents, run-targets, and workflows block, which are ordinary
`/v2` and WebSocket surfaces.

## The plugin frame origin

There is a second privileged scheme, `app-plugin://<sha256>`, one origin per third-party plugin
bundle (`apps/desktop/src-tauri/src/plugin_scheme.rs`). The host part is the bundle hash, which makes
each plugin a distinct origin, makes the origin immutable, and makes an uncached hash a 404 rather
than a fetch. Phase 0 measured the arrangement in WKWebView: each hash is a real origin with its own
storage, `'self'` resolves against it, and the per-response CSP is honoured.

Only `/index.html`, generated by the shell so the plugin never controls its own head, `/client.js`,
and the host-owned `/ui.css` presentation kit exist there. The stylesheet is a staged file the
handler reads once at boot; `apps/desktop/scripts/stage.mjs` holds the ordered list of client-core
modules that make it up, and `packages/client-core/src/infra/styles/cssHygiene.test.ts` reads that list and
checks a frame is served a base rule for every class `primitives.css` styles. The handler resolves a
bundle by path, `<userDataDir>/plugin-cache/<hash>.js`, because the store is content-addressed: a
file whose name is a 64-hex hash is a bundle this device holds, and nothing else can be named.

Every response carries `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self'; connect-src 'none'`. `default-src 'none'` makes every
directive opt-in, so a fetch type nobody thought about is denied rather than inherited.
`connect-src 'none'` is the one worth reading twice: a plugin frame has no network at all, not a
restricted one. `fetch`, `XHR`, `WebSocket`, `sendBeacon`, and `EventSource` all fail, so a malicious
bundle cannot exfiltrate what it sees even to its own server. `style-src 'unsafe-inline'` exists
because the appearance tokens arrive over the port and are applied as inline custom properties on
`:root`; `img-src data:` lets a plugin draw an inlined icon without an asset pipeline. A plugin
frame's only I/O is the `MessagePort` the shell transfers in, where each call is checked against the
plugin's declared scopes (`docs/plugins.md`). The renderer's own CSP names this scheme in `frame-src`
and nothing else.

There is no `x-frame-options` or `frame-ancestors` on these responses: the shell frames a plugin from
`app://acorn`, a different origin, so `SAMEORIGIN` would block the only embed that is meant to work.
What bounds who can frame a plugin is that nothing else in this process can. The shell's own CSP is
the only one naming this scheme in `frame-src`, and top-level navigation to it is denied below.
Responses also carry `cache-control: no-store` even though frames are hash-addressed and could in
principle cache forever: this is a local scheme backed by a content-addressed store already, so there
is nothing to gain and one more place for stale bytes to live.

### Navigation policy

The window's `on_navigation` guard admits `app://acorn` and `app-plugin://` and refuses everything
else. It fires for subframes as well as the main frame, which is the one guard covering both halves
Electron needed two events for: a plugin origin can never become the whole window, and a plugin frame
cannot navigate itself off its own document. Returning false leaves the frame where it was, verified
in phase 0. There is no OAuth exception: GitHub connects by device flow against the node
(`POST /v2/p/github/auth/device/start`), so no window ever has to navigate to github.com.
`on_new_window` denies `window.open` from anywhere, plugin frames included.

A frame's rendered content therefore reaches the outside world only by asking, over the bridge.
`ui.openUrl` hands an `https` URL to the shell, which resolves it in-app if a content-link recogniser
claims it and otherwise opens it in the system browser behind the scheme allowlist, exactly as a
descriptor's `openUrl` verb does. That adds no navigation path in the shell and no exception to the
rules above: a blocked navigation is still blocked, and the URL that reaches the OS arrived through
the one handler that was already there. The frame is never told which of the two happened
(`docs/plugins.md`).

The renderer embeds these with `sandbox="allow-scripts allow-same-origin"`. `allow-same-origin` is
required, not a lapse: the pair is only dangerous when the framed document shares the embedder's
origin, and here the embedder is `app://acorn`. Dropping it makes the origin opaque, which breaks
`'self'` in the CSP above and turns the frame's own module script into a cross-origin fetch on a
scheme with no CORS.

## Connection broker

`@acorn/custody/broker/nodeBroker.ts` runs in the helper process. For each node it owns:

- endpoint and certificate fingerprint;
- a pinned `https.Agent` and device token;
- one authenticated WebSocket;
- request aborts, stream routing, reconnect backoff, and connection state.

The renderer calls `nodeFetch(nodeId, request)` and the stream methods over the helper socket. The
broker adds the bearer, validates the pinned certificate, and returns serializable response bytes.
Node states are `online`, `degraded`, `offline`, `incompatible`, and `revoked`.

Both ends run a ping and pong watchdog. A sequence gap or watchdog failure makes the node stale and
causes the client to reconnect and refetch. A mutation is never queued automatically while a node is
offline.

Nothing asks the webview engine to talk to a node, so there is no certificate-override path to get
wrong. The window loads `app://acorn`, and every byte to or from a node goes through the broker's own
agent, which does its own pinning.

### Fleet membership

`@acorn/custody/broker/fleetStore.ts` holds which nodes this client knows, where they are, and
what certificate to pin, in `fleet.json`. It lives with the host because the host already holds the
two things fleet membership is inseparable from: device tokens and pinned certificates. The renderer
gets a token-free `NodeRecord` projection built by explicit field selection, not a spread with keys
deleted, so a field added to the stored record cannot leak to the renderer by default.

The file and the tokens are split into two stores on purpose. `fleet.json` holds the non-secret
record, `0600` regardless, since an endpoint list is still information about the owner's machines,
and each token is its own encrypted blob in `deviceTokenStore.ts`. Putting tokens in the JSON would
mean the whole file has to be decryptable to read a label, and would lose the token store's
fail-quiet behaviour on a machine with no keychain: it forgets rather than blocking. The bundled
local node's token predates its `nodeId`, so it keys off a fixed scope instead of the node id like
every paired node's token does.

The local node is a singleton: exactly one, and it cannot be unpaired. Its identity is not equally
stable, since replacing the data root brings the same machine back up under a new `nodeId`, so
`remember()` replaces any other row marked local, as well as its own row, when a local node arrives.
Matching on `nodeId` alone once appended a second `local: true` row instead of replacing anything,
and nothing cleared it: the boot loop skips local rows when reconnecting because the local endpoint
is unknown until the service binds a port, and the forget action refuses to remove a local row at
all. The leftover row stayed listed with no broker connection behind it, and the code that picks the
fleet's home node takes the first local row, so the window homed onto a node whose every request
answered "Unknown node" from the broker while the persisted per-node query cache kept the shell
looking populated. The dropped row's credential is not forgotten along with it, since every local row
shares one token scope, so the write is what refreshes the live node's own token rather than
discarding it.

### The second door: adopting a provided node

Probe-then-pair is not the only way into `fleet.json` any more. A node a plugin's node provider
produced can be adopted, and the helper's `node-adopt` handler is the whole of it
([plugins.md](./plugins.md) § Node providers).

It is narrower than "a second door" sounds. The renderer names a source node, a provider id and a
provider node id — nothing else. The helper then asks that node's `POST /v2/core/nodes/adopt` for the
endpoint, the fingerprint and the device token, probes the endpoint itself, and refuses a certificate
whose fingerprint is not the one the provider vouched for. So the renderer cannot introduce a node of
its own invention, and no device token crosses the bridge in either direction, which is the same
invariant pairing already holds.

What replaces the owner comparing a fingerprint by eye is the provider's word, which is the trust the
owner granted when they connected it. The stored record keeps `provider` provenance — which provider,
which provider node id, and which node listed it — so the fleet can say where a row came from and which
rows go away if that plugin does. An adopted row carries no `deviceId`, because the device row on the
far node belongs to the control plane rather than to this client, so such a row can be unpaired but not
revoked.

## Host-owned webviews

`apps/desktop/src-tauri/src/webviews.rs` owns every child webview: the browser preview pane and
loaded-plugin webview surfaces. It is one module rather than three because the difference between the
two products is a policy function and a key prefix. Keys are `preview:<taskId>` and
`plugin:<pluginId>:<nodeId>[:<surface>]`, and the prefix is validated rather than assumed, because it
is what selects the policy.

A child webview under `Window::add_child` composites over the main one, takes logical bounds the
renderer's pane geometry drives, and hides while overlays cover the pane. `incognito(true)` gives it
its own ephemeral data store. Preview is one kept-alive webview per task, restricted to HTTP and
HTTPS URLs with no credentials, with an external chrome layer the renderer draws. A loaded plugin's
webview surface is checked against its manifest hosts by the renderer broker and again here, and two
independent checks is the point: widening the grant in one layer must not silently widen the other.
A ceiling of 32 webviews caps what a renderer bug that ensures in a loop can cost.

wry exposes no navigation history, so the shell keeps its own. `on_navigation` reports every
navigation, including the ones page script drives, and the module marks the traversals it asked for
so they move the cursor instead of truncating the future. That is what lets the pane offer back and
forward honestly rather than always-enabled.

No webview is attached to a debugger. Agent browser automation is `plugins/browser`, which runs
Playwright against a browser of the node's own, so an agent on a headless node has one too. The
preview pane is the person's surface and nothing steers it but them.

For a task whose dev server is served by another node process,
`@acorn/custody/supervision/previewTunnel.ts` opens an authenticated loopback listener that forwards
raw bytes to the node's own tunnel endpoint over its pinned agent, so the preview pane can reach a
dev server without the renderer ever touching the network directly. It binds `127.0.0.1` explicitly;
binding `0.0.0.0` would publish another machine's dev server to the local network, the opposite of
the tunnel's purpose. Because a task's preview URL can be resolved more than once while its resource
is settling, opening for a key already in flight returns the same promise instead of racing a second
listener into existence.

Each listener carries a 32-byte, base64url-encoded secret, generated once per listener rather than
per connection. wry cannot inject a request header per request, so the credential travels as a
cookie: the helper reports each listener's port and secret to Rust on the stdout pipe it already
owns, and the shell seeds `acorn_tunnel` into the pane's cookie store before the first real
navigation. The renderer never sees the secret, which is the property the secret exists for.
`authorize()` accepts either envelope, the `x-acorn-tunnel` header or the cookie, compared with
`timingSafeEqual` on a length-checked pair, and destroys the socket on any mismatch before anything
dials the node. The scan works on the raw request head as `latin1`, not `utf8`, because a decoder
that can produce a replacement character could make two different byte strings compare equal.

A connection that never completes a request head is refused after a two-second deadline, bounded to
8 KB while it waits, so an unauthenticated peer cannot pin memory or a file descriptor by connecting
and saying nothing. A ceiling of 16 open tunnels per renderer caps how much a compromised renderer
could ask the helper to open; the renderer is a trust boundary because it is the part of the system
that renders third-party content. An idle listener with no live connection for 60 seconds is reaped
as a backstop for the paths that do not close their own tunnel, such as a crashed renderer or a
window closed abruptly; the pane closes its tunnels on unmount in the ordinary case. Both sides of
the pipe pause their socket on read and resume it only once the paired side has accepted the last
chunk, so a slow peer applies backpressure through the kernel instead of growing an unbounded buffer
in the helper.

## Service protocol

`packages/protocol/src/serviceProtocol.ts` defines the versioned lifecycle messages between the
helper and the node it supervises: `service.start`, `service.stop`, and `service.preview-rules`. Both
endpoints validate messages with Zod, and pending calls reject on timeout or peer exit. Product
requests do not use this RPC; they use `/v2` over the broker.

The peer is symmetric, but every method is one the helper calls on the node. The other direction had
one user, the Electron preview pane's `desktop.preview-*` handlers, and it went with that shell: the
pane is a child webview the shell drives directly, and no node-side caller ever asked to drive it.
The node receives no window handle, no webview handle, and no shell object of any kind.

## Build and packaging

`apps/node` emits `service.js`, `mcp.js`, `standalone.js`, and shared chunks.
`apps/desktop/scripts/stage.mjs` puts the service, every core and plugin migration chain, the plugin
frame stylesheet, and the pinned Node runtime where the bundler will find them. The runtime is
fetched from nodejs.org and verified against that release's `SHASUMS256.txt` rather than copied from
whatever Node is running the build, and `node-runtime.json` is the single pin both this and
`scripts/pack-node.mjs` read.

`pnpm --filter @acorn/desktop run build` stages and builds the renderer, and checks the startup
budget and the generated bundles' syntax. `pnpm --filter @acorn/desktop dist` adds the bundler pass
and the inventory check. The renderer is built by the package rather than by `beforeBuildCommand`, so
the budget check runs against the bytes that get bundled.

The bundled-plugin build stages normal plugin packages under `dist/bundled-plugins`, which the
bundler copies to application resources, and the helper passes that read-only directory to the
service for pre-discovery reconciliation. Bundled client bundles are hashed and trusted from that
local resource directory, `dist/bundled-plugins` in development and application resources when
packaged, never from a node's claim, and on the same terms in both, so a development boot does not
answer one dialog per bundled package (`docs/plugins.md` § The dev loop). Staging detects missing
artifacts, not stale ones; build order is the caller's job and `package.json` is where it is written
down.

`apps/desktop/scripts/verify-bundle.mjs` runs last. It compares every file staging produced against
the same path inside the `.app`, by digest, and checks the code signature, the bundled runtime's
reported version, the updater artifact and its signature, and the DMG. The expected inventory is
whatever staging wrote, so a new resource is covered the day it is added. The packaged runtime is
checked by what it reports rather than by digest, because signing rewrites every Mach-O in the
bundle; its provenance comes from the checksum staging verified before the copy.

`bundle.macOS.signingIdentity` is `"-"`. With no identity at all Tauri runs no `codesign` pass, so
the `.app` carries the linker's ad-hoc mark on one binary and seals no resources, which
`codesign --verify` rejects. A Developer ID replaces the string and notarization joins the same pass.
`createUpdaterArtifacts` is on and the updater public key is baked in, so every release is signed
from the first one and turning updates on later is configuration rather than a re-release. There is
no updater plugin compiled in and no endpoint configured; that is blocked on Developer ID signing.
A Rust test reads the config back and fails if any of the three goes missing.

`node-pty` is the one native module left, and it must match the ABI of the process that loads it.
That process is the pinned Node in both a checkout and a bundle, so there is one ABI and
`scripts/rebuild-node-abi.mjs` builds for it. SQLite is `node:sqlite`, which has no ABI to match. The
standalone node is distributed separately as a tarball; it is not an npm package
(`docs/node-distribution.md`).

`.github/workflows/build-desktop.yml` runs the same commands on a push to main and on a `v*` tag,
plus the boot test and the Rust suite before the bundler pass so a broken boot path fails in seconds
rather than minutes. A tag builds and keeps its artifacts; publishing them is refused while the build
is ad-hoc signed.

### Signing gates and the updater

Release maturity is three gates, and only the first is met.

- **Gate 0 — ad-hoc.** Where the app ships today. `codesign --verify` passes on the `.app` and the
  DMG-mounted copy, and `spctl` rejects both, so installing means the right-click-open Gatekeeper
  dance.
- **Gate 1 — Developer ID.** One purchase unblocks three things at once: notarized desktop builds,
  the macOS half of the node tarball matrix (`docs/future/bundle.md`), and any updater. Sign and
  notarize in the same `tauri build` pass so the `.app`, DMG, and updater payload are one notarized
  bundle. It also ends the keychain re-prompting: an ad-hoc signature changes on every rebuild, so
  the data key's ACL never sticks (§ Keys and custody).
- **Gate 2 — updater on.** Needs gate 1 plus the hosting decision (R2 versus GitHub Releases); the
  updater manifest URL is the only thing that differs between the two.

When gate 2 arrives, use `tauri-plugin-updater` for the manifest check only and own the download and
install path: the plugin buffers whole downloads in memory, cannot abort or resume, and
`Update::install` performs no signature verification.
`references/proliferate/apps/desktop/src-tauri/src/updater_owned.rs` is the shape to port — a
streamed download with resume, one live download enforced, and sha256 plus minisign verified against
the baked public key before install.

The updater private key was generated on 2026-08-23 with `tauri signer generate`, has no passphrase,
and was written to `~/.acorn/tauri-updater/acorn-updater.key` on the machine that made it. That is
not durable storage: it belongs in a password manager and in the `TAURI_SIGNING_PRIVATE_KEY` repo
secret. Losing it means every install carrying the baked public key can never be updated; the only
fix is a new keypair and a manual reinstall. The workflow refuses to start without the secret,
because `createUpdaterArtifacts` with no key produces nothing signed, and an unsigned updater payload
is worse than none.

Two release gates are owed to a person, and no script closes them: the smoke checklist
([docs/testing.md](./testing.md) § The smoke checklist), run against the DMG on a machine that never
had the Electron build, and a developer soak window. Nothing ships to a person until both pass.
