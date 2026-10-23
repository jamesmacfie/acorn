# Phase 6: Preview through the Node

Date: October 23, 2026. Status: built, with checkpoints 2 and 6 and the hosted service still to do. Depends on the
Node route in [split phase 10](../split/10-remote-preview-proxy.md).

## Completion note

October 23, 2026, on branch `phase-6-preview`.

What landed:

- **The names and the account routes.** `previewNodeLabel`, `parsePreviewName`, and `previewDomainHost` in
  `packages/protocol/src/transport/relay.ts`. `GET /account/v1/preview` and `PUT /account/v1/preview/challenge` in the
  protocol, the published schema, the stand-in (`setPreview`, `challenges`), and the conformance suite. The page is
  [previews in the account API](../../account-api/previews.md).
- **The relay's listener.** `ACORN_RELAY_PREVIEW_DOMAIN` starts a TCP listener that reads the server name from the
  ClientHello (`apps/relay/src/clientHello.ts`), asks the Node for a `preview` stream, and copies bytes. 32 open or
  waiting `preview` streams for one route, counted apart. A WebSocket client asking for `?kind=preview` gets `400`.
  [`apps/relay/PROTOCOL.md`](../../../apps/relay/PROTOCOL.md#preview-streams) has it.
- **The Node.** `ctx.routes.loopback` (compiled plugins only) with core's proxy
  (`server/proxy/loopbackProxy.ts`, `loopbackRoute.ts`). A Node with Remote access on and `ACORN_ACCOUNT_URL` set starts
  `transport/preview/`: an ACME client over `node:crypto` (`acme.ts`), the certificate and its renewal
  (`certificate.ts`), the grants (`grants.ts`), and the HTTPS server that answers on the preview names
  (`previewServer.ts`), all loaded on demand. The preview plugin registers `/tasks/:taskId/proxy`.
- **The phone's pane.** `preview-phone`, `formFactor: ['narrow']`, `requires: { plugin: 'preview' }`, loaded after the
  first frame (`plugins/preview/src/client/PreviewPhonePane.tsx`).
- **Test helpers.** `startFakeAcme` in the Node testkit is an ACME authority for one DNS-01 order. `pnpm dev:account` now
  also serves previews under `preview.localhost`.
- Docs: [the phone channel](../../relay/phone-channel.md#previews), [the relay](../../relay.md#previews),
  [the account API](../../account-api.md#previews), [the stand-in](../../account-api/testing.md),
  [serve previews](../../mobile/phone-setup.md#serve-previews), [plugin API](../../plugins/plugin-api.md#loopback-routes),
  [features](../../features.md#phone), and [the mobile web app](../../mobile.md).

Decisions and deviations:

- **The first open question: an iframe, a cookie, and a way out.** The pane draws an iframe. The grant is a `__Host-`
  cookie with `SameSite=None; Secure; HttpOnly; Partitioned`. A known name without the cookie gets a `403` page that posts
  `acorn-preview:cookie-blocked` to its parent, and the pane then offers the app as a page of its own. Playwright's WebKit
  doesn't block third-party cookies, so I simulated Safari by dropping the entry answer's `Set-Cookie`. Checkpoint 6
  confirms the real thing.
- **`frame-src` carries a security rule.** A page can set `location` to send its own frame anywhere, and `default-src`
  doesn't cover a navigation. The first Playwright run showed the frame landing on a probe server on the phone's
  network. The phone app's `frame-src`, which the browser checks again on each navigation of the frame, stopped it in both
  engines. It must name the preview domain and the sandbox domain only. The docs say so.
- **`target(params)`, not `target(request, principal)`.** The plugin supplies a port from the route's path parameters.
  Who may use it is core's rule, so a plugin has nothing to do with the principal.
- **No WebSocket upgrade on the authenticated route.** Split phase 10's desktop half is the consumer, and it isn't here.
  The phone's hot reload socket reaches the dev server through its own preview name. The route proxies HTTP for a paired
  device, and `__acorn/open` is part of it.
- **One proxy engine over `Request` and `Response`.** `proxyHttp` serves both the Hono route and the preview server
  (through `getRequestListener`). Only the upgrade is written against raw sockets.
- **The label is derived, not assigned.** Anyone with the Node ID computes it, so the relay needs no registry and the
  service sends no label. Self-hosted relays with a static credential have no account service, so no previews.
- **No ACME library.** About 150 lines over `node:crypto`, with `node-forge` building the CSR as it already builds the
  Node's own certificate. The certificate key is RSA 2048, because forge can't sign a CSR with an EC key.
- **Who owns the listener.** Core's transport, beside the phone channel. It reads `ACORN_ACCOUNT_URL` itself and applies
  the sign-in plugin's rule for that address (`accountServiceUrl`), because the relay credential goes to it.
- **A failed renewal.** The Node keeps serving the old certificate until it expires, retries after 1, 5, 15, and 60
  minutes, and from then on `__acorn/open` answers `503` with `details.reason: 'expired'` and a sentence the pane shows.
- **Found and fixed during the walk.** The phone never offered Preview, because the schedule that fills `previewConfigured`
  asked for the desktop's `preview` seam. It now asks for the plugin, so the terminal client polls `/configured` too,
  which it didn't before. And a certificate read back from disk lost the preview port.
- **`ctx.routes.loopback` loads on first use.** The route is a bare handler that imports core's code on its first
  request, because a static import took the Node service graph past its ceiling. `lazyRouter` can't do it: it mounts the
  loaded router at the concrete path, so the route's `:taskId` parameter is lost.

Found and left alone:

- `docPaths.test.ts` failed on a checkout where the phone hadn't been built, because two docs cited the
  path of the generated `first-party-bundles.json`. The coordinator fixed the docs when it merged the programme.

What later work needs to know:

- The Node service graph is 1,938,324 B of 1,939,000 B, 676 B of room.
- A dev build is hundreds of requests over six connections, because the preview server speaks HTTP/1.1. HTTP/2 would
  multiplex them over one relay stream. [Remote access phase 5](../remote-access/05-production.md) owns limits and metering.
- The desktop's view of a remote Node's preview (split phase 10) can use `proxyHttp`, `proxyUpgrade`, and
  `ctx.routes.loopback` as they are, and needs the authenticated route to take an upgrade.
- A same-site preview domain embeds in Safari, and gives the page the app's cookies. This phase doesn't recommend it.

## Design

Written October 23, 2026, before any code.

### The first open question: cookies in a frame on iOS

**Answer: draw the iframe, carry the grant in a cookie, and detect the failure.** Safari blocks cookies
that a frame from another site sets or reads, and the preview's name is on another site from the phone
app's. The three options in the open question, as built:

- **A full-screen page first.** It works everywhere, because the cookie is first-party. It also gives
  up the pane, and the programme promised an app that loads in the pane.
- **The Storage Access API.** Safari grants it only to a site the person has already used as a top-level
  page, and every preview is a new name. The prompt can't be reached.
- **A grant that isn't a cookie.** The name alone can't be the grant: the relay sees it, and so does
  anyone who watches the network, because a server name travels in the clear. The secret has to ride
  inside the encrypted connection, in a cookie or in every URL. A secret in every URL breaks any app that
  writes `/src/main.ts`.

So the Node sets a `__Host-` cookie with `SameSite=None; Secure; HttpOnly; Partitioned`. Chrome and Android
Chrome keep it in a frame. Safari drops it. When a request for a known preview name arrives with no valid
cookie, the Node answers `403` with a small page that tells its parent `acorn-preview:cookie-blocked`.
The pane turns that into one line of text and a link that opens the preview as its own page, where the
cookie is first-party. The two paths need no sniffing of the browser, and neither fails to load.

**Checkpoint 6 must confirm,** on a real iPhone and a real Android phone: that Safari takes the
blocked path and the page works as its own tab, hot reload included; that Android Chrome stays in the
frame; and whether an iPhone embeds when the preview domain shares a registrable domain with the phone
app. That last case is a hosting choice. It makes the frame same-site, and it also lets the page send
requests to the app's origin with the app's cookies, so this phase doesn't recommend it.

### Names

`<preview>.<node>.<preview domain>`, for example `3f9c…e1.a91b…07.preview.example`.

- `<node>` is the first 32 hex characters of `SHA-256("acorn-preview-node:" + <Node ID>)`. Anyone
  holding the Node ID can compute it, and nobody can get the Node ID back. The account service, the
  relay, and the Node each compute it, so none of them has to tell another. `previewNodeLabel` in
  `@acorn/protocol/relay.ts` is the one definition.
- `<preview>` is 32 random hex characters for each open preview.
- The preview domain is a name and an optional port, as the sandbox domain is. The port is for a dev
  flow. The certificate and the relay's matching use the name alone.

### The account API, by addition

| Route | Authentication | What it does |
| --- | --- | --- |
| `GET /account/v1/preview` | None | `{ domain, acmeDirectory }`: the preview domain, and the ACME directory its DNS zone allows. `404 not_found` when the service has no preview domain. |
| `PUT /account/v1/preview/challenge` | The Node's relay credential | Takes `{ value }`, 43 base64url characters, and publishes it as the TXT record `_acme-challenge.<node>.<domain>`, replacing the last one. It answers `204` once the record is being served. |

The service takes the Node from the credential, so a Node can set one name only: its own. A revoked or
unknown credential is `401 invalid_token`. Both bodies are in `packages/protocol/src/device/account.ts`.

### The relay's listener

`ACORN_RELAY_PREVIEW_DOMAIN` (and `ACORN_RELAY_PREVIEW_PORT`, default 443) turn on a plain TCP listener. It
buffers the first TLS record, reads the server name from the ClientHello, and strips `.<domain>`. What is
left must be two labels. The second names a connected route by `previewNodeLabel`. The relay asks that
Node for a stream of kind `preview`, writes the buffered bytes to it first, and then copies both ways.
It never answers TLS, holds no certificate, and reads nothing past the ClientHello. An unknown name, a
name that isn't two labels under the domain, a connection that isn't TLS, and ten seconds of silence all
close the socket.

Preview streams count apart from the others, at most 32 open or waiting for each route, because anyone
who knows a name can open one. Without that, a stranger could use up the 256 that a phone's channel
needs.

### The Node's listener

Core starts it when the tunnel starts and `ACORN_ACCOUNT_URL` is set, and loads it on demand.

1. **The certificate** (`transport/preview/certificate.ts`, `acme.ts`). The Node asks the account service
   for the domain, orders `*.<node>.<domain>` from the directory it named, answers the DNS-01 challenge
   through `PUT /preview/challenge`, finalizes with a CSR, and keeps the key and chain in
   `<root>/previews/`. The key never leaves the Node. A timer checks every 12 hours and renews when a
   third of the lifetime is left. `acme.ts` is about 200 lines over `node:crypto`, with `node-forge`
   building the CSR as it already builds the Node's own certificate. No library is added.
2. **The server** (`previewServer.ts`). An HTTPS server that takes a `preview` stream by
   `emit('connection')`, with the certificate. It is a separate server from the API's, so nothing on
   these names reaches the API. A request's `Host` must be `<preview>.<node>.<domain>`.
3. **The grant** (`grants.ts`). In memory: a one-time entry key (60 seconds), a cookie secret, the paired
   device that opened it, the task's port lookup, and an optional frame ancestor. At most 8 at a time,
   12 hours each. Revoking the device ends its grants.

### Who may load it

The phone opens a preview as a paired device:

```text
POST /v1/p/preview/tasks/:taskId/proxy/__acorn/open
{ "ancestor": "https://app.example" }        // optional; the page that will frame it
→ 200 { "url": "https://<preview>.<node>.<domain>/__acorn/preview?key=<key>" }
→ 403 forbidden           a task's token, or anything that isn't a paired device
→ 404 no_preview          the task has no preview address on the Node's loopback
→ 503 preview_unavailable { "reason": "off" | "unsupported" | "starting" | "expired" }
```

`off` is no Remote access. `unsupported` is a service with no preview domain. `starting` is a Node that
hasn't got its first certificate yet. `expired` is a certificate that ran out and couldn't be renewed.
The pane says which, in words.

The first request, `GET /__acorn/preview?key=…`, spends the key, sets the cookie, and answers `302 /`. A
wrong or spent key is `403`. Every other request needs the cookie. Without it, a known name gets the
`cookie-blocked` page and an unknown name gets a bare `403`.

### What the page may do

Every response adds the content security policy from split phase 10, with the frame rule changed:

```text
default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; connect-src 'self'; form-action 'self';
base-uri 'self'; object-src 'none'; frame-ancestors <ancestor, or 'none'>
```

The proxy is core's (`server/proxy/loopbackProxy.ts`), and a plugin supplies only a port. It connects to
`127.0.0.1`, then `::1`, never resolves a name, and refuses the Node's own port. It follows no
redirect, and rewrites a `Location` on the dev server's origin into a path. It strips `Authorization`,
`x-acorn-internal`, and the grant cookie, sets `Host` to `localhost:<port>`, and rewrites `Origin` and
`Referer` to the dev server's. It streams both ways. It takes a WebSocket upgrade only when the `Origin`
is the preview's own, so another site can't open the page's hot reload socket with the cookie. It drops
`X-Frame-Options`, which would otherwise break the frame the policy now governs.

### The Node route

`ctx.routes.loopback({ prefix, target })` is compiled plugins only. `target(params)` returns a port or
`null`. Core mounts `/v1/p/<plugin><prefix>/*`: the `__acorn/open` route above, and every other path
proxied for a paired device, as split phase 10 designs. A deviation from that doc: `target` takes the
route's path parameters and no request or principal, because the proxy's rules, not the plugin, decide
who may use it. Taking a WebSocket upgrade on the authenticated route belongs to split phase 10's desktop
half, which has a consumer. The phone's upgrades arrive through the preview server.

### The phone's pane

`preview-phone`, with `formFactor: ['narrow']` and `requires: { plugin: 'preview' }`, loaded after the
first frame. It opens a preview, draws `<iframe src=url>`, and listens for the one message above from
that frame's window and origin. The phone app's `frame-src` gains `https://*.<preview domain>`.

### Documents that change

`apps/relay/PROTOCOL.md`, [the phone channel](../../relay/phone-channel.md), [the account API](../../account-api.md)
and its schema file, [the account stand-in](../../account-api/testing.md), [serve the sandbox
domain](../../mobile/phone-setup.md#serve-the-sandbox-domain), and [features](../../features.md#phone).

## Goal

The phone's Preview pane shows a task's running app in an iframe. The page comes from the Node's
loopback through the Node, over TLS that the Node ends, and the relay forwards bytes it can't read.

## What you can deploy at the end

- **The Node:** a preview listener with a publicly trusted certificate for its preview names, in
  front of split phase 10's proxy route.
- **The relay:** a TLS listener that routes by the name a browser asks for, through Server Name
  Indication (SNI), and passes the bytes to the Node as a `preview` stream.
- **Hosted service:** DNS for the preview domain, pointed at the relay, and an account API route that
  publishes a Node's DNS challenge.
- **The phone:** a Preview pane that draws an iframe.

## Starting point

- On the desktop, Preview is a native web view at the dev server's address, with
  `requires: { seam: 'preview' }` and `formFactor: ['desktop']`
  (`plugins/preview/src/client/paneContribution.ts`). The pane is off for every Node that isn't local
  (`remotePreviewBlocked` in `packages/client-core/src/infra/node/previewUrl.ts`).
- The preview plugin's Node half resolves each task's address
  (`plugins/preview/src/server/previewUrls.ts`). A port resolves to `http://localhost:<port>`.
- Split phase 10 designs `ctx.routes.loopback`, a core route kind that proxies HTTP and WebSocket
  upgrades to a loopback port under fixed rules. The preview plugin registers it at
  `/v1/p/preview/tasks/:taskId/proxy/*`. The same phase designs the desktop helper's listener for each
  preview. Neither is built.
- The relay speaks WebSocket only. Its stream kinds are `tls` and `browser`, and a Node refuses a kind
  it doesn't serve (`apps/relay/PROTOCOL.md`).
- A browser can't load a page from bytes on the phone channel, by design: a page on the app's address
  would run with the phone's session ([trust](../../relay/phone-channel.md#trust)).

## The design to write

Write this out in full before any code. The outline:

1. **Names.** Each Node gets an opaque label, and each open preview a random one:
   `<preview>.<node>.<preview domain>`. Neither is a task ID, because the relay sees the name, and
   certificate transparency logs publish the Node's.
2. **The certificate.** The Node asks an ACME certificate authority for a wildcard certificate for
   `*.<node>.<preview domain>`, with a DNS-01 challenge. It asks the account service, as the Node, to
   publish the challenge's TXT record. The private key stays on the Node, and the Node renews the
   certificate before it expires.
3. **The relay.** A TLS listener on the preview domain reads the server name from the client's first
   message, finds that Node's tunnel, and opens a `preview` stream with the raw bytes. It never ends
   TLS.
4. **The Node.** It ends TLS on a `preview` stream with the preview certificate, maps the preview
   label to a task, and hands the request to split phase 10's proxy rules. Nothing else answers on
   these names, the Node's API included.
5. **Who may load it.** The phone opens a preview over the channel, as a paired device. The Node
   answers with a one-time entry address. The first request trades it for a cookie on that preview's
   name only, as phase 10's helper listener does on loopback.
6. **The page's limits.** Every response carries phase 10's content security policy, so the page
   reaches only its own origin and can't reach the phone's network.
7. **The phone's pane.** A phone-only Preview pane, with `formFactor: ['mobile']` and
   `requires: { plugin: 'preview' }`, draws an iframe at the entry address. The phone app's
   `frame-src` gains the preview domain.

## In scope

- Split phase 10's Node route, if it hasn't shipped. Its desktop half isn't needed here.
- The account API route for the DNS challenge, with the stand-in and the conformance suite.
- The relay's preview listener and the `preview` stream kind, as an addition to protocol version 1.
- The Node's preview listener, certificate, renewal, and preview grants.
- The phone's Preview pane.

## Out of scope

- The desktop's view of a remote Node's preview. Split phase 10 builds it over the pinned connection
  the desktop already has, with no certificate.
- A preview address that isn't on the Node's loopback, as in split phase 10.

## Steps and checkpoints

### 1. Write the design

Answer the first open question, then write the design above in full: routes, message shapes, the
stream kind, header policies, and the names.

### 2. The Node route

Build split phase 10's loopback route, or confirm that it shipped.

### 3. Hosted service: the preview domain and the challenge route

Point the preview domain's wildcard DNS at the relay. Add the challenge route to the account API, the
stand-in, and the conformance suite ([test an account service](../../account-api/testing.md)).

### 4. The relay's preview listener

**Checkpoint 1: the relay reads nothing.** Capture traffic on the relay during a preview load. It
should hold TLS records only, with no readable HTTP.

### 5. The Node's listener and certificate

**Checkpoint 2: a trusted certificate.** Against a staging certificate authority, the Node gets and
renews a certificate for its preview names, and a browser accepts it.

### 6. The phone's pane

**Checkpoint 3: an app loads and reloads.** In Playwright WebKit at 390 by 844, a Vite app on the
Node's loopback loads in the pane, and a save on the Node reloads it without a page refresh.

**Checkpoint 4: no way in without a grant.** A request from another browser, with no cookie, gets 403.
A task token gets 403 when it asks for a preview.

**Checkpoint 5: no reach into the phone's network.** A probe page loaded through the preview makes no
request to a probe server on the phone's network.

**Checkpoint 6: real phones.** On an iPhone and an Android phone, repeat checkpoints 3 and 5.

## Acceptance

- A task's app loads and hot-reloads in the phone's Preview pane on both phones.
- The relay sees only TLS records.
- A preview opens only through a paired device's grant.
- The page reaches only its own origin.

## Docs to update when it ships

- `apps/relay/PROTOCOL.md`: the `preview` stream kind and the listener.
- [The phone channel](../../relay/phone-channel.md): opening a preview.
- The account API: the challenge route.
- [Features](../../features.md#phone): Preview on a phone.

## Open questions

- **Cookies in an iframe on iOS.** Safari blocks third-party cookies by default, and the preview's
  name is on a different site from the phone app's. A cookie set inside the iframe may not stick. The
  options are opening the preview as a full-screen page, where the cookie is first-party, asking for
  storage access with the Storage Access API on a tap, or carrying the grant another way. Answer this
  first, because it decides the pane's shape.
- **The ACME client.** Which library, and what it adds to the Node's service graph
  ([the node service budget](../../frontend/startup-budget.md#the-node-service)). Load it only on a
  Node with **Remote access** on.
- **Who owns the listener.** Core's transport, beside the phone channel, or the preview plugin's Node
  half. Split phase 10 puts the proxy rules in core.
- **A failed renewal.** What the pane says when the certificate expired and couldn't be renewed.
- **Traffic.** A dev build can be hundreds of requests, far more than API traffic.
  [Remote access phase 5](../remote-access/05-production.md) owns limits and metering.
- **What the relay learns.** It sees the Node's label, a random preview label, and when.

## Evidence

October 23, 2026, on macOS arm64, with `pnpm dev:account`, `pnpm dev:mobile`, a standalone Node, and a Vite app on the
Node's loopback. Browsers were Playwright's Chromium and WebKit at 390 by 844.

- **Checkpoint 1, the relay reads nothing: passed in a test.** `apps/relay/src/previewEndToEnd.test.ts` puts a recording
  proxy between a browser and the relay's listener, through a real Node, a relay, and the stand-in. The first bytes are a
  TLS handshake record, and no path, header, cookie name, or body of the page appears in the capture.
- **Checkpoint 2, a trusted certificate: skipped against a staging authority.** It needs a name in a DNS zone that the
  hosted service answers. Against the stand-in authority, the Node orders, saves, reloads, and renews (a third of its life
  left), keeps serving a certificate it can't renew until it expires, and a client that trusts only that authority accepts
  it for a wildcard name (`certificate.test.ts`, `previewEndToEnd.test.ts`).
- **Checkpoint 3, an app loads and reloads: passed in WebKit and Chromium.** The Vite app loaded in the pane. A save to a
  module with `import.meta.hot.accept()` changed the text, and a marker set on `window` before the save was still there
  after it, so the page wasn't refreshed.
- **Checkpoint 4, no way in without a grant: passed.** On the live path, a request with no cookie, or a wrong one, got `403`,
  the entry address worked once and then got `403`, and a request with no credential for `__acorn/open` got `401`. A task
  token's `403` is proved in `loopbackRoute.test.ts`, not with a live agent.
- **Checkpoint 5, no reach into the phone's network: passed.** A probe page tried `fetch`, `XMLHttpRequest`, an image, a
  script, a stylesheet, a font, a WebSocket, a beacon, a frame, a form, `window.open`, `top.location`, WebRTC, `<base>`, and
  `location.href` against a probe server on the same computer. The server saw nothing in either engine (a request made by
  hand afterward showed it was listening). Without the app's `frame-src` the page's `location.href` did reach it.
- **The cookie fallback in WebKit: passed.** With the entry answer's cookie dropped, the pane showed **This browser blocks
  the preview in a frame**, and **Open preview** opened the app as a page of its own.
- **Checkpoint 6, real phones: skipped.** It needs an iPhone and an Android phone. It must confirm that Safari takes the
  fallback and the app works as its own page with hot reload, that Android Chrome stays in the frame, that Safari applies
  the app's `frame-src` to a frame's own navigation, and that the Partitioned cookie holds in Chrome.
- **The hosted service: skipped.** The wildcard DNS record, the account service's two routes, and a real authority are in
  another repository. The stand-in and the conformance suite are what this repository can check.
- **Budgets.** The Node service graph is 1,938,324 B of 1,939,000 B. The phone's first screen is 512,078 B of scripts of
  520,000 B and 127,076 B of styles of 128,000 B.
- **The full suite:** `pnpm test` ran, and every suite passes, with `pnpm lint` and the unused-export check clean. One
  run showed a timer test in the agents plugin and the packed-SDK builds failing under load, and both pass alone.

## Verify before building

Check whether split phase 10 shipped, and recheck the relay's stream kinds in `apps/relay/PROTOCOL.md`.
