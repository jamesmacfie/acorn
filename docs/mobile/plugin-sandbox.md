# The phone's plugin sandbox

This page covers where a plugin bundle runs in the [mobile web app](../mobile.md) and what the pages there
check. Read it before you change the relay page, the frame page, the build setting that names the sandbox
domain, or the handshakes in `packages/client-core/src/host/tree/isolatedWorker.ts` and
`packages/client-core/src/host/frames/phoneFrame.ts`. The desktop's versions are [the plugin
worker](../shell/origins.md#the-plugin-worker) and [the plugin frame
origin](../shell/origins.md#the-plugin-frame-origin).

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

## Frames

A plugin that paints its own iframe runs on the same name as its tree would, `https://<label>.<domain>`, so a
bundle has one origin however it draws. Four files on the sandbox host serve it:

- `/frame.html` is the frame page. It is the desktop's generated document with this page's scripts, and its
  `#<nonce>` fragment is the nonce the renderer chose.
- `/frame-host.js` is the page's script. `/bundle-check.js` holds the check it shares with the relay page, which
  hashes the bytes with `crypto.subtle.digest` and refuses them unless the base32 of the hash is the page's own
  label.
- `/ui.css` is the frame stylesheet. The build writes it from `FRAME_STYLES`
  (`packages/client-core/src/infra/styles/frameStyles.mts`), the same list the desktop stages, so a frame looks
  the same on both.

The page's policy is the desktop frame's, `default-src 'none'; script-src 'self' blob:; style-src 'self'
'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src 'none'; worker-src 'none'`,
and the rest. `blob:` is the one addition, because the page imports the checked bytes from a `blob:` URL. The
frame has no network, and `/ui.css` has no `url()` that isn't a `data:` URI, so `img-src data:` is enough for the
frame's icons. It's the one response with this policy. Every other path carries the relay policy.

The wire has four messages, all with the nonce, and a start that has two steps because the bundle has to be
listening before the host hands it the bridge. On the desktop `load` is that moment.

1. The page posts `{ kind: 'acorn:frame-ready', nonce }` to its parent.
2. The renderer asks its bundle source for the bytes and answers `{ kind: 'acorn:frame-bundle', nonce, bundle }`,
   to the exact frame origin.
3. The page checks the bytes, imports them, and posts `acorn:frame-loaded` once the module has run. Its `connect()`
   is listening by then. It posts `acorn:frame-error` when the check or the import fails.
4. On `acorn:frame-loaded` the renderer does what `load` does on the desktop: it transfers the `MessagePort` and
   starts the 10-second hello deadline.

`PluginFrame` shows the "This plugin's UI failed to start" placeholder on `acorn:frame-error`, on a start that takes
longer than 10 seconds, and when the device has no source for the bytes. As for the relay page, the page doesn't
check its parent's origin. The bytes are public code under their own hash, and a stranger who frames the page gets
only that.

An overlay frame is drawn in the shell's `overlay` slot, as on the desktop, as a full-screen sheet. The slot holds
the desktop's dialogs and shortcuts too, so on a phone `SlotHost` draws only a contribution marked `onPhone`, and the
overlay is the only one that is. A tree that asks for a companion overlay the device doesn't draw, because the
manifest's `formFactor` leaves out `mobile`, gets `unsupported_host`.
