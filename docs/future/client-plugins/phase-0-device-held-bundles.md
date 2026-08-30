# Phase 0: device-held bundles

Status: not started. Waits on nothing.

## Goal

A client-only plugin can be installed on a device by that device, with no node involved. Every
bundle record carries its provenance. The trust prompt names it. Its state is device-scoped.
Settings → Plugins has an "On this device" section. After this phase a client-only plugin that
contributes panes, sources, commands, palette rows, and themes works from a device install, through
the iframe path that exists today.

## Why this phase, and why now

It is the half of the ask that changes a stance rather than a surface, and it needs nothing from the
layout programme. Every later phase installs its test plugins through it. Landing it early also puts
the provenance field into the types before phase 1 and 2 contracts are written against them.

## Scope

In:

- `BundleSource` in `@acorn/protocol` and `source` on `BundleCandidate`, `ActiveBundle`,
  `PluginTrustDecision`, `PluginAckRecord`, `PluginDevGrant`, `PluginDevGrantRequest`, and the cache
  entry schema. `nodeId` stays as an accessor for `kind: 'node'`.
- A shared source resolver package, extracted from `packages/node-core/src/server/plugins/installer.ts`,
  that both the node installer and the helper call.
- `PluginCache.putFromSource()` in the helper, with the manifest read, the no-node-half check, and
  `'has-node-half'` as a new `PutFailure`.
- Two helper wire verbs, `plugins-install` and `plugins-remove`, and provenance on `plugins-state`.
  `PluginCustody` gains `install()` and `remove()`; `platform/contract.ts` lists them in the
  `plugins` group so `seamProblems()` catches a half-built host.
- The resolution rule in `resolveBundles.ts`: device candidates win.
- The provenance line in `trustModel.ts` and an empty `declared` tier for device bundles.
- Device dev grants keyed on `(pluginId, { kind: 'device' })`.
- Device-scoped `plugin:<id>:*` state: a prefix rule in `devicePrefs.ts` and a route in the broker's
  `state` verb.
- The device section in `PluginsSettings.tsx`: install (four sources, `{ path }` only where the host
  has a folder picker), update, remove, enable, disable, dev grant.
- The client-side re-check of the no-node-half rule when a manifest is read back.
- A test plugin under `packages/plugin-api/src/testkit/` or a fixture folder that is client-only,
  used by this phase's tests and reused by phases 1 to 3.

Out: any replaceable surface (phase 1), style packs (phase 3), the config file (phase 4), the worker
render path (layout phase 3), the PWA and terminal custody implementations (07-hosts.md says what
they owe; `remote.md` and `terminal/06-isolation.md` own them).

## Design detail

As [03-device-provenance.md](./03-device-provenance.md). The points that need a decision at build
time:

**Where the resolver lives.** A new `packages/plugin-source/` with `resolveSource(source, fetch)`
returning a package directory or tarball stream, no Node-only import at its interface, so the PWA
can call it with `window.fetch`. The node installer and the helper both import it. If the extraction
turns out larger than the phase, the helper may import from `node-core` for this phase and the
extraction becomes a follow-up, recorded as a deviation.

**The manifest read.** The helper reads `acorn-plugin.json` out of the package with the same parser
the node uses (`packages/node-core/src/server/plugins/manifest.ts`, which wraps
`@acorn/protocol/plugin/contract.ts`). A parse failure is a `PutFailure` with the parser's message.
The no-node-half check is a function in `@acorn/protocol` beside `isCoreSlotSurface`, so the client
re-check is the same function.

**Enable and disable.** A device pref, `PrefKeys.devicePluginsDisabled`, a list of ids. The client's
`eligiblePlugins()` reads it beside the node's disabled list.

