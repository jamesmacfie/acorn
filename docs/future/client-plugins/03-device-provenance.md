# Device provenance: a plugin a device holds

Part of [docs/future/client-plugins/](./README.md). This is the design for the first stance change:
a plugin's bundle can come from the device itself, not only from a node. Phase 0 builds it.

## What exists

Every piece a device-held plugin needs is already on the device, because the fleet model put it
there.

- **Custody.** `packages/client-core/src/infra/platform/index.ts` declares `PluginCustody` with four
  members: `state()`, `cachePut()`, `trustRecord()`, `devGrant()`.
  `packages/client-core/src/plugins/host.ts` is the only client module that calls it, and its header
  already names the future: "today it fronts the desktop helper's content-addressed store, and a
  future web client fronts IndexedDB."
- **The cache.** `packages/desktop-helper/src/plugins/pluginCache.ts` stores bundles content-addressed
  under `<userDataDir>/plugin-cache/<sha256>.js`, caps them at `MAX_BUNDLE_BYTES` (8 MiB), and
  hashes what arrived rather than trusting a claim. Its one fill path is `putFromNode(nodeId,
  pluginId, claim)`, which fetches `/v2/core/plugins/<id>/client.js` through the node broker.
- **The trust store.** `packages/desktop-helper/src/plugins/pluginTrustStore.ts` keys acknowledgements
  on `(pluginId, hash)`. A row carries `nodeId`, and the comment beside it says "did this come from.
  Not part of the key, because the same bundle from a second node is the same bundle." Dev grants
  are keyed on `(pluginId, nodeId)`.
- **Resolution.** `packages/client-core/src/plugins/resolveBundles.ts` takes `BundleCandidate[]`
  (each with `pluginId`, `version`, `hash`, `nodeId`) and picks one `ActiveBundle` per plugin id:
  highest version whose `apiVersion` range covers `PLUGIN_API_MAJOR`, ties on hash. The winner
  records `nodeIds[]`, the nodes offering that exact bundle.
- **The roster.** `packages/client-core/src/plugins/distribution.ts` builds candidates from each
  node's `GET /v2/core/plugins` answer (`installedByNode`), keeps `pendingTrust`, and
  `syncPluginDistribution()` re-resolves after any change.
- **The render paths.** `frames/register.ts` mounts a trusted bundle in an iframe at
  `app-plugin://<hash>`; layout phase 3 adds the worker. Neither asks where the bytes came from.

What is missing is one fill path, one provenance field, and the places that assume a bundle has a
node.

## The design

### Provenance is a field, not a second store

Every record that carries `nodeId` today gains a `source` instead:

```ts
type BundleSource = { kind: 'node'; nodeId: string } | { kind: 'device' }
```

`BundleCandidate`, `ActiveBundle`, `PluginAckRecord`, `PluginTrustDecision`, `PluginDevGrant`, and
the cache's entry schema all take it. A `nodeId` string stays as a convenience accessor where the
kind is `node`. The trust store's key stays `(pluginId, hash)`; provenance was never in the key and
still is not, so a bundle the user installed on the device and the same bytes offered by a node are
one acknowledgement. That is the property the comment in the trust store was protecting, and it
holds.

### The device fill path

