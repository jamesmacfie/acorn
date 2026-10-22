# Phase 2: an origin for plugin code on the phone

Date: October 23, 2026. Status: built on the open side. Hosted steps and the real-device checkpoint skipped. Depends on nothing.

## Completion note

October 23, 2026, on branch `phase-2-sandbox-origin`.

What landed:

- `apps/mobile/sandbox/` holds the relay page, `worker.html`, its script, `worker-host.js`, and
  `headers.mts`, the one list of response headers. `pnpm --filter @acorn/mobile build` now also runs
  `apps/mobile/scripts/build-sandbox.mjs`, which writes `apps/mobile/dist-sandbox/` with the two files and a
  `headers.json` for the host that serves it.
- `packages/client-core/src/host/tree/isolatedWorker.ts` learned the phone. `pluginTreeRelayOrigin` and
  `pluginTreeRelayUrl` return `https://<label>.<domain>` when the build names a sandbox domain and the
  renderer isn't one of the desktop's. `bundleLabel.ts` makes the label. After the relay's ready message
  the renderer asks a bundle source for the bytes and posts them with the ports, only to the exact
  relay origin. With no source, or a source that fails, the sandbox fails closed.
- `setTreeBundleSource` is the seam phase 3's custody fills. Nothing in a production build sets it.
- The build setting is `ACORN_SANDBOX_DOMAIN`, read by `apps/mobile/vite.config.ts` into the define
  `__ACORN_SANDBOX_DOMAIN__`. It's a name and an optional port with no scheme.
- The development path: `pnpm dev:mobile` also serves the sandbox on `localhost:4322`
  (`ACORN_SANDBOX_PORT`), builds a probe bundle from `apps/mobile/dev/sandboxProbe.ts`, and serves it. The
  page `/app/dev/sandbox` (`src/client/devSandbox.tsx`) posts it with no custody. `main.tsx` loads that
  page behind `import.meta.env.DEV`, so a production build has neither the page nor the probe.
