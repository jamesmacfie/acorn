# Webviews and frames

Status: proposal, 2026-08-22. Three embedded-content surfaces and one automation surface. All three
renderer-side capability groups (`PreviewViews`, `PluginWebviews`, and the plugin frame machinery)
are already shaped so absence is a supported product state, which is what lets phase 2 ship without
them.

## The problem

WKWebView is not Chromium, and the differences land exactly where
[docs/electron.md](../../electron.md) argues from:

- The **preview pane** is a main-owned `WebContentsView` composited over the renderer's pane rect,
  with an ephemeral session, denied permissions, HTTP(S)-only navigation, and a tunnel-auth header
  injected via `webRequest`. wry has no `WebContentsView` and no `webRequest`.
- The **plugin frame origin** (`app-plugin://<sha256>`) relies on Chromium's `standard` privilege
  making each hash a real origin with its own storage and a working `'self'`.
- **Plugin webview panes** reuse the `WebContentsView` machinery with a manifest host allowlist.
- **Agent browser automation** drives `webContents.debugger` over CDP. WKWebView has no CDP.

## Spike findings

Run 2026-08-23 on macOS (Darwin 25.5.0), Tauri 2.11.5, wry 0.55.1, WKWebView 605.1.15. The throwaway
app is deliberately not in this repo; it was run from `~/Source/acorn-tauri-spike`
(`cargo run --bin spike-gui`), with the raw JSON in its `findings/`. It serves the shipped policies
from `appScheme.ts` and `pluginScheme.ts` verbatim under the scheme names `acorn://` and
`acorn-plugin://`, and every check is measured from inside the page.

Verdict: go. Nothing in the design needs replacing. Three things changed, all recorded below: the
tunnel cookie can be set from Rust rather than seeded through a page, a scheme handler never sees a
request body, and reading cookies back out of an ephemeral webview returns nothing.

### Custom-scheme origins and CSP (spike 1)

- **Per-response CSP is honored, and the policy differs per response.** Frame hashes a and b were
  served `connect-src 'none'` and hash c `connect-src 'self'` on the same scheme. In a and b `fetch`
  threw `TypeError: Load failed`, XHR and `WebSocket` fired error events, and `sendBeacon` threw
  `Beacons can only be sent over HTTP(S)`. In c the same fetch returned 200 and the XHR loaded. The
  frame is network-dead when the header says so, and the header travels with the response.
- **Each `app-plugin://<hash>` is a real origin.** `location.origin` is the full
  `acorn-plugin://<hash>`, `isSecureContext` is true, and `localStorage`, `sessionStorage` and
  `indexedDB` all work. `'self'` resolves: the generated document's `/ui.css` and `/client.js` both
  loaded. Storage is separated by hash — each frame read `null` for the key the previous hash had
  just written. The loopback-port fallback is not needed and is dropped from the design.
- **The iframe sandbox behaves as it does under Chromium.** With `allow-scripts allow-same-origin`
  the module script runs, `postMessage` reaches the parent, and a transferred `MessagePort`
  round-trips, which is the real host↔frame bridge. Dropping `allow-same-origin` kills the frame
  outright: the origin goes opaque, `'self'` stops matching, and no script runs at all. Both tokens
  stay.
- **The worker CSP trick works.** A worker built from a response carrying
  `script-src 'self' 'wasm-unsafe-eval'` instantiated a wasm module, and `fetch` inside it failed
  under the same response's `connect-src 'none'`. The identical instantiate in the parent document,
  whose policy has no `wasm-unsafe-eval`, threw `CompileError: Refused to create a WebAssembly
  object`. A worker's policy comes from its own script response, which is what Oniguruma depends on.
- **Subframe navigation is guardable, twice over.** A frame setting `location.href` to
  `https://example.com/` was refused by the shell's `frame-src acorn-plugin:` before wry was asked.
  For a URL `frame-src` does allow — another plugin hash — `on_navigation` fired with the subframe
  URL, and returning `false` blocked it: the frame stayed on its own document and kept answering on
  its port. No `decidePolicyForNavigationAction` extension is needed.
- **No code cache costs about 130 ms for 1.3 MB of module JavaScript**, and the number does not move
  across runs (120, 123, 135, 137 ms over four launches), so WKWebView keeps no bytecode for a custom
  scheme. `domContentLoaded` landed at 58-64 ms. Measure it against the real renderer bundle in phase
  2; it is not a blocker.
- **A scheme handler is given no request body.** A POST from the page reaches the handler and the
  page sees the response, but `request.body()` is empty, which is long-standing WebKit behavior for
  custom schemes. Nothing in the design posts to `app://` — the renderer talks to the helper over the
  WebSocket — so this closes a shortcut rather than a path. The spike reports its own results through
  `eval_with_callback` for the same reason.

### Multi-webview compositing (spike 2)

A child webview under the unstable feature, positioned over the main one, did everything the preview
pane asks of it:

- Created with `Window::add_child` while the shell webview was live, `incognito(true)`, at a
  logical position and size.
- `set_bounds` moved and resized it and `bounds()` read the new rect back unchanged, so renderer
  pane geometry can drive it directly.
- `hide()` and `show()` both succeeded, which is what hiding under an overlay needs.
- The data store is per webview and ephemeral: a second `incognito` webview on the same origin saw
  neither the `localStorage` key nor the cookie the first one held.
- `on_navigation` fired for every navigation including the one driven from page script, and
  returning `false` for `https://example.com/` kept the webview on the tunnel URL.