`PluginCache` gains `putFromSource(pluginId, source)` beside `putFromNode`, where `source` is the
node installer's four-form union from `packages/node-core/src/server/routes/plugins/plugins.ts`: `{ github,
tag? }`, `{ npm, version? }`, `{ url }`, `{ path }`. The helper resolves the source the way
`packages/node-core/src/server/plugins/installer.ts` does, and the resolution code moves to a shared
package both import, so "what does `{ github }` mean" has one answer. The helper reads the manifest
out of the package, refuses it if it declares a `node` entry (see the rule below), takes the client
bundle, hashes it, and stores it. The answer is `{ hash }` or one of the existing `PutFailure`
values plus a new `'has-node-half'`.

A `{ path }` install on a device is a folder the helper reads once per put and re-reads under a dev
grant. It pins nothing, as a node folder install pins nothing (`docs/plugins.md`), and the Settings
row says so.

### The rule: no node half on a device

A device-held plugin may declare `client` and `contributions` and nothing under `node`. The helper
refuses a package whose manifest has a `node` entry, `routes`, `schedules`, `tools`,
`contextSections`, `providers`, `harnesses`, `taskChecks`, or `auditActions`, with one error and no
partial install. The same check runs on the client when it reads the manifest back, so a helper that
skipped it is caught. The argument is in [refused.md](./refused.md) § A node half on a device.

Two contributions look client-side but are refused too. `contributions.collections` needs a node to
sample; `contributions.schedules` runs node code. Both are listed by name in the refusal so a later
reader does not have to re-derive it. Client-side schedules (`ctx.schedules` on the client, the
device-local scheduler) are compiled-only today and stay that way.

### Resolution against the fleet

`resolveActiveBundles` takes one more candidate pool: the device's own bundles, each with `source: {
kind: 'device' }`. The rule is:

1. A device candidate for a plugin id wins over every node candidate for that id, regardless of
   version. The user put it there on purpose; a node offering a newer build of the same id is
   offering it to a device that chose otherwise.
2. Among device candidates the existing rule applies (highest version, then hash), though there is
   normally one.
3. The `ActiveBundle` records `source` and, for a device winner, the `nodeIds[]` that also offer the
   same hash, if any, so Settings can say "also on node X".

This is the one place a device plugin changes fleet behaviour, and it is a single sort key. A test
pins it against the case that matters: node offers 2.0, device holds 1.9, device wins.

### Trust

The trust prompt is the same three-tier prompt with a different provenance line. Today the copy says
which node the bundle came from. For a device bundle it says "installed on this device from `<source
as the user gave it>`", and the `declared` tier is empty because there is no node half to disclose.
`packages/client-core/src/plugins/trustModel.ts` already builds lines from grant classes, so this is
one new line builder and one absent section, not a new prompt.

Consent is still per `(pluginId, hash)`, still per device, still recorded on both accept and reject.
An update is a new hash and re-prompts. Development mode works the same way, keyed on `(pluginId, {
kind: 'device' })` instead of `(pluginId, nodeId)`, with the same `dev` and `partial` marks on its
rows so an auto-accepted hash never becomes a diff baseline.

### State

A loaded plugin's frame gets `state.get/set` over `plugin:<id>:*` prefs, which live on the node
(`GET|PUT /v2/core/prefs`). A device plugin's state goes to device prefs instead. The broker's
`state` verb checks the bundle's `source` and routes to `persistence/devicePrefs.ts` under the same
key shape, and `DEVICE_KEYS` gains a prefix rule for `plugin:<device-plugin-id>:` rather than a
literal list, because the set of device plugins is not known at build time. The 1 MiB cap stays.

This is a deliberate asymmetry and the argument is in the README's decisions table: following the
active node would make a device plugin's settings change when the user switches nodes, and a device
plugin has no node of its own to follow.

### The roster and Settings

`GET /v2/core/plugins` is a node's roster and does not change. The client's roster view
(`eligiblePlugins()` in `packages/client-core/src/plugins/contributions.ts`) merges the device's
`PluginHostState.cached` entries whose `source.kind` is `device` as rows with no node. Settings →
Plugins gains a section, "On this device", with install (the four sources), update, remove, enable
and disable, and the dev grant toggle. The existing per-node section is unchanged. A plugin id that
appears in both shows in the device section with an "also offered by node X" line, because the
device won resolution.

Enable and disable for a device plugin is a device pref, not a node `PUT /v2/core/plugins`.

### Uninstall

Removes the cache entry and the device prefs under `plugin:<id>:`. Acknowledgements stay, as they do
for node plugins, so a reinstall of the same hash does not re-prompt. Exclusive-slot picks that
named the plugin fall back to core through the existing resolver, because the provider is absent.

### Reconciliation and bundled packages

None of this touches `reconcileBundledPackages` or the tombstone logic in
`apps/node/src/composition/composition.ts`. Bundled packages are node packages. A device never seeds a
plugin on its own; every device plugin is one the user asked for.

## What does not change

- The node's plugin routes, installer, loader, and reload.
- `frames/register.ts`, `frames/broker.ts`, `frames/scopes.ts`, `frames/verbs.ts`. A device bundle's
  frame has the same bridge with the same allowlist and the same absence of network.
- The `apiVersion` rule. A device bundle that does not cover `PLUGIN_API_MAJOR` is dropped like any
  other.
- `MAX_BUNDLE_BYTES`.
- Signing and discovery. A device install from a URL is unsigned in exactly the way a node install
  from one is, and `docs/future/ecosystem/blockers.md` gate 2 applies to both.

## How each host implements it

[07-hosts.md](./07-hosts.md). The short version: the desktop helper does what this file says; the
PWA's `WebBroker` grows an IndexedDB cache and a WebCrypto hash behind the same `PluginCustody`
interface; the terminal host keeps a file cache beside its own config and runs bundles in a worker
thread. The interface is the contract. The storage is not.
