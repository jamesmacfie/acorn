# Phase 10: show a remote Node's preview through the Node

Date: October 15, 2026. Status: built October 27, 2026, on branch `preview`. The checks that need the
real desktop webview are still open (see the completion note). Depends on [phase 9](./09-remote-preview.md),
whose spike decided this design and holds the measurements behind it.

## Completion note

October 27, 2026, on branch `preview`. The shipped pages are [host-owned webviews](../../shell/webviews.md#a-remote-nodes-preview),
[the bridge and broker](../../shell/bridge-and-broker.md#previews), and
[loopback routes](../../plugins/plugin-api.md#loopback-routes). They win where this plan disagrees.

What landed:

- **The Node.** The hub hands any upgrade that isn't `/v1/events` to the listener, and the listener sends it
  through the app like a request (`transport/listener.ts`, `transport/wsHub.ts`). So the Host check, sign-in,
  and route matching apply, and only a loopback route takes the socket (`proxy/loopbackRoute.ts`). Anything
  else gets its answer's status. `proxyUpgrade` now strips the route's mount from the path. This added
  305 bytes to the Node service graph: 1,939,324 of 1,939,500 in a local build.
- **The helper.** `openPreviewListener` (`packages/custody/src/broker/previewProxy.ts`), one listener per
  task's preview, and `NodeBroker.previewTransport`, a pinned pool of six sockets that adds the bearer
  itself. `preview-open` and `preview-close` in the helper. Previews belong to the renderer connection,
  so forgetting the Node or closing the window closes them. The preview plugin names its route in
  `plugins/preview/src/contract/routes.ts`.
- **The shell.** The `remote-preview:<nodeId>:<taskId>` family in `webviews.rs`, with its exact-origin policy,
  the WebRTC switch, and Rust tests for the key format, the policy, the family, and an object without
  the switch.
- **The client.** `previewTarget` answers `direct`, `proxied`, or `blocked` with a reason. `previewProxy`
  (`open`, `onBlocked`) is in the platform contract, the Tauri bridge (macOS only), and the contract
  tests. The pane shows why a preview is blocked, and an address the shell refused, with a copy button.

Decisions and deviations:

- **The upgrade goes through the app, not a registry in the hub.** A registry would have needed its own
  route matching and its own copy of the sign-in rules, in the boot graph. Sending the upgrade through
  `app.fetch` reuses all of them, and costs a few hundred bytes.
- **The entry carries the start page.** `preview-open` takes `{ nodeId, taskId, path }`, and the entry is
  `/__acorn/preview?key=<secret>&to=<path>`. So one listener serves any start page, and a change of address
  on the Node doesn't change the page's origin.
- **`previewProxy` has `onBlocked`, and closing is `PreviewViews.evict`.** The pane already evicts a preview
  when it stops showing it, so a separate close would be a second way to say the same thing.
- **The Rust test can't touch a real `WKPreferences`.** WebKit kills a process that uses it off the main
  thread, and Rust tests run on other threads. The test checks that an object without the switch is
  refused. The switch itself has to be checked in the running app.

Acceptance, October 27, 2026, on `pnpm dev:remote` (the container Node at `https://localhost:4317`, macOS 27 on
James's Mac):

- **Passed: a task token gets 403.** A live task token, read from a task terminal's shell inside the
  container, got `403` from `/v1/p/preview/tasks/:taskId/proxy/` for a plain request and for an upgrade. The
  same token got `200` from that task's `/url` route, so the refusal is the proxy's rule.
- **Passed: the Node refuses its own port and other hosts.** A recipe address of `http://localhost:4317/`
  got `403` and "That port belongs to this Node." through the helper listener. `http://192.168.1.8:47999/`
  got `404` `no_preview` from the Node, and the client blocks it first with its own message.
- **Passed: the listener's gate.** Without the cookie, with `Host` set to `localhost:<port>` or
  `evil.example:<port>`, or with a wrong key, the listener answered `403`. A link from another site, in
  the same WebKit profile, got `403`, because the cookie is `SameSite=Strict`. A second WebKit browser
  with its own profile got `403`.
- **Passed, in headless WebKit: the app loads and live reload works.** This ran the branch's broker and
  listener in a script on the Mac, pinned to the container Node, with Playwright's WebKit 1.64.1 in place
  of the webview. The Vite React app loaded in 59 to 182 ms over six cold loads, median 72 ms, 10
  requests each. Twenty page-driven reloads took 35 to 109 ms, median 45 ms, in the same document. A file
  written in the container by `docker exec` updated the heading in the same document, with no page
  refresh. No real network path was available, so there is no figure for one.
- **Passed, in headless WebKit: the content policy.** The phase 9 probe page, aimed at a probe server on
  the Mac at `127.0.0.1`, `localhost`, and `192.168.1.8`, made no request to it from `fetch`, images,
  scripts, style sheets, iframes, beacons, EventSource, WebSocket, forms, or a redirect of any of those.
  Without the shell, three things did reach it: `window.open`, a top-level navigation, and WebRTC's STUN
  packets. Those are the shell's to stop.
- **Open: everything that needs the real webview.** The screen was locked, so the session window reported
  itself hidden and the pane never appeared. Still to run with the screen unlocked, in the
  `remote-preview` view:
  - The app loads in the pane.
  - The probe page reaches the probe server with nothing, including WebRTC, top-level navigation, and
    `window.open`.
  - `typeof RTCPeerConnection` is `undefined` in a proxied page.
  - A refused navigation shows its address with a copy button.
  - The pane's two blocked messages read correctly.

  Then remove this plan, and move its row in [the split programme](./README.md) and
  [future plans](../README.md) to their completed lists.

## Goal

The preview pane shows an app running on a remote Node, the same pane a local Node gets. The page
reaches only that app, through the Node. It can't reach the client's private network, and the proxy
can't reach anything on the Node's network except the app's loopback port.

## Starting point

- `remotePreviewBlocked` in `packages/client-core/src/infra/node/previewUrl.ts` turns the pane off for
  every Node that isn't local. `plugins/preview/src/client/PreviewTaskPane.tsx` is its only caller.
- The preview plugin's Node half resolves each task's home URL. A port setting resolves to
  `http://localhost:<port>`, which is the remote Node's own loopback.
- `apps/desktop/src-tauri/src/webviews.rs` gives `preview:<taskId>` views a policy that allows any
  HTTP or HTTPS URL. It has no rule for a page's own requests.
- The Node answers one WebSocket path, `/v1/events`. The hub in
  `packages/node-core/src/server/transport/wsHub.ts` destroys an upgrade to any other path. A plugin
  route is a fetch handler and can't take an upgrade.
- The broker in `packages/custody/src/broker/nodeBroker.ts` holds each Node's pinned agent, four
  sockets, and the device token. It buffers each response before the renderer gets it.

## The design

The request path has four stops: the child webview, a loopback listener in the helper, the Node over
pinned TLS, and the dev server on the Node's loopback.

**The Node.** Core gets a loopback proxy route kind for compiled plugins:
`ctx.routes.loopback({ prefix, target })`. `target(request, principal)` returns a port number or
`null`. Core owns every rule that makes the proxy safe, so a plugin supplies a port and nothing else:

- Refuse a task-scoped principal with 403. Only a paired device may use the route.
- Connect to `127.0.0.1`, then `::1`, at the port `target` returned. Never resolve a name. Refuse the
  Node's own listener port.
- Forward HTTP with streamed bodies both ways, and never follow a redirect. Rewrite a `Location` on
  the dev server's loopback origin to a path. Pass any other `Location` through unchanged.
- Take a WebSocket upgrade on the same path and pipe it byte for byte after the handshake.
- Strip `Authorization`, `x-acorn-internal`, and the helper's cookie. Set `Host` to
  `localhost:<port>`, and rewrite `Origin` and `Referer` from the helper's origin to the dev server's,
  so a server that checks them, such as Vite's socket, accepts the request.

The preview plugin registers it at `/tasks/:taskId/proxy`, so the Node serves
`/v1/p/preview/tasks/:taskId/proxy/*`. Its `target` reads `forTask` and returns the port only when the
resolved URL is `http` on `localhost`, `127.0.0.1`, or `[::1]`. A loaded plugin gets no `loopback`,
the same way it gets no `register`. The hub hands an upgrade on a registered loopback prefix to that
route instead of destroying it.

**The helper.** Two new helper methods, `preview-open { nodeId, taskId }` and `preview-close`, start
and stop one listener per preview on `127.0.0.1:0`. Each preview is its own origin, so one task's page
can't call another task's proxy. The listener:

- Answers only when `Host` is exactly `127.0.0.1:<port>`, which stops DNS rebinding.
- Requires an `HttpOnly`, `SameSite=Strict` cookie holding a per-preview secret. The first navigation,
  `/__acorn/preview?key=<secret>`, sets it and redirects to `/`. A tab in another browser, or another
  page, has no cookie and gets 403.
- Adds this CSP to every response, beside any CSP the app sends:
  `default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; connect-src 'self'; form-action 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'`.
  Dev servers inject inline scripts and evaluate modules, which is why the script sources are wide.
- Uses its own pinned `https.Agent` with six sockets, built from the broker's pinning for that Node.
  WebKit opens six connections to one origin, and a 300-module page sharing the broker's four sockets
  would hold up the app's own requests.
- Streams instead of buffering, so Server-Sent Events reach the page.

`preview-open` returns `{ origin, entry }`. The helper closes the listener when the preview is
evicted, the Node is forgotten or revoked, or the window closes.

**The shell.** A key family `remote-preview:<nodeId>:<taskId>` gets a confined policy: only the exact
origin of its home URL, and only when that host is `127.0.0.1`. It shares the preview family's one
visible view. Before the first navigation, `create` sets the `WKPreferences` key
`peerConnectionEnabled` to false through `with_webview`, as `footprint.rs` makes its native calls. If
the key is missing, `create` refuses the view, so a WebKit update fails closed. A refused navigation
emits `acorn:webview-blocked` for this family too.

**The client.** One function in `previewUrl.ts` replaces the yes-or-no rule. It returns a direct URL
for the local Node, a proxied preview for a remote Node whose URL is loopback HTTP on a host that can
proxy, or a blocked reason. The pane opens a proxied preview through a new `previewProxy` member of
the platform seam, then calls `ensure` with the entry URL. A blocked navigation shows its address with
a copy button. Keep `remotePreviewBlocked` and `previewUrlForClient` working until the next plugin API
major, as [forward compatibility](../../plugins/forward-compatibility.md) describes.

## Changes

1. Add the loopback route kind to node-core's plugin host and the hub, with tests for each rule in
   the design. Load the proxy behind a dynamic import, so it stays out of the boot graph that
   `check-service-budget.mjs` counts.
2. Register the preview plugin's `target`, and add the route to `routeRegistry.snapshot.json`.
3. Add `preview-open` and `preview-close` to the helper and the bridge, and `previewProxy` to the
   platform contract and its bridge test.
4. Add the `remote-preview:` family to `webviews.rs` with its policy, the WebRTC switch, and Rust
   tests for the key grammar and the confined policy.
5. Change `previewUrl.ts` and `PreviewTaskPane.tsx` to the three outcomes.
6. Update [host-owned webviews](../../shell/webviews.md), the
   [bridge and broker page](../../shell/bridge-and-broker.md), and the plugin route docs.

## Out of scope

- A remote preview URL that isn't loopback, such as a staging site on the Node's network. It stays
  blocked with a message.
- Windows and Linux. Their webviews weren't measured, so `previewProxy` is absent there and the pane
  shows the blocked message as before.
- The terminal client, which has no webview.
- HTTP/2 between the webview and the helper. WebKit offers no cleartext HTTP/2.

## Acceptance

Run every check on `pnpm dev:remote` and record the results, dated, in this file:

- A Vite React app on the container Node's loopback loads in the pane, and a save in the container
  reloads it without a page refresh.
- The spike's probe page, loaded through the real path, makes zero requests to a probe server on the
  client. That covers `fetch`, images, scripts, iframes, beacons, forms, every redirect, and WebRTC.
- A task token gets 403 from the proxy route, for HTTP and for an upgrade.
- A recipe URL set to the Node's own port, or to a non-loopback address, gets refused, and the pane
  says so.
- A request to the helper listener from a browser tab, or with a different `Host`, gets 403.
- Page load and hot reload times on the container Node, and on a real network path if one is
  available.

## Risks

- `peerConnectionEnabled` is a private WebKit key. The fail-closed check and a test that reads
  `typeof RTCPeerConnection` in a proxied page keep a removal visible.
- Load time grows with the round trip to the Node times the number of requests, divided by six. With 23 ms to the Node, the
  spike's 300-module page took 2.15 s. A slow link makes a large dev build slow, though it still works.
- A dev server that writes absolute URLs, or a fixed hot reload host, sends the page straight to the
  client's `localhost`. CSP refuses it, so that page breaks safely instead of leaking.
- An app that sets a cookie with `Domain=localhost` loses it, because the page's host is `127.0.0.1`.
- At commit eb5263c5c, `pnpm dev:remote` can't pack, because the Node's static graph is 3,961 bytes over
  its ceiling. Someone has to fix that before this phase's acceptance can run.