**The prompt's provenance line.** "Installed on this device from `<source>`", where `<source>` is
the source as the user gave it (the install route already records the source "as the owner gave it,
not as it resolved"). For `{ path }`, "from a folder on this device, which pins nothing".

**The trust store migration.** Existing acknowledgement rows have `nodeId` and no `source`. The
store's schema defaults `source` to `{ kind: 'node', nodeId }` on read, the same pattern the store
uses for fields added after rows were written.

## Code touched

- `packages/protocol/src/plugin/bundles.ts` (new): `BundleSource`, `bundleSourceSchema`,
  `hasNodeHalf(manifest)`.
- `packages/client-core/src/host/trust/resolveBundles.ts`: `source` on candidates and winners; the
  device-wins sort key.
- `packages/client-core/src/host/plugins/distribution.ts`: device candidates from
  `PluginHostState.cached`; `eligiblePlugins()` merge.
- `packages/client-core/src/host/trust/trustModel.ts`: provenance line; empty `declared` tier.
- `packages/client-core/src/host/plugins/host.ts`: `installPluginOnDevice`, `removePluginFromDevice`.
- `packages/client-core/src/infra/platform/{index.ts,contract.ts}`: `PluginCustody.install`, `remove`; the
  `plugins` group's member list.
- `packages/client-core/src/infra/persistence/devicePrefs.ts`: prefix rule for device plugin state;
  `devicePluginsDisabled`.
- `packages/client-core/src/host/frames/broker.ts`: `state` verb routes by `source`.
- `packages/client-core/src/features/settings/PluginsSettings.tsx`: the device section.
- `packages/desktop-helper/src/plugins/pluginCache.ts`: `putFromSource`, `remove`, `source` on entries.
- `packages/desktop-helper/src/plugins/pluginTrustStore.ts`: `source` on rows and grants, with the read
  default.
- `apps/desktop/src/shell/{wire.ts,bridge.ts}` and `apps/desktop/src/helper/helperServer.ts`: the two
  verbs.
- `apps/desktop/src/shell/bridge.test.ts`: the seam check covers the new members.
- `packages/node-core/src/server/plugins/installer.ts` and the new `packages/plugin-source/`: the
  extraction.
- `packages/plugin-api/src/testkit/`: the client-only fixture.

## Tests

- `resolveBundles.test.ts`: node offers 2.0, device holds 1.9, device wins; two nodes and a device
  offer the same hash, one winner with all three recorded; a device bundle outside the API major is
  dropped.
- `pluginCache.test.ts`: `putFromSource` hashes what arrived; a package with a `node` entry is
  refused whole with `'has-node-half'`; a `{ path }` put re-reads the folder.
- `pluginTrustStore.test.ts`: a row written before `source` reads back as `{ kind: 'node' }`; a
  device dev grant auto-accepts a new hash and marks the row `dev` and `partial`.
- `trustModel.test.ts`: a device bundle's prompt has the provenance line and no `declared` tier.
- `devicePrefs.test.ts`: `plugin:<device-id>:foo` is a device pref; `plugin:<node-id>:foo` is not.
- `broker.test.ts`: `state.set` from a device bundle writes device prefs and never calls the node.
- `contract.test.ts` and `bridge.test.ts`: a host that implements `plugins` without `install` fails
  `seamProblems()`.
- `hasNodeHalf` is exercised on every fixture manifest in the repo: the six loaded plugins are true,
  the client-only fixture is false.
- Boot test: the desktop app boots with a device plugin cached and untrusted, and shows the prompt.

## Docs owed

Per [docs-migration.md](./docs-migration.md), phase 0 rows: `docs/plugins.md` (two sections plus one
new), `docs/security.md` (three sections), `docs/state-ownership.md`, `docs/plugin-authoring.md`,
`docs/contribution-kinds.md`, `docs/shell.md`, `docs/testing.md`, `docs/architecture-overview.md`,
`docs/future/remote.md`, `docs/future/terminal/06-isolation.md`, `docs/future/ecosystem/README.md`.

## Doors left open

Against [07-hosts.md](./07-hosts.md):

1. 1. Only `packages/client-core/src/host/plugins/host.ts` calls `pluginCustody()`. The arch rule already
   holds this; the phase adds two functions there and nowhere else.
2. `BundleSource` and the cache and acknowledgement schemas are protocol types.
3. `{ path }` is drawn only where `folderPicker` resolves.
4. The source resolver takes a `fetch` so a browser can supply its own.
5. No install skips the prompt. A device install lands in `pendingTrust` like a node bundle.

## Done when

- A client-only plugin installed from a GitHub release on the desktop shows the trust prompt with
  the device provenance line, is accepted, and its pane appears in a task without a reload.
- The same plugin id offered by a paired node at a higher version does not displace it, and Settings
  says "also offered by node X".
- Removing it from Settings removes its pane, its cache entry, and its device prefs, and leaves the
  acknowledgement.
- `pnpm lint`, `pnpm test`, and the desktop boot test are green.

## Verify before building

- `packages/client-core/src/infra/platform/index.ts` declares `PluginCustody` with exactly `state`,
  `cachePut`, `trustRecord`, `devGrant`, and `contract.ts` lists the same four in `SEAM_GROUPS`.
- `packages/desktop-helper/src/plugins/pluginCache.ts` has `putFromNode` and `MAX_BUNDLE_BYTES`;
  `pluginTrustStore.ts` keys `decisionFor` on `(pluginId, hash)` and carries `nodeId` on rows.
- `packages/client-core/src/host/trust/resolveBundles.ts` exports `resolveActiveBundles` with
  `BundleCandidate.nodeId` and `ActiveBundle.nodeIds`.
- `packages/node-core/src/server/routes/plugins/plugins.ts` has the four-form `installSource` union and
  `server/plugins/installer.ts` resolves it.
- `apps/desktop/src/shell/wire.ts` lists `plugins-state`, `plugins-cache-put`,
  `plugins-trust-record`, `plugins-dev-grant`.
- `packages/client-core/src/infra/persistence/devicePrefs.ts` has `DEVICE_KEYS` as a literal set and
  `isDevicePref` as exact match.
- `packages/client-core/src/features/settings/PluginsSettings.tsx` exists and draws the per-node roster.
- `tools/arch/boundaries.test.ts` has the rule that only `platform/` names `window.acorn`.
