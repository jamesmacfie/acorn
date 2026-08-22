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

Filled in by executing phase 0. Each spike's deliverable is a subsection here, not code.

### Custom-scheme origins and CSP (spike 1)

To verify in wry/WKWebView, with the designed fallback if it fails:

- Per-response CSP headers from a `register_uri_scheme_protocol` handler are honored, including a
  different policy per response.
- Each `app-plugin://<hash>` is a real origin: storage separation, `'self'` resolves, and a
  sandboxed `allow-scripts allow-same-origin` iframe from a different custom scheme behaves as it
  does under Chromium. **Fallback:** the helper serves each active plugin frame from its own
  ephemeral loopback port, so origin separation comes from the port; `connect-src 'none'` still
  holds inside the frame, and the shell's `frame-src` names the loopback origins the helper
  reports.
- The worker CSP trick: a dedicated worker's policy comes from its own script response, and
  `'wasm-unsafe-eval'` works. The failure mode already exists and is loud — pattern mismatch means
  the document policy applies, Oniguruma fails, and highlighting falls back to the main thread.
- Subframe navigation guarding: wry's `on_navigation` coverage of subframes. If absent, a
  macOS-specific `decidePolicyForNavigationAction` extension is the compensating control; the
  iframe `sandbox` attribute does not stop a frame navigating itself.
- `codeCache` has no Tauri equivalent. Measure the startup cost; do not assume WKWebView's bytecode
  cache covers custom schemes.

### Multi-webview compositing (spike 2)

A Tauri v2 child webview (unstable feature) positioned over the main webview: bounds tracking from
the renderer's pane host, hide under overlays, an ephemeral data store per surface, per-webview
navigation policy, `window.open` denial, and permission-request behavior (WKWebView defaults are
deny-shaped; confirm media and geolocation).

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
