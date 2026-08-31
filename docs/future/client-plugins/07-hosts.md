# Hosts: what the desktop, the PWA, and the terminal owe the custody contract

Part of [docs/future/client-plugins/](./README.md). The owner's instruction is that desktop, mobile,
and terminal stay in view. This file is the checklist every phase's "doors left open" section is
measured against, and it says which host owns what.

## The contract is `PluginCustody`

`packages/client-core/src/infra/platform/index.ts` declares it with four members: `state()`, `cachePut()`,
`trustRecord()`, `devGrant()`. Phase 0 adds provenance to its types and a device fill path to
`cachePut`. After that, "a plugin installed on this device" means: this host's custody returned a
cache entry with `source.kind === 'device'` and an accepted acknowledgement for its hash. Every host
answers the same question with its own storage, and `packages/client-core/src/host/plugins/host.ts` is
the one client module that asks.

The rest of the client does not know which host it is on. That is the property to keep.

## Desktop

The desktop helper implements everything in [03-device-provenance.md](./03-device-provenance.md):
the source resolver shared with the node installer, `putFromSource`, provenance on cache and trust
rows, the device dev grant, and the file watcher for phase 4. Bundles render in the iframe today and
the worker after layout phase 3.

What it owes the other two:

- The source resolver lives in a package with no Node-only dependency at its interface, so a browser
  can call the same function with a different fetch.
- The cache entry schema and the acknowledgement schema are `@acorn/protocol` types, not helper
  types, so the PWA and the terminal store the same rows.

## The PWA

`docs/future/remote.md` owns the web client. Its recommended shape is browser-side fan-out through a
`WebBroker` platform adapter with tokens in IndexedDB under a non-extractable WebCrypto key. What
this folder adds to that list:

- **A `PluginCustody` implementation over IndexedDB.** Bundles as blobs, hashed with `crypto.subtle`
  before storage, acknowledgements as rows. The renderer's
  `packages/client-core/src/host/plugins/host.ts` header already names this as the plan.
- **Device install from the browser.** `{ github }`, `{ npm }`, and `{ url }` need CORS or a proxy;
  `remote.md` already needs a proxy story for TLS, and the same hop serves this. `{ path }` does not
  exist on the web and the Settings row is not drawn, following the folder-picker rule in
  `platform/contract.ts`: cancel and no-picker take the same path.
- **The same iframe.** A device bundle on the web renders in a sandboxed iframe with an opaque
  origin, as `remote.md` says node bundles do. The worker after layout phase 3 is the same worker.
- **The subset shell stays a decision.** A replaced rail or topbar is a desktop surface. The mobile
  shell has its own chrome and `formFactor` on the offering surface says `['desktop']` unless the
  plugin has a narrow projection to offer. Phase 2's contracts carry a `formFactor` so the mobile
  shell can hide an offer rather than draw it wrong.

## The terminal

[docs/tui.md](../../tui.md) owns the host, and its §§ Custody and The trust prompt own what this
section used to say: a `PluginCustody` over files beside the terminal's own config, device as the
natural provenance with `{ path }` allowed, the trust prompt as a kit tree, and the terminal's column
in the trust model.
Phase 0's resolution rule (device wins) applies there unchanged, and phase 4 of this folder, the
config file, is built for that host first.

**The host exists**, as of that folder's phase 5 (2026-08-31), and its custody is the design above
rather than a variation on it: `apps/tui/src/plugins/custody.ts` builds `@acorn/custody`'s own
`PluginCache` and `PluginTrustStore` against `$XDG_CONFIG_HOME/acorn/plugins/`, so the schemas, the
`(pluginId, hash)` key and the refusal on a hash mismatch are the desktop's. It is the only file in
that package that may name either class, and `client-core/host/plugins/host.ts` is still the only
caller of `pluginCustody()`, which is checklist items 1 and 2 held on a second host. What that phase
did **not** build is a device-held install: there is no surface to reach one from yet, so `{ path }`
is a form the custody accepts and nothing offers. That is this folder's phase 0 on this host.

## The checklist

Each phase's "doors left open" section names which of these it touched and how it held them:

1. No client module outside `packages/client-core/src/host/plugins/host.ts` calls `pluginCustody()`.
2. No cache or acknowledgement type is defined in a host package. They are protocol types.
3. No source form is assumed to exist on every host. `{ path }` is desktop and terminal only.
4. No replaceable-surface contract carries a DOM type, a `MouseEvent`, or a shell callback that a
   worker could not receive.
5. No replaceable-surface offer is drawn on a host whose `formFactor` it does not name.
6. No install path skips the trust prompt, on any host, for any provenance.
7. No node pref moves to the device file, and no device file key is executed.
