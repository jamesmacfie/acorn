# Phase 9: decide how a remote Node's preview reaches the desktop

## Completion note

Decided October 15, 2026: build it. [Phase 10](./10-remote-preview-proxy.md) is the build.

The Node proxies the page, as proposed below, with one change. The desktop helper serves the page
from a per-preview loopback HTTP origin, such as `http://127.0.0.1:<port>`, and not from a custom
scheme. Every response carries a Content Security Policy (CSP) that confines the page's requests to
that origin. The shell's navigation guard confines the page's navigations to it, and the shell turns
WebRTC off in that webview. All of the results below came from a real `WKWebView`, the engine wry uses
on macOS.

### The four questions

1. **Can a custom scheme carry a modern dev server?** No. A page served from `acorn-preview://` loaded
   ES modules and same-origin `fetch`, but a WebSocket can't use the scheme: `new WebSocket` throws a
   `SyntaxError` for a non-`ws` URL. Vite's client builds its socket address from `location`, so a
   scheme page has no route for hot reload except a direct one. WebKit also doesn't follow a redirect
   that a scheme handler returns: `fetch` got the 302 itself, and a top-level redirect stopped with
   "Frame load interrupted". `document.cookie` stayed empty, service workers refused the scheme, and
   wry answers each request in one piece, so Server-Sent Events never arrived. The loopback HTTP
   origin passed every one of those checks: Vite's socket, Server-Sent Events, cookies, same-origin
   redirects, and a service worker.
2. **What does a redirect to an outside address do?** The rule: a redirect stays on the preview's
   origin, or it doesn't happen. The Node never follows a redirect. It rewrites a `Location` on the
   dev server's own loopback origin to a path, and passes any other `Location` through unchanged. In
   the page, CSP refused every cross-origin redirect the spike tried: `fetch`, `<img>`, `<script>`,
   and `<iframe>`. A top-level redirect reached the navigation policy with its target, and refusing it
   meant no request left. A probe server standing in for the client's private network saw nothing.
