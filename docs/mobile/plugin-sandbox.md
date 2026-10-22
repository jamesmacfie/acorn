# The phone's plugin sandbox

This page covers where a tree bundle runs in the [mobile web app](../mobile.md) and what the page there checks.
Read it before you change the relay page, the build setting that names the sandbox domain, or the handshake in
`packages/client-core/src/host/tree/isolatedWorker.ts`. The desktop's version is [the plugin
worker](../shell/origins.md#the-plugin-worker).

A browser has no custom schemes, so the phone app runs a tree bundle on a name under a sandbox domain
of its own. The domain is a separate registrable domain from the phone app's, because a subdomain of
the app's domain is the same site, and a cookie set with `Domain` on the app's domain would reach it.
The phone build names the domain in `ACORN_SANDBOX_DOMAIN`
([serve the sandbox domain](./phone-setup.md#serve-the-sandbox-domain)).

- **One origin per bundle.** The host label is the bundle's SHA-256 as lowercase base32 with no
  padding, 52 characters, because the 64 hex characters break the 63-character limit on a DNS label.
  `pluginTreeRelayOrigin` builds `https://<label>.<domain>`, and `http://` only for a name on
  `localhost`.
- **The sandbox holds no bundles.** The phone app posts the bytes to the relay page in the start
  message, after the page's ready message and only to the exact relay origin. The page hashes them with
  `crypto.subtle.digest`, refuses them unless the base32 of the hash is its own label, and starts a
  module Worker from a `blob:` URL. A mistake in the phone's custody can't run the wrong code under a
  hash's name.
- **Policy.** The page and its script carry `default-src 'none'; script-src 'self'; worker-src blob:;
  connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`. A
  Worker from a `blob:` URL takes its creator's policy, so the bundle has no network either, and
  `script-src 'self'` refuses a module it imports from another origin. WebKit and Chromium on a desktop
  both apply it, and a control that drops the header lets the worker reach a server
  ([try the sandbox](./phone-setup.md#try-the-sandbox)).
- **The page doesn't check its parent's origin.** It can't know the phone app's origin, which a
  self-hoster chooses. It checks that the message comes from its parent window and carries the nonce
  that the parent put in the URL, the bridge version, two ports, and the bytes. The bundle is public
  code under its own hash, so a stranger who frames the page gets nothing the hash doesn't allow.
- **The wire.** The relay posts `{ kind: 'acorn:tree-relay-ready', nonce }` and
  `{ kind: 'acorn:tree-relay-error', nonce }` to its parent. The renderer answers `{ kind:
  'acorn:tree-relay-start', nonce, hello, bundle }` with the bridge and tree ports. The desktop's start
  message has no `bundle`.

On Windows and Android, Wry maps a custom scheme to HTTP by rewriting `<scheme>://<host>` to
`http://<scheme>.<host>`. The renderer serves from `app://localhost` there, so the page is
`http://app.localhost`, a secure context. Opening `app://acorn` would load `http://app.acorn`, which the
navigation guard refuses, leaving a blank window. Plugin frames map to `http://app-plugin.<hash>`. The
handshake accepts those exact origins. A
64-character hash host hasn't been checked in WebView2, and if it's rejected, the tree fails closed.
