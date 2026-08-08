# Remote access: web client, mobile, and a relay service

Design notes from the third-party-plugins session (2026-08-08). Nothing here is scheduled; this
records the analysis so a future project starts from conclusions instead of re-deriving them.
The three cheap preparation items at the bottom ARE worth doing early — they are annotated in
the `docs/third-party/` phase files.

## The shape of the demand

The signal from surveying herdr's plugin ecosystem: the most-wanted remote surface is not the
workspace — it is monitoring, approvals, notifications, and quick actions on a phone (collie,
herdr-remote, mobile-relay were three of the top 25 plugins). Mobile v1 is therefore a focused
subset shell — attention inbox, agent status, approve/respond, task list, start a task — not a
responsive port of the pane workspace. Making the pane workspace responsive would be a
permanent tax on every future pane; a deliberate subset is buildable and matches what people
actually do on phones.

## Web client: what changes and what doesn't

A web client is a browser talking to a Node directly. The Node already runs Electron-free
(docs/architecture-overview.md: a standalone Node uses the same service graph without
Electron-native capabilities). Three assumptions break:

### 1. Auth inverts (the big one)

On desktop the renderer never holds a token; Electron main brokers every request with pinned
HTTPS and a device bearer. A browser IS the client — it must hold a session. The Node needs real
web auth: httpOnly-cookie or bearer sessions, CSRF protection, rate limiting, lockout, session
revocation. A web session should be modeled as a **device row** — the existing device-token
model extends naturally, giving revocation UI ("this browser session") for free. The public
automation API work (docs/next/api: bearer tokens, registry, rate limits) is the down payment.

Token custody on web is strictly worse than Electron main custody, and no design fixes that
fully:

- Tokens for every connected node live in JS-reachable storage; one XSS in the shell is
  fleet-wide credential theft.
- Mitigations worth doing, with honest limits: encrypt tokens under a **non-extractable
  WebCrypto key** in IndexedDB (exfiltrated DB is ciphertext; in-page script can still decrypt);
  short-lived per-node tokens with refresh; strict shell CSP; and the third-party UI sandbox —
  sandboxed plugin frames have opaque origins and cannot touch shell storage, so plugin UI is
  NOT in the XSS trust zone. That sandbox decision pays off again here.

### 2. The Node serves the shell, and trust inverts with it

Today the Node "serves no web assets"; for web it serves the renderer bundle. This quietly
inverts the plugin trust model: on desktop the app comes from us and plugin bundles come from a
possibly-hostile node, so bytes-hash prompts are the consent surface. On web, the WHOLE app
comes from the node — trusting the node is the ballgame, and per-bundle prompts mostly protect
plugin-vs-plugin blast radius. When web becomes real, `docs/third-party/node-security.md` and
`phase-2-distribution-trust.md` need a section stating this inversion; the per-device trust
store also moves server-side (per-user acknowledgements on the node) because per-browser
localStorage acks are weak and evictable.

### 3. TLS and reachability

Browsers will not accept the self-signed pinned certs nodes mint today, and there is no
cert-pinning API. Each node needs browser-valid TLS — realistically **Tailscale Serve** (valid
certs + NAT/LAN reachability in one move) or a reverse proxy with real certs. Pinning is traded
for CA trust: a deliberate, acceptable downgrade to write down, not hide. Additional browser
constraints: every node must allow the shell's origin in CORS, and Chrome's Private Network
Access rules block public-origin → private-IP requests — another reason the shell should be
served from inside the same tailnet as the nodes. Pairing needs a browser flow (QR / short code
minting the web session) — `/v2/pair` is most of it; the service protocol is not reachable from
a browser.

## Multi-node from a browser: fan-out vs hub

Fan-out itself is just N fetch targets + N WebSockets; a browser does that fine. The per-node
query caches are already node-scoped, built for N from day one. Two architectures:

