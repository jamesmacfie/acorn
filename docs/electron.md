# Electron runtime

Electron is acorn's native host. It does not own product data or feature engines. The Node service
is built separately and embedded into the desktop package; Electron starts it and brokers access to
it.

## Main process

`apps/desktop/src/app/main/electron.ts` creates the application window and registers the `app://acorn`
and `app-plugin://` protocols as privileged. Both registrations run at module scope, before
`app.whenReady()`, because Chromium reads the privileged-scheme table while it initializes; registering
after that point is a silent no-op. `app://acorn` gets `standard` (the hierarchical URLs that
`base: '/'`, `history.pushState`, and the router's path routes need to work at all), `secure` (a secure
context for IndexedDB, `crypto.subtle`, and clipboard), `supportFetchAPI` (the renderer is ESM and
Monaco loads its five `?worker` chunks through `fetch`), `stream` (the handler can answer with a
streamed body instead of buffering it), and `codeCache` (a V8 code cache across launches, which accounts
for most of the startup win). It does not get `corsEnabled`, because nothing the renderer touches is
cross-origin (Node traffic runs over IPC, not fetch), and it does not get `allowServiceWorkers`, because
there is no offline story and no worker should be able to cache the shell. `app-plugin://<hash>`'s
privileges are under [The plugin frame origin](#the-plugin-frame-origin) below.

`bootstrap.ts` composes:

- service supervision and restart policy;
- the node connection broker;
- `safeStorage` and device-token custody;
- navigation, window creation, and external-URL policy;
- native folder dialogs and preview/browser capabilities;
- quit-time service shutdown and view cleanup.

The main process must not import plugin engines, database handles, or Node source. Domain behavior
belongs in the Electron-free service graph.

### Startup: data directory, environment, and the singleton lock

The writable app-data root (the SQLite databases, blobs, worktrees, and notes) is `apps/node/.acorn`
in a dev checkout, so a checkout's data stays with the checkout, and the OS-standard `userData` path
once packaged, since a packaged build's module lives in a read-only asar and cannot write beside
itself. An e2e run can override both with `ACORN_E2E_DATA_DIR`. `apps/desktop/src/app/main/electron.ts`
resolves the path; `node-core/main/serverPaths.ts` owns it from there, because the Node owns SQLite,
blobs, and the node identity.

Secrets load from `.env` in two places, in order: the bundled dev file next to the build output (a
packaged build has none, so that load no-ops), then a user-provided `.env` inside the data directory
itself (`~/Library/Application Support/acorn/.env` once packaged). `SESSION_ENC_KEY` falls through to
`safeStorage` either way if neither file supplies it, resolved by `resolveSessionKey` before the node's
listener starts accepting connections.

`app.requestSingleInstanceLock()` makes a second launch focus the existing window instead of starting a
second process. The data root's own exclusive lock (`node-core/main/dataRoot.ts`) is the real mutual
exclusion; the single-instance lock only keeps a second launch from getting as far as contending for it.

Quitting negotiates with the renderer first: `before-quit` asks the client event service to collect any
concerns and sends `acorn:will-quit`, then waits for `acorn:quit-response`. Once approved, `app.quit()`
re-enters with the guard open and runs bootstrap's ordered will-quit disposal. The node recovery
screen (`client-core/node/NodeGate.tsx`) has its own two native actions, `open-data-folder` and
`force-quit`. `force-quit` skips that renderer negotiation, because the prompt is answered by the app
shell, which is not mounted while the recovery gate is showing, so routing through it would hang.

## Node child

The desktop starts the built artifact at `out/main/service.js` with:

```ts
spawn(process.execPath, [entry], {
  env: { ELECTRON_RUN_AS_NODE: '1' },
  stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
})
```

The Node sends a versioned service-protocol `start` response containing its `nodeId`, endpoint,
certificate fingerprint/PEM, and local device token. Electron adopts that record into the broker only
after the listener is ready. Startup failures fail closed; a crash after startup is retried with
bounded exponential backoff and eventually shows the recovery UI without creating a new data root.

The crash budget (`main/crashBudget.ts`) allows five restarts inside a ten-minute window, waiting
1, 2, 4, 8, then 16 seconds before each one; a sixth crash inside the window gives up and shows the
recovery screen instead of restarting into the same fault. An earlier, tighter policy (roughly
250ms doubling, capped at three crashes in sixty seconds) meant a service crashing on something
durable, a corrupt database or a port it could never bind, burned its whole budget in under two
seconds and gave up before a person could read anything on screen. Each start persists whatever
device token the Node ended up using and is reused on every start, including crash recovery, since a
restart must not mint a new device row and the Node's endpoint can change between restarts. Reconnecting
every remembered node (the local one included) happens as part of registering the connection broker's
IPC, before the renderer exists, since the broker's first act on load is to ask for the fleet.

The Node owns SQLite, migrations, HTTP/WebSocket listeners, PTYs, tmux, worktrees, Git, processes,
workflows, Docker, provider clients, reconciliation, and shutdown draining. `will-quit` asks it to
close the listener, dispose plugin engines, close SQLite, and release the data-root lock with a
30-second overall deadline.

The supervised child and standalone Node consume the same `apps/node/src/server/composition.ts` graph
and reconciliation/drain plan. Electron supplies supervision and native adapters; it does not assemble a
parallel plugin graph.

## Renderer origin and protocol handler

The renderer loads from `app://acorn` and the Node serves no assets. `main/appScheme.ts` maps bundled
files from `dist/client`, returns the bundled `index.html` for client-side deep routes, and adds the
renderer Content-Security-Policy. It reads a request's path with `join`, which normalizes it, then
still checks the resolved path stays under the bundled root: `join` alone would not catch a
percent-encoded `..` that only becomes `..` after `decodeURIComponent`. The file lookup goes through
`net.fetch` on a `file://` URL rather than `readFile`, which gets MIME sniffing (module scripts fail
their type check without it), range requests, and a streamed body for free; the response headers are
rebuilt rather than mutated, since a fetch `Response`'s headers are immutable, but the body stays the
same stream so nothing gets buffered.

The CSP is set as a response header rather than an `index.html` meta tag, because a header cannot be
overridden by markup injected into the document, and a meta tag can be preceded by content it
therefore fails to cover. `connect-src 'self'` is the load-bearing directive: renderer code cannot make
a direct request to a Node, so all Node traffic runs over IPC through the broker. `frame-src` names
only the plugin scheme, `app-plugin:`, since plugin frames are the one thing the renderer embeds
([The plugin frame origin](#the-plugin-frame-origin) below); the browser-preview pane is a main-owned
`WebContentsView` rather than a frame, so widening this for `http(s)` would buy nothing. Two more
directives carry their own reason: `style-src 'unsafe-inline'` is required because Shiki emits
`style="color:#…"` attributes into HTML that reaches `innerHTML`, and style attributes are CSP-gated
independently of `el.style.x = v` assignments; `img-src https:` exists for GitHub avatars rendered in
PR authorship (`ui/UserAvatar.tsx`), and narrowing it to the two GitHub avatar hosts is a one-line
change once nothing else renders a remote image.

### The syntax-highlighter worker's separate policy

One response gets a different policy for a reason that is a fact about workers, not about acorn: a
dedicated worker loaded from a same-origin URL takes its Content-Security-Policy from that script's
own response headers, not from the document that created it. So the highlight worker's script can
carry `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'`, which buys Shiki's Oniguruma engine
(measured at 4.6x the pure-JavaScript one) `wasm-unsafe-eval`, while the document above keeps the
policy it has always had. The worker ends up with strictly fewer capabilities than the renderer code it
moved out of: no network, no DOM, no bridge to main, nothing fetchable. It takes strings and returns
colors, and `shiki/wasm` is the inlined build, so even the WebAssembly module arrives as part of the
script rather than as a fetch, which is what lets the worker's own `connect-src 'none'` stand. This was
verified in Electron rather than assumed, three ways: the document still cannot instantiate WASM, the
worker can, and the identical bytes served with the document's header cannot.

Only a worker's top-level script response sets its policy this way; the grammar chunks that worker
imports are governed by the worker's own `script-src 'self'` and need nothing here. Electron Vite's
worker output format is `es`, not the default `iife`, specifically so the worker can code-split: under
`iife` every grammar gets inlined into one 3.1 MB file, where the ES module form ships roughly 250 KB
plus the one or two grammars a given diff actually touches. It must never become an inlined blob
worker either: a `blob:` worker inherits the *document's* CSP, so the relaxation would silently stop
applying and Oniguruma would fail inside it.

`main/appScheme.ts` identifies the one response that gets the relaxed policy by filename, matching
`/^\/assets\/worker-highlighter\.worker-[\w-]+\.js$/`. The `worker-` prefix on the entry name
(`electron.vite.config.ts`) is required, not cosmetic: Vite emits two files derived from
`highlighter.worker.ts`, the worker entry itself and a roughly 270-byte main-thread wrapper that
constructs it, and without a distinguishing prefix both would be named `highlighter.worker-<hash>.js`
with no way to tell them apart. Monaco's five workers keep the plain `[name]` pattern, so they get their
own names and the document's ordinary, unrelaxed policy. If a future bundler change ever renames the
worker entry, the pattern stops matching, the worker falls back to the document's policy, Oniguruma
fails inside it, and `highlight/worker.ts` logs the failure and falls back to the main thread: degraded
and loud, which is the failure mode this area was built to have.

The preload exposes a narrow, validated `window.acorn` surface. It carries broker request/response
bytes, stream frames/status, fleet operations, lifecycle actions, folder selection, and task-addressed
desktop capabilities. It never exposes raw `ipcRenderer`, a Node token, a certificate, a database
handle, a process object, or a `webContents` ID.

That surface is the *implementation* of the platform seam, and the renderer never reads it directly:
`packages/client-core/src/platform/` is the only module allowed to touch the global, enforced by
`boundaries.test.ts`. Presence of a preload key is therefore never a product capability. The folder
picker in particular is a folder picker — it used to sit under a `terminal` key whose presence gated
the whole terminal/agents/run-targets/workflows block, which are ordinary `/v2` + WebSocket surfaces
(`git history: docs/future/node-first/platform-seam.md`).

## The plugin frame origin

There is a second privileged scheme, `app-plugin://<sha256>`, one origin per third-party plugin bundle
(`main/pluginScheme.ts`, registered in `bootstrap.ts` because it serves from the content-addressed
plugin cache and from nothing else). The host part is the bundle hash, which makes each plugin a
distinct origin, makes the origin immutable, and makes an uncached hash a 404 rather than a fetch. Its
privileges are `standard`, `secure`, and `supportFetchAPI`: `standard` is what makes each hash a real
origin with its own storage, which is the sandbox's separation; `secure` and `supportFetchAPI` follow
from the bundle being an ESM module like the renderer's. It does not get `codeCache`, because a cache
keyed by a hash that is already content-addressed buys nothing, and one fewer place third-party code
persists on disk is worth more than the milliseconds saved.
Only `/index.html` — generated by main, so the plugin never controls its own head — `/client.js`, and
the host-owned `/ui.css` presentation kit exist there. The stylesheet is compiled into Electron main
from the same pure component styles the shell uses; it is not part of the plugin's mutable input.

Every response carries `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self'; connect-src 'none'`. `default-src 'none'` makes every directive
opt-in, so a fetch type nobody thought about is denied rather than inherited; `connect-src 'none'` is
the one worth reading twice, since a plugin frame has no network at all, not a restricted one; `fetch`,
`XHR`, `WebSocket`, `sendBeacon`, and `EventSource` all fail, so a malicious bundle cannot exfiltrate
what it sees even to its own server. `style-src 'unsafe-inline'` exists because the appearance tokens
arrive over the port and are applied as inline custom properties on `:root`; `img-src data:` lets a
plugin draw an inlined icon without an asset pipeline. A plugin frame's only I/O is the `MessagePort`
the shell transfers in, where each call is checked against the plugin's declared scopes
(`docs/plugins.md`). The renderer's own CSP names this scheme in `frame-src` and nothing else.

There is no `x-frame-options` or `frame-ancestors` on these responses: the shell frames a plugin from
`app://acorn`, a different origin, so `SAMEORIGIN` would block the only embed that is meant to work.
What actually bounds who can frame a plugin is that nothing else in this process can: the shell's own
CSP is the only one naming this scheme in `frame-src`, and top-level navigation to it is denied in
`electron.ts` (above). Responses also carry `cache-control: no-store` even though frames are
hash-addressed and could in principle cache forever: this is a local scheme backed by a
content-addressed store already, so there is nothing to gain and one more place for stale bytes to
live.

Navigation policy has two halves. `will-navigate` keeps the main frame on `app://acorn`, so a plugin
origin can never become the whole window. There is no OAuth exception to that rule: GitHub connects
by device flow against the Node (`POST /v2/p/github/auth/device/start`), so no window ever has to
navigate to github.com itself. `will-frame-navigate` keeps every subframe on
`app-plugin://`, so a plugin frame cannot navigate itself elsewhere — and unlike the main frame, a
blocked subframe URL is not offered to the system browser either. `setWindowOpenHandler` already
denies `window.open` from anywhere, plugin frames included.

A frame's rendered content therefore reaches the outside world only by *asking*, over the bridge:
`ui.openUrl` hands an `https` URL to the shell, which resolves it in-app if a content-link recogniser
claims it and otherwise calls `window.open` **from the renderer's own frame** — landing in
`setWindowOpenHandler` and `shell.openExternal` behind the scheme allowlist, exactly as a descriptor's
`openUrl` verb does. So this adds no navigation path in main and no exception to the two rules above: a
blocked subframe navigation is still blocked, and the URL that reaches the OS arrived through the one
handler that was already there. The frame is never told which of the two happened
(`docs/plugins.md`).

The renderer embeds these with `sandbox="allow-scripts allow-same-origin"`. `allow-same-origin` is
required, not a lapse: the pair is only dangerous when the framed document shares the *embedder's*
origin, and here the embedder is `app://acorn`. Dropping it makes the origin opaque, which breaks
`'self'` in the CSP above and turns the frame's own module script into a cross-origin fetch on a
scheme with no CORS.

## Connection broker

`main/nodeBroker.ts` is Electron-free apart from its use by the main composition root. For each Node
it owns:

- endpoint and certificate fingerprint;
- a pinned `https.Agent` and device token;
- one authenticated WebSocket;
- request aborts, stream routing, reconnect backoff, and connection state.

The renderer calls `nodeFetch(nodeId, request)` and stream methods over preload IPC. The broker adds
the bearer, validates the pinned certificate, and returns serializable response bytes. Node states
are `online`, `degraded`, `offline`, `incompatible`, and `revoked`.

Both ends run a ping/pong watchdog. A sequence gap or watchdog failure makes the Node stale and causes
the client to reconnect/refetch. A mutation is never queued automatically while a Node is offline.

There is no `app.on('certificate-error')` handler for a Node's self-signed certificate, and there does
not need to be one. That event only fires for requests Chromium itself makes, and nothing in the main
process asks Chromium to talk to a Node: the window loads `app://acorn`, and every byte to or from a
Node goes through the broker's own `https.Agent` above, which does its own pinning. A handler here
would only add a certificate-override path for a trust decision this process does not make.

### Fleet membership

`main/fleetStore.ts` holds which Nodes this client knows, where they are, and what certificate to pin,
in `fleet.json`. It lives in main because main is what already holds the two things fleet membership
is inseparable from: device tokens and pinned certificates. The renderer gets a token-free `NodeRecord`
projection built by explicit field selection, not a spread with keys deleted, so a field added to the
stored record cannot leak to the renderer by default.

The file and the tokens are split into two stores on purpose. `fleet.json` holds the non-secret record
(`0600` regardless, since an endpoint list is still information about the owner's machines), and each
token is its own `safeStorage` blob in `deviceTokenStore.ts`. Putting tokens in the JSON would mean the
whole file has to be decryptable to read a label, and would lose the token store's fail-quiet behavior
on a machine with no keychain: it simply forgets rather than blocking. The bundled local node's token
predates its `nodeId`, so it keys off a fixed scope instead of the node id like every paired node's
token does.

The local node is a singleton: exactly one, and it cannot be unpaired. Its *identity* is not equally
stable, since replacing the data root brings the same machine back up under a new `nodeId`, so
`remember()` replaces any other row marked local, as well as its own row, when a local node arrives.
Matching on `nodeId` alone once appended a second `local: true` row instead of replacing anything, and
nothing cleared it: the boot loop skips local rows when reconnecting because the local endpoint is
unknown until the service binds a port, and the forget action refuses to remove a local row at all. The
leftover row stayed listed with no broker connection behind it, and the code that picks the fleet's
home node takes the first local row, so the window homed onto a node whose every request answered
"Unknown node" from the broker while the persisted per-node query cache kept the shell looking
populated. The dropped row's credential is not forgotten along with it, since every local row shares
one token scope, so the write is what refreshes the live node's own token rather than discarding it.

## Host-owned webviews

`webviewService.ts` owns every native `WebContentsView`. Preview is one kept-alive view per task and uses a task-specific
ephemeral session, no preload, denied permission requests, HTTP(S)-only navigation, and an external
chrome layer rendered by the desktop. Main positions the native view over the renderer's pane host
and hides it while overlays cover the pane.

A loaded plugin may also declare a `webview` pane. Its manifest hosts are checked by the renderer
broker and again in main, including `will-navigate` and `will-redirect`. Each surface gets an
ephemeral isolated partition and no CDP attachment, devtools, tunnel header, preload, or page bridge.

For a task whose dev server is served by another Node process, `main/previewTunnel.ts` opens an
authenticated loopback listener that forwards raw bytes to the Node's own tunnel endpoint over its
pinned agent, so the preview pane can reach a dev server without the renderer ever touching the
network directly. It binds `127.0.0.1` explicitly; binding `0.0.0.0` would publish another machine's
dev server to the local network, the opposite of the tunnel's purpose. Because a task's preview URL
can be resolved more than once while its resource is settling, opening for a key already in flight
returns the same promise instead of racing a second listener into existence.

Each listener carries a 32-byte, base64url-encoded secret, generated once per listener rather than per
connection, since the pane's session attaches it by destination port and there is no channel to hand a
per-connection value to the pane instead. `authorize()` reads the connecting socket's request head,
scans it case-insensitively for the `x-acorn-tunnel` header (compared with `timingSafeEqual` on a
length-checked pair, since the header carries no information an attacker could usefully time out of a
random secret), and destroys the socket on any mismatch before anything dials the Node. The header
scan works on the raw bytes as `latin1`, not `utf8`, because a decoder that can produce a replacement
character could make two different byte strings compare equal.

A connection that never completes a request head is refused after a two-second deadline, bounded to
8 KB while it waits, so an unauthenticated peer cannot pin memory or a file descriptor by connecting and
saying nothing. A ceiling of 16 open tunnels per renderer caps how much a compromised renderer could
ask main to open; the renderer is a trust boundary because it is the part of the system that renders
third-party content (`nodeBrokerIpc.ts`). An idle listener with no live connection for 60 seconds is
reaped as a backstop for the paths that do not close their own tunnel (a crashed renderer, a window
closed abruptly); the pane closes its tunnels on unmount in the ordinary case. Both sides of the pipe
pause their socket on read and resume it only once the paired side has accepted the last chunk, so a
slow peer applies backpressure through the kernel instead of growing an unbounded buffer in main.

`headersFor(url)` is how the secret reaches the `WebContentsView` without the preview plugin importing
this file, which plugins may not do (`tools/arch/boundaries.test.ts`): it is passed in as an injected
function, the same pattern `loadRules` already used. It refuses to attach the header to any URL whose
host is not exactly `127.0.0.1`, since a page served through the tunnel can link anywhere, and attaching
the secret to a request bound for a third party would hand it away.

## Service protocol

`packages/protocol/src/serviceProtocol.ts` defines versioned lifecycle messages and
`desktopCapabilities.ts` defines narrow native calls. Both endpoints validate messages with Zod.
Calls are task-addressed and serializable. Pending calls reject on timeout or peer exit. Product
requests do not use this RPC; they use `/v2` over the broker.

## Native capability boundary

The service may request only the native operations represented by
`@acorn/protocol/desktopCapabilities.ts`. Preview/browser calls are validated in Electron main and
remain scoped to a task and binding. The service never receives a `BrowserWindow`, `WebContentsView`,
or Electron object.

## Build and packaging

`apps/node` emits `service.js`, `mcp.js`, `standalone.js`, and shared chunks. Electron Vite stages the
service artifact and every core/plugin migration chain into `apps/desktop/out/`. The desktop's
bundled-plugin build also stages normal plugin packages under `out/bundled-plugins`; electron-builder
copies them to application resources, and main passes that read-only directory to the service for
pre-discovery reconciliation. Bundled client bundles are hashed and trusted from that local resource
directory — `out/bundled-plugins` in development, application resources when packaged — never from a
node's claim, and on the same terms in both, so a development boot does not answer one dialog per bundled
package (`docs/plugins.md` § The dev loop). The desktop build must run the service and bundled-plugin
builds first; staging detects missing artifacts, not stale ones.

`node-pty` must be rebuilt for the ABI of the process that will load it — SQLite is `node:sqlite`,
which has no ABI to match. Plain
Node development uses the Node ABI; the packaged app uses the Electron ABI. `electron-builder` then
produces the macOS DMG/ZIP. The standalone Node is distributed separately as a tarball; it is not an
npm package.