3. **Latency.** See [Measurements](#measurements). Through the proxy, the 300-module page loaded in
   250 ms against 226 ms locally. With 20 ms of added network delay it took 2.15 s.
4. **Which route family, and what stops a task token?** The Node carries both HTTP and the WebSocket
   upgrade under `/v1/p/preview/tasks/:taskId/proxy/*`. These rules stop a task token:
   - The proxy refuses a task-scoped caller, so only a paired device can use it.
   - The caller never names the target. The Node uses the preview URL it resolved for that task.
   - The Node refuses any target that isn't `127.0.0.1` or `::1`, and refuses its own listener port.
   - It connects to the IP address it chose, without a DNS lookup.
   - It strips `Authorization`, `x-acorn-internal`, and the helper's cookie before forwarding.

   A task token can set its task's recipe URL, but the loopback rule leaves it only a choice of
   loopback port. An agent on the Node can already reach that port from its own shell.

### What else the spike found

- WebRTC gets past CSP. In both origin types, `RTCPeerConnection` sent STUN packets to a loopback
  UDP port the page named. WebKit ignored CSP's `webrtc 'block'`. Setting the `WKPreferences` key
  `peerConnectionEnabled` to false removed `RTCPeerConnection` and no packet left. That worked before
  the first navigation and after creation, so the shell can set it through `with_webview`. It's a
  private key.
- wry calls the navigation policy for subframes as well as the main frame (`main=false` in the
  log), so an exact-origin policy covers iframes too.
- `Content-Security-Policy` `connect-src 'self'` covered `ws://` on the same host and port.
- The loopback listener is reachable by every process and browser tab on the client. Phase 10 gates
  it with an exact `Host` check and a per-preview `HttpOnly`, `SameSite=Strict` cookie. The spike
  didn't test that gate.

### Measurements

Taken October 15, 2026, on James's Mac (macOS 27, arm64), against the phase 2 `acorn-node` image in
Docker Desktop. Pages load in a `WKWebView` with a non-persistent data store, like a Tauri child. Load
time is from navigation start until React draws the app's heading. Hot reload is from the page asking
a dev server endpoint to rewrite `App.jsx` until React shows the new text. Each figure is the median
of the runs shown.

| What | Local Vite on the Mac | Container, through the proxy |
| --- | --- | --- |
| Small React page, 19 requests, six loads | 60 ms (55-77) | 126 ms (87-164) |
| 300-module page, about 320 requests, six loads | 226 ms (204-251) | 250 ms (217-417) |
| Hot reload, small page, 60 reloads | 123 ms, p90 146 | 37 ms, p90 53 |
| Hot reload, 300-module page, 30 reloads | 110 ms, p90 148 | 41 ms, p90 56 |

Hot reload is faster in the container because Linux file watching beats macOS file watching. The
same proxy chain run on the Mac in front of the local Vite gave 63 ms against 143 ms direct, so the
watcher's spread hides the proxy. Round trips isolate the proxy's own cost, 300 to 500 each:

| One small round trip | Median | p90 |
| --- | --- | --- |
| HTTP, inside the container, straight to Vite | 0.13 ms | 0.26 ms |
| HTTP, Mac to container proxy over pinned TLS 1.3 | 0.74 ms | 1.13 ms |
| HTTP, the same through the helper stand-in | 2.85 ms | 6.79 ms |
| HTTP, Mac to the real Node, `GET /v1/node` | 0.43 ms | 0.78 ms |
| WebSocket echo, inside the container | 0.03 ms | 0.06 ms |
| WebSocket echo, through helper, TLS, and pipe | 0.21 ms | 0.33 ms |

With `tc netem` adding 20 ms on the container's interface, `GET /v1/node` took 23 ms. The 300-module
page then loaded in 2,149 ms (2,125-2,154) with the helper holding four sockets to the Node, the
broker's pool size, and 1,562 ms (1,517-1,616) with 16. WebKit opens at most six connections to one
HTTP origin, so sockets past six buy little. Hot reload took 103 ms, p90 120. That figure includes the
rewrite request's own round trip, which a real save on the Node doesn't make.

Not measured: the small page under delay, a real LAN or internet path, a cold Vite start, painting in
a visible window (an agent session has none), and Windows or Linux webviews.

### How the spike ran

`pnpm dev:remote` couldn't pack at commit eb5263c5c. The Node's static graph was 1,826,261 bytes on a
clean tree, over the 1,822,300 ceiling in `apps/node/scripts/check-service-budget.mjs`, and raising
the ceiling for a throwaway run wasn't allowed. So the spike started the existing `acorn-node` image
by hand, as [Remote Node](../../local-development/remote-node.md) describes for pairing another
client. A stand-in for the Node's route ran in the container as its own TLS 1.3 process, beside the
real Node. It had the same logic as the prototype route, which typechecked in the preview plugin and
the listener but never ran. The real Node's `GET /v1/node` row gives its router cost for comparison.

No prototype code is committed. Phase 10 says where each piece lives: the HTTP proxy in the preview
plugin's Node half, the upgrade pipe as a core route kind, the per-preview listener in the helper,
and the exact-origin policy and WebRTC switch in `webviews.rs`.

Date: October 14, 2026. Status: decided October 15, 2026. Build in phase 10.

## Goal

Decide how the preview pane shows an app running on a remote Node, without letting that page reach
services on the client's private network. Record the decision here. If it's a build, write the build
phase.

## Starting point

`remotePreviewBlocked` in `packages/client-core/src/infra/node/previewUrl.ts` turns the preview off
for any Node that isn't local. Its comment gives the reason: the desktop's child webview can check
top-level navigation but can't confine redirects and page requests to the Node's network. A
malicious page could probe the client's local network. The allowlist for preview addresses is in
`apps/desktop/src-tauri/src/webviews.rs`.

A preview on a remote Node is usually `http://localhost:<port>` on that machine, which the client
can't reach anyway.

## Options

- **The Node proxies the page.** The Node fetches the preview from its own loopback and streams it
  over the existing pinned and authenticated connection. The shell serves it to the child webview from
  a custom scheme, and every request from the page goes back through that scheme to the Node. The page
  never touches the client's network. This is the most work, and the only option that gives a remote
  Node the same pane as a local one. I recommend spiking this one.
- **An SSH tunnel, documented.** The pane shows the tunnel command for the port and stays blocked.
  This is cheap. It's honest, but it isn't a preview.
- **Open in the system browser with a warning.** The browser has the same network reach the webview
  would have, so this moves the risk rather than removing it. I don't recommend it.

## What the spike must answer

1. Can the shell's custom scheme handler carry every request a modern dev server makes, including
   WebSocket upgrades for hot reload, without the page falling back to a direct request?
2. What does a redirect to an outside address do under the proxy? Name the rule.
3. Latency on the phase 2 container Node for a page load and a hot reload, measured and dated here.
4. Which route family on the Node carries the proxy, and what stops a task token from using it to
   reach other services on the Node's network?

## Acceptance

This file records a decision with the measurements behind it, and either a build phase or the reason
for keeping the block.