- **Browser-side fan-out** (recommended): the client platform adapter grows a `WebBroker` —
  endpoint records + tokens in IndexedDB, one WS per node, same node-scoped caches. Truest to
  the existing model: nodes stay independent peers, zero new server-side machinery. Costs: the
  token-custody downgrade above, per-node TLS/CORS setup, N sockets on a phone (fine for the
  foreground-brief mobile subset).
- **Hub node**: browser holds one session to one node, which proxies to its peers. One socket,
  one origin, one cert — but nodes currently have **no peer relationships at all** ("no shared
  database or cross-node transaction"), so a hub invents node-to-node pairing and proxying from
  scratch, and the hub sees all traffic. Bigger architectural change than web auth itself. Only
  revisit if fan-out's per-node setup proves to be the adoption blocker.

Sequencing either way: ship single-node web first; fan-out is additive because the adapter seam
and node-scoped caches already assume N.

## Mobile

The web client, responsive, PWA first. Home-screen install; iOS supports PWA push since 16.4.
Wrap in Capacitor only if app-store presence or push reliability forces it; a native rewrite is
not justified by the use case. Two mobile-specific facts that shape the design:

- **Background sockets die on phones.** Push notifications are the background channel, not an
  enhancement — which requires a node-side event→push seam (agent finished, needs input,
  attention item created). This is the same "event hooks" seam identified in the herdr analysis;
  it serves ntfy-style plugins AND mobile push.
- **Descriptors render on mobile for free.** Declarative chrome (sources, badges, attention
  items, palette rows) is form-factor-neutral by construction — the host renders it natively, so
  the mobile shell reuses the same contributions in a mobile layout. Third-party frame surfaces
  are desktop-shaped; the manifest's `formFactor` field (noted in phase-3) lets a plugin opt a
  surface into mobile explicitly rather than rendering an unusable desktop pane in a phone
  viewport.

## The relay service (acorn.dev or similar)

Web push and browser reachability both eventually want a rendezvous point that is not the user's
own network: something at a stable public URL that (a) relays push notifications to
web/mobile/native clients, (b) optionally tunnels browser↔node traffic when no tailnet exists,
and (c) could carry pairing handshakes ("enter this code on your node"). Notes:

- This is the first component in the architecture that is **ours, hosted, and chargeable** — a
  plausible commercial seam (free local/tailnet forever; pay for the relay), the same shape as
  herdr-remote's "free tunnel for remote" and Tailscale's funnel.
- Design it as **dumb pipes**: end-to-end encrypted frames between node and client, relay sees
  routing metadata only. This keeps the trust story clean (the relay is availability
  infrastructure, not a data processor), keeps self-hosting honest (the relay protocol should be
  runnable by anyone), and limits what a relay compromise yields.
- The node-side pieces it needs are the same ones mobile needs anyway: the event→push seam and
  outbound tunnel client. Nothing else in the architecture changes — nodes still own their data,
  clients still authenticate to nodes, the relay just moves bytes.
- Do not build any of this before a web client exists; it is meaningless without one.

## Preparation items (cheap now, expensive later)

These three are annotated in `docs/third-party/`; everything else in this file waits.

1. **Platform adapter seam in client-core.** Everything that touches `window.acorn` (apiClient's
   nodeFetch, stream attach, plugin cache access, trust prompts) goes behind one narrow
   interface with the Electron implementation as its only member. This is the load-bearing prep:
   retrofitting after more surface accretes is the expensive version. (Noted in phase-2 and
   phase-3.)
2. **`formFactor` on frame surfaces** in the plugin manifest, default `["desktop"]`. One field,
   added while the schema is young. Descriptors need nothing. (Noted in phase-3.)
3. **Keep the sandbox bridge scheme-agnostic.** The MessageChannel bridge and SDK must not
   hardcode `app-plugin://` — on web the same isolation is a sandboxed iframe with an opaque
   origin and CSP headers. (Noted in phase-3.)
