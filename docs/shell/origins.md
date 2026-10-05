# Origins and schemes

This page covers the two custom schemes the shell serves: `app://acorn` for the renderer, with its
content security policy, the highlighter worker's policy, and `app-plugin://` for plugin frames and
tree workers, with the navigation policy. Read it before you change a policy or a scheme handler. It's
part of [desktop shell](../shell.md).

## Renderer origin and protocol handler

The renderer loads from `app://acorn`, and the Node serves no assets.
`apps/desktop/src-tauri/src/app_scheme.rs` maps bundled files from the staged client, returns
`index.html` for client-side deep routes, and sets the renderer's content security policy on every
response. It refuses every authority except `app://acorn`, so a lookalike such as `app://acorn.evil`
gets nothing.

The traversal guard runs after percent-decoding, because `..` arrives encoded. It refuses any `..`
component instead of normalizing. A request for `/v1/` or `/api/` gets a 404 in the wire's JSON
envelope, because the renderer's HTTP client falls back to a same-origin fetch when it has no active
Node yet, and HTML parsed as JSON is the worst answer.

The handler is registered asynchronously and answers each request on its own thread. The synchronous
form would run each response on the thread the webview draws on, and a cold window asks for over a
hundred module scripts. A thread per request suits the tens of reads a launch makes, and a pool behind
the same responder is the upgrade if that changes.

Cache headers depend on the build. A packaged build serves `/assets/<name>-<hash>.<ext>` with
`public, max-age=31536000, immutable`, because the bundler content-hashes every file there. Everything
else is `no-store`, `index.html` above all, because its name never changes. A development build is
`no-store` throughout, because Vite rewrites files under the same names. A Rust test asserts all four
cases.

### Development

Development proxies the Vite dev server through this same handler, so you exercise the shipped
origin. Before it opens a development window, the shell requests `src/client/index.tsx` from Vite and
waits for it to settle, because Vite can serve `index.html` while still rebuilding dependencies. It
retries a 504 and an unavailable socket for up to 30 seconds. Any other status ends the wait, so a
real transform error reaches the startup guard. If the entry script then fails, the startup guard
shows a loading message and reloads up to four times for a 502 to 504 or a newly settled response.

The proxy forwards what Vite said, including a refusal. Vite sends 504 to ask the page to reload after
rebundling a dependency, and 500 with the transform error in its body. Only an unreachable dev server
becomes a 502, and it logs first. Two Rust tests hold the split.

### The renderer's policy

The policy is a response header, not a meta tag, because markup can't override a header.
`connect-src` names `'self'`, Tauri's IPC protocol, and the helper's exact loopback WebSocket port, so
no other local service is reachable. Renderer code still can't reach a Node directly, because only the
helper holds the pinned connection and the bearer.

`ipc:` and `http://ipc.localhost` are there because Tauri's IPC is a custom protocol too. They reach
only the commands in `commands.rs`, and `capabilities/default.json` says which. That file is scoped by
webview label, never by window, because naming a window would grant `core:default` to every webview in
it, including preview and plugin pages. A Rust test fails if `windows` reappears.

`frame-src` names only `app-plugin:`. The response carries `frame-ancestors 'none'`, so a plugin iframe,
which runs with `allow-scripts allow-same-origin`, can never load an `app://acorn` document and become
same-origin with its parent. `style-src 'unsafe-inline'` is required because Shiki emits
`style="color:#…"` attributes. Remote images are limited to GitHub avatar hosts for pull request
authorship (`kit/components/content/UserAvatar.tsx`). Development widens the policy in one branch, for
Vite's HMR socket and inline preamble, and a Rust test asserts the packaged policy has neither.

### The syntax-highlighter worker's separate policy

A dedicated worker loaded from a same-origin URL takes its policy from its own script's response
headers, not from the document. So the highlight worker's script carries
`default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'none'`. That allows Shiki's
WebAssembly regex engine, measured at 4.6 times the JavaScript one, while the document keeps its
policy. The worker has no network, DOM, or bridge. `shiki/wasm` is the inlined build, so the module
arrives in the script and `connect-src 'none'` holds.

Grammar chunks the worker imports follow its `script-src 'self'`. The worker output format is `es`,
so it can code-split: `iife` would inline every grammar into one 3.1 MB file. It must never become an
inlined `blob:` worker, which would inherit the document's policy.

`app_scheme.rs` matches the one relaxed response by file name:
`/assets/worker-highlighter.worker-<hash>.js`. The `worker-` prefix (`apps/desktop/vite.config.ts`) is
required, because Vite also emits a small main-thread wrapper derived from the same file. If a bundler
change renames the entry, the worker falls back to the document's policy, Oniguruma fails, and
`highlight/worker.ts` logs and falls back to the main thread.

## The plugin frame origin

