# Phase 2: an origin for plugin code on the phone

Date: October 23, 2026. Status: proposed. Depends on nothing.

## Goal

Run a plugin's tree bundle on the phone in a worker on an origin of its own, with no network, as the
desktop runs it on `app-plugin://<hash>`. Prove it on a real iPhone with a test bundle before
custody depends on it.

## What you can deploy at the end

- **Hosted service:** a sandbox domain, separate from the phone app's domain, with a wildcard DNS
  record, a wildcard certificate, and a static host that serves the relay pages with fixed header
  policies.
- **Open side:** the relay page and its script, built from this repository, and a phone build that
  starts a tree worker through them. A development flag loads a test bundle without custody.

## Starting point

- `packages/client-core/src/host/tree/isolatedWorker.ts` embeds a hidden iframe at
  `pluginTreeRelayUrl(hash, nonce)`, checks its origin and a nonce, and transfers two ports.
  `pluginTreeRelayOrigin` maps the renderer's origin to the relay's and throws on an origin it doesn't
  know.
- `packages/client-core/src/host/tree/workerHost.ts` spawns through `createIsolatedTreeWorker`, with
  `_setWorkerFactory` for tests.
- On the desktop, `apps/desktop/src-tauri/src/plugin_scheme.rs` serves `/worker.html` and
  `/worker-host.js` under `default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'none'`,
  and `/client.js` from the content-addressed cache. `apps/desktop/src-tauri/src/plugin_worker_relay.js`
  creates the worker from `/client.js`.
- [The plugin worker](../../shell/origins.md#the-plugin-worker) records that a 64-character hash host
  hasn't been checked in WebView2.
- The phone app is served under `/app/` with `script-src 'self'; object-src 'none'; base-uri 'none';
  frame-ancestors 'none'; form-action 'self'`
  ([serve it yourself](../../mobile/phone-setup.md#serve-it-yourself)). It sets no `frame-src` and no
  `worker-src`.

## The design to confirm

- **One origin per bundle.** The host label is the bundle's SHA-256 in lowercase base32 with no
  padding, 52 characters. A 64-character hex hash breaks the 63-character limit on a DNS label. The
  relay page decodes its own label back to the hash.
- **A separate registrable domain.** A subdomain of the phone app's domain is the same site, so a
  cookie set with `Domain` on the app's domain would reach it. A separate domain keeps the sandbox on
  another site.
- **The page receives the bytes.** The sandbox host holds no bundles, because they come from the Node
  over the phone's encrypted channel. The phone app posts the bytes to the relay page with the start
  message. The relay page hashes them with `crypto.subtle.digest`, refuses them when they don't match
  its own label, and starts a module worker from a `blob:` URL. The sandbox checks its own bytes, so a
  mistake in the phone's custody can't run the wrong code under a hash's name.
- **Header policies.** The relay page and its script get `default-src 'none'; script-src 'self';
  worker-src blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none';
  form-action 'none'`. A worker from a `blob:` URL takes its creator's policy, so the bundle has
  `connect-src 'none'` too. Checkpoint 2 proves that on WebKit.
- **The phone app's policy** gains `frame-src` for the sandbox domain and nothing else.
- **How the phone learns the domain.** A build-time setting beside the `/app/` base, so a self-hoster
  builds with their own. The default is the hosted sandbox domain.
- **Client-core.** `pluginTreeRelayOrigin` and `pluginTreeRelayUrl` learn the phone's case. The
  handshake in `isolatedWorker.ts` carries the bytes, sent only to the exact relay origin after its
  ready message.

## In scope

- The relay page and script as static files in this repository, built with the phone app into a
  folder of their own for the sandbox host.
- The client-core changes above, with tests beside the ones for `isolatedWorker.ts`.
- A development path that loads a fixture bundle with no custody, refused in a production build.
- **Hosted service:** the domain, DNS, certificate, static host, header policies, and the phone app's
  `frame-src`.
- Self-host instructions.

## Out of scope

Custody, trust, and real plugins, which are phase 3. Frame documents, which are phase 5.

## Steps and checkpoints

### 1. Write the design

Fill in the design above with the exact message shapes, file paths, and the build setting's name.

### 2. Spike it locally

Serve the relay folder from a second local origin with the header policies, and load a fixture tree
bundle from `pnpm dev:mobile`.

**Checkpoint 1: the tree draws.** In Playwright WebKit and Chromium at 390 by 844, a fixture pane
draws its tree.

**Checkpoint 2: no network from the worker.** The fixture calls `fetch`, opens a `WebSocket`, and
imports a module from another origin. Each should fail, and a probe server should see no request.

**Checkpoint 3: tampered bytes are refused.** Post bytes whose hash doesn't match the label. The relay
page should refuse to start them, and the pane should show its failure placeholder.

**Checkpoint 4: no reach into the app's storage.** The fixture lists its IndexedDB databases. It
should see none of the phone app's.

### 3. Hosted service: the sandbox domain

Register the domain. Add the wildcard DNS record and certificate. Serve the built relay folder on
every name under the domain, with the header policies on every response. Add `frame-src` for the
domain to the phone app's policy.

### 4. Real phones

**Checkpoint 5: iOS and Android.** On an iPhone, in Safari and installed to the home screen, and on an
Android phone, repeat checkpoints 1 to 3 against the hosted sandbox. Record the iOS and Android
versions.

## Acceptance

- A tree bundle draws from its own origin on both phones.
- The worker has no network, and a probe server sees nothing.
- A tampered bundle doesn't run.
- The phone's first screen stays under its ceiling.

## Docs to update when it ships

- [The plugin frame origin](../../shell/origins.md#the-plugin-frame-origin): the phone's origin
  beside the desktop's.
- [The client sandbox](../../security/plugin-client-sandbox.md): the browser's container.
- [Serve it yourself](../../mobile/phone-setup.md#serve-it-yourself): what a self-hoster serves on the
  sandbox domain.

## Open questions

- Does iOS Safari apply the relay page's `connect-src 'none'` inside a `blob:` worker? If it doesn't,
  the fallback is a service worker on each sandbox origin that serves `/client.js` from the posted
  bytes, so the worker loads from `'self'` as it does on the desktop.
- Does an app installed to the home screen on iOS treat a cross-site iframe differently from Safari?
- The domain's name. A working name is enough to build.

## Evidence

None yet.

## Verify before building

Recheck `isolatedWorker.ts`, the desktop's relay script, and the phone app's header policy against
your checkout.