- Docs: [the phone's plugin sandbox](../../mobile/plugin-sandbox.md), the pointer in [the plugin
  worker](../../shell/origins.md#the-phones-plugin-worker), [the client
  sandbox](../../security/plugin-client-sandbox.md), and [serve the sandbox
  domain](../../mobile/phone-setup.md#serve-the-sandbox-domain).

Decisions and deviations:

- **No default domain.** The design said the default is the hosted sandbox domain. The repository
  names no hosted domain, and a default that doesn't exist yet would send every phone build to a
  name nobody owns. Unset, the phone draws no tree bundle. The hosted step adds the default, or the
  release build sets the variable.
- **A page, not a pane.** The fixture draws on `/app/dev/sandbox`, outside the router that needs a signed-in
  account and a paired Node. That keeps checkpoints 1 to 4 runnable on one machine. The page mounts
  the same `RemoteTree` a pane would.
- **The relay doesn't check its parent's origin.** The desktop's relay compares it with the renderer's
  origin, derived from its own. A sandbox domain can't know the phone app's origin, which a self-hoster
  picks. It checks the parent window, the nonce, the bridge version, the port count, and the bytes. The
  bytes are public code under their own hash, so a stranger who frames the page gains nothing.
- **The relay compares encoded hashes.** It encodes the hash of the posted bytes and compares that with its
  label, instead of decoding the label. Only the canonical spelling of a hash passes: a label whose
  unused trailing bits aren't zero names the same 256 bits and is refused.
- **Two base32 encoders.** `bundleLabel.ts` and `worker-host.js` each carry one, because the page is a
  plain script. `bundleLabel.test.ts` and `worker-host.test.ts` pin both to the same vector from
  Python's `base64.b32encode`.
- The relay's response headers add `x-content-type-options: nosniff` and `cache-control: no-cache`
  to the design's policy. The hosted service decides caching, but a stale relay script is a stale check.
- `pnpm dev:mobile` set `NODE_ENV=production` for the dev server as a side effect of building the probe with
  Vite's build. `apps/mobile/scripts/dev.mjs` now sets it back first. Without that, `import.meta.env.DEV` was false.
- The public pages that cite the client sandbox doc teach the desktop's trust model. The added phone
  paragraph changes none of what they teach, so I left them unmarked.

What later phases need to know:

- Phase 3 calls `setTreeBundleSource` with a function from a bundle hash to its bytes as an
  `ArrayBuffer`. The sandbox checks the bytes against the hash, so custody still checks them first for
  its own reasons.
- Phase 5 reuses `bundleLabel` and `phoneRelayOrigin` logic for frames. The phone's origin is computed in
  `isolatedWorker.ts` and isn't exported yet.
- Playwright's request interception can stand in for the missing header in a control, but not in
  Chromium: interception left Chromium's worker blocked from a loopback server with no policy at all.
  Use a proxy that drops the header instead. The evidence below used one.
- A browser resolves `<label>.localhost` to loopback, and WebKit and Chromium did on macOS. If another
  program listens on `[::1]` at the sandbox port, `localhost` can reach it instead. Change
  `ACORN_SANDBOX_PORT` when a check hits the wrong server.

## Design

**Names.** The build setting is `ACORN_SANDBOX_DOMAIN`. A bundle's origin is `https://<label>.<domain>`
where the label is the SHA-256 in lowercase base32 without padding (52 characters). A name on `localhost`
uses `http://`.

**Files.** `apps/mobile/sandbox/worker.html` loads `/worker-host.js`. Those two and `headers.json` are
`apps/mobile/dist-sandbox/`. Any other path on the domain is a 404 with the same headers.

**Messages.** Each carries the nonce the renderer put in the URL fragment.

| Direction | Message |
| --- | --- |
| Relay to renderer | `{ kind: 'acorn:tree-relay-ready', nonce }` |
| Renderer to relay | `{ kind: 'acorn:tree-relay-start', nonce, hello: { acornBridge: 1 }, bundle: ArrayBuffer }` with the bridge and tree ports transferred |
| Relay to renderer | `{ kind: 'acorn:tree-relay-error', nonce }` on a mismatch or a worker error |

The renderer accepts a message only from the frame's window, from the exact relay origin, with its nonce.

**Headers.** The ones in `headers.mts`: the policy from the starting design, `nosniff`, `no-cache`.

**Phone app policy.** `frame-src` for the sandbox domain, set by the hosted service and shown in
[serve the sandbox domain](../../mobile/phone-setup.md#serve-the-sandbox-domain).

**Owning documents.** [The plugin worker](../../mobile/plugin-sandbox.md),
[the client sandbox](../../security/plugin-client-sandbox.md), and
[serve the sandbox domain](../../mobile/phone-setup.md#serve-the-sandbox-domain).

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

- Does iOS Safari apply the relay page's `connect-src 'none'` inside a `blob:` worker? Desktop WebKit
  does ([evidence](#evidence)). iOS Safari is for checkpoint 5. If it doesn't apply it, the fallback is a
  service worker on each sandbox origin that serves `/client.js` from the posted bytes, so the worker
  loads from `'self'` as it does on the desktop.
- Does an app installed to the home screen on iOS treat a cross-site iframe differently from Safari?
  Deferred to checkpoint 5, which needs a phone.
- The domain's name. Deferred to the hosted step. The build builds with no domain, and a default is one
  line in `apps/mobile/vite.config.ts` once the name exists.

## Evidence

Checkpoints 1 to 4, October 23, 2026, at `30aa198fd` plus this change. `pnpm dev:mobile` on ports 4491 and
4492, a probe server on a random port that logs every request and upgrade, viewport 390 by 844, driven by
`playwright-core` from a folder outside the repository. WebKit 27.2 (Playwright revision 2370) and Chromium
151.0.7922.34.

| Checkpoint | WebKit | Chromium |
| --- | --- | --- |
| 1. The tree draws | Passed. The probe drew `sandbox probe drew its tree` inside `.remote-tree`, in an iframe at `http://uamsnu2l...kpwq.localhost:4492/worker.html`. | Passed, same iframe. |
| 2. No network from the worker | Passed. `fetch`: Load failed. `WebSocket`: The operation is insecure. Import: Importing a module script failed. The probe server saw nothing. | Passed. `fetch`: Failed to fetch. `WebSocket`: refused. Import: Failed to fetch dynamically imported module. The probe server saw nothing. |
| 3. Tampered bytes refused | Passed. One extra byte posted under the honest label: no tree, `.sandbox-fixture-failed` shown with "the isolated plugin worker failed to start", the probe server saw nothing. | Passed, same result. |
| 4. No reach into the app's storage | Passed. The page created `phone-app-canary` at the app origin first. The probe listed `0 databases`. | Passed, same result. |

Control: the same run against a copy of the sandbox server that drops the policy header. The worker
reached `GET /fetch` and `GET /module.js` and opened an upgrade in both engines, so the empty log in the
runs above comes from the policy.

This answers the first open question for WebKit and Chromium on a desktop: a worker started from a
`blob:` URL takes the relay page's `connect-src 'none'` and `script-src 'self'`. It doesn't answer it
for iOS Safari.

The phone's first screen after this change: 506,722 B of scripts against the 520,000 B ceiling, 126,786 B
of styles, from `pnpm --filter @acorn/mobile build` on October 23, 2026. `isolatedWorker.ts` loads
with the tree host, after the first frame, and the production bundle has no `devSandbox`, probe, or
`setTreeBundleSource`.

Not run: the desktop in its real window with `pnpm dev:agent`. The desktop defines no sandbox domain, so
the phone branch in `isolatedWorker.ts` returns null there, and `isolatedWorker.test.ts` and
`workerHost.test.ts` still pass unchanged.

Skipped:

- **Step 3, hosted service.** The domain, wildcard DNS and certificate, static host, header policies, and
  the app's `frame-src` happen in the hosted service, which this repository doesn't hold. The open side
  gives it `dist-sandbox/` and `headers.json`.
- **Checkpoint 5, real phones.** No agent holds an iPhone or an Android phone. The owner repeats checkpoints
  1 to 3 against the hosted sandbox, in Safari and installed to the home screen, and records the iOS and
  Android versions.

## Verify before building

Recheck `isolatedWorker.ts`, the desktop's relay script, and the phone app's header policy against
your checkout.