`app-plugin://<sha256>` is one origin per third-party plugin bundle
(`apps/desktop/src-tauri/src/plugin_scheme.rs`). The host part is the bundle hash, so each plugin is a
distinct, immutable origin with its own storage, and an uncached hash is a 404.

Only these paths exist: `/index.html`, generated by the shell so the plugin never controls its head,
`/client.js`, the host's `/ui.css` presentation kit, and the host's tree relay document and script.
`apps/desktop/scripts/stage.mjs` lists the client-core modules that make up `/ui.css`, and
`packages/client-core/src/infra/styles/cssHygiene.test.ts` checks a frame gets a base rule for every
class `primitives.css` styles. A bundle resolves to `<userDataDir>/acorn-1-plugin-cache/<hash>.js`, so
only a 64-hex name this device holds can be served.

Every response carries `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self'; connect-src 'none'`. A plugin frame has no network at all:
`fetch`, XHR, WebSocket, `sendBeacon`, and `EventSource` all fail. Its only I/O is the
`MessagePort` the shell transfers in, where each call is checked against the plugin's declared scopes
([frames](../plugins/frames.md)). `style-src 'unsafe-inline'` carries the appearance tokens as inline
custom properties, and `img-src data:` allows an inlined icon. Responses carry `cache-control:
no-store`, because the store is already content-addressed. There's no `frame-ancestors`, because the
shell frames plugins from another origin.

The renderer embeds frames with `sandbox="allow-scripts allow-same-origin"`. `allow-same-origin` is
required: the pair is dangerous only when the frame shares the embedder's origin, and dropping it
would make the origin opaque and break `'self'`.

### The plugin worker

A loaded plugin can run in a dedicated Web Worker and emit a tree instead of drawing in an iframe
([plugins](../plugins.md) § The client half of a loaded plugin). The renderer embeds a hidden,
host-owned document at `app-plugin://<sha256>/worker.html`, which loads only `/worker-host.js`. That
creates a module Worker from `/client.js`, so the bundle runs under its own origin and can't read the
renderer's storage. The renderer checks the relay's window, exact origin, and per-instance nonce
before it transfers the bridge and tree ports, and the relay checks its parent's origin, nonce,
protocol version, and port count. Nothing falls back to running the bundle at `app://acorn`, and the
old `/plugin-worker/*` route returns 404. The bytes and the trust decision are the frame's.

The relay document allows only its host script and one same-origin Worker. The bundle's response
carries `default-src 'none'; script-src 'self'; worker-src 'none'; connect-src 'none'`.

On Windows, Wry maps custom schemes to HTTP origins: `app://acorn` to `http://app.localhost`, and
`app-plugin://<hash>` to `http://app-plugin.<hash>`. The handshake accepts those exact origins. A
64-character hash host hasn't been checked in WebView2, and if it's rejected, the tree fails closed.

`packages/client-core/src/host/tree/workerHost.ts` shares one modern worker per accepted
`(pluginId, hash)`, with a separate bridge port and context per mounted slot, and a bounded idle pool.
Legacy SDKs get one worker per mounted tree
([mounted bridge ownership](../plugins/remote-trees.md#mounted-bridge-ownership-and-sdk-compatibility)).
`TreeHost.tsx` validates each batch and is the only thing that turns a handler ID into a function. A
worker that misses two heartbeats is ended and its trees removed, with the failure in plugin
diagnostics.

### Navigation policy

External anchor clicks and calls to `window.open` in the main renderer pass through
`apps/desktop/src/shell/externalLinks.ts`. A click claimed by in-app content-link resolution stays
inside Acorn. Other web and email links call the shell's `open_external_url` command in
`apps/desktop/src-tauri/src/external_urls.rs`. It validates the URL, permits `http`, `https`, and
`mailto`, and hands it to the operating system's default handler. App and plugin origins are refused,
including their mapped forms on Windows. The main window denies creation of another app window.

The bridge handles links before WebKit tries to navigate. On macOS, the navigation guard runs before
the new-window handler, so a handoff in `on_new_window` alone cannot open an external link.

The opener plugin's automatic click interceptor is disabled. The renderer has no opener plugin
permission, so that interceptor would cancel the click and then fail its request. The shell calls
the Rust opener through its own validated command. Child webviews keep their own new-window refusal.

The window's `on_navigation` guard admits the exact `app://acorn` origin and hash-shaped
`app-plugin://<hash>` origins, including Wry's mapped forms on Windows, and refuses everything else.
It fires for subframes too, so a plugin origin can't become the whole window and a plugin frame can't
navigate off its document. There's no OAuth exception: GitHub connects by device flow against the Node
(`POST /v1/p/github/auth/device/start`).

A frame reaches the outside world only by asking over the bridge. `ui.openUrl` hands an `https` URL
to the shell, which opens it in the app if a content-link recognizer claims it, or in the system
browser behind the scheme allowlist. The frame isn't told which.