- `window.open` reached `on_new_window`, and `NewWindowResponse::Deny` made the call return `null`
  in the page. No window appeared.
- Page-fill rules work through `eval`: setting an input's value from Rust and reading it back
  reported the written value.
- Permissions are deny-shaped. Geolocation was refused with `User denied Geolocation`, and
  `Notification.permission` was `default`. `navigator.mediaDevices` is absent, but that is the http
  origin being an insecure context rather than a WKWebView policy, so a https preview target has to
  be re-checked in phase 3.

## Preview pane

Adopt child webviews, in phase 3. Create on `ensure`, drive bounds and visibility from the same
renderer geometry that positions the pane today, one non-persistent data store per task,
HTTP(S)-only plus the caller's rules in `on_navigation`, page-fill rules via `evaluate_script`.

**The load-bearing adaptation is tunnel auth.** With no `webRequest`, the `x-acorn-tunnel` header
cannot be injected per request. Dropping auth is rejected — the secret exists so a page in the
user's browser cannot port-scan loopback into another machine's dev server. Instead, move the
authorization to a cookie: seed the pane's ephemeral cookie store for the tunnel's
`http://127.0.0.1:<port>` before first load. `previewTunnel.ts` grows a Cookie-header scan beside
the existing header scan, same `timingSafeEqual` on `latin1` bytes, still in the helper; the
injected `headersFor` seam becomes `cookieFor` with the same refuse-unless-exactly-127.0.0.1 rule.
This is a proposed change against [docs/electron.md](../../electron.md) § Host-owned webviews.

Spike 2 settled the mechanism, and it is simpler than the seeding page this assumed:
`Webview::set_cookie` from Rust, before the first real navigation, put `acorn_tunnel=<secret>` on
every request the loopback server logged, starting with that navigation. Two constraints come with
it. The webview has to exist before its cookie store can be written, so create it pointed at a blank
page on the tunnel origin and navigate once the cookie is in. And `cookies_for_url` returns an empty
list for an `incognito` webview, so from Rust the store is write-only; the check that the cookie
arrived belongs on the helper's side of the tunnel, which is where the auth lives anyway.

Rejected: a separate `WebviewWindow` (preview becomes a floating browser; acceptable only as an
emergency fallback), an iframe in the shell (widens `frame-src` to http(s) and loses session
isolation — rejected in the Electron design already), an authless tunnel.

## Plugin webview panes

Same child-webview mechanism, same phase. The manifest host allowlist stays checked twice — in the
renderer broker and again in the Rust command layer, replacing `pluginWebviewIpc.ts`'s double
check. Ephemeral store per surface; no devtools, no tunnel cookie, no page bridge.

## Agent browser automation

Move it out of the shell and into a plugin: a browser plugin whose node half ships
`playwright-core` and contributes browser tools (navigate, snapshot, act, screenshot) through the
agent-tool contribution registry, which already projects every contributed tool to MCP, the
harness, and the renderer generically. No new machinery: the plugin registers tools the way every
other plugin does, and agents on any node — including a headless remote node with no desktop
attached — get a browser, which the desktop-routed `webContents.debugger` design could never do.

The browser itself is not in the plugin bundle. Plugin bundles are hash-addressed and distributed
by the node; a Chromium is 150 MB and platform-specific. The plugin drives an installed Chrome via
Playwright's channel option, or downloads a managed Chromium into the node's data root on first
use, and reports the tools as unavailable until a browser exists — the same explicit-unavailable
vocabulary the standalone composition already uses. The pure transforms in
`plugins/preview/src/main/browserAuto.ts` (accessibility-tree build and render, ref resolution,
URL allowlist) carry over into the plugin.

Shape it for auditing without building auditing. A future audit trail of agent tool usage belongs
at the contribution-registry dispatch seam, where every tool call already passes, not inside this
plugin. What this plugin must do is keep its rich results audit-ready: screenshots, traces, and
console captures are returned as blobs the node stores keyed to the task and agent event, not as
inline base64 that evaporates with the transcript. Nothing else is designed here.

The user's preview pane and the agent's browser become two surfaces on purpose: the Tauri child
webview is view-only for the person, the Playwright browser is the agent's. When the agent needs
to see what the user sees, it points its own browser at the same tunnel URL. The `desktop.preview-*`
capabilities stay desktop-routed over the service protocol and terminate in the Rust webview
commands.

Rejected: raw CDP with a hand-rolled client (Playwright buys waiting, selectors, screenshots, and
traces for one dependency), a pseudo-CDP over `evaluateJavaScript` (weaker, bespoke, loses console
and log domains and isolation from page script), dropping the tools (they are load-bearing for
agents), chromiumoxide in Rust (the node owns agents; wrong process and wrong language), shipping
Chromium inside the plugin bundle (size, platform matrices, and hash-addressed distribution all
say no).

## Exit criteria

- Preview pane: load, navigate, tunnel-authed dev server, page-fill rules, hide under overlays.
- Plugin frame: renders, is network-dead (`fetch`, XHR, WebSocket, beacon all fail), storage
  isolated per hash or per fallback origin.
- Plugin webview pane: allowlist enforced on navigate and redirect.
- Browser tools: an agent completes a snapshot-act-verify loop through the plugin's contributed
  tools on a machine with a browser, captures a screenshot persisted as a blob, and reports
  unavailable cleanly on a machine without one.
