# Phase 1: make the running plugin identity explicit

Status: proposal, 2026-09-26. Not started. Waits on nothing.

Part of [Node-provided UI](./README.md).

## Goal

A client can tell which plugin declaration and client bundle match the node half actually serving
requests. Installing, updating, uninstalling, failing to load, and restarting may change the package
on disk without changing that running identity. The protocol represents both facts without asking the
client to infer one from the other.

This is the foundation for fleet resolution, trust fallback, and contribution availability. Those
phases must not invent their own meaning for `running` while this one is pending.

## The current failure

`packages/node-core/src/server/pluginHost/state.ts` already knows that disk and process state differ:

- `installed()` re-scans the plugin directory on every request;
- `booted()` records only `{ id, version }` for what the process loaded;
- `roster()` says what the plugin host assembled; and
- `loadFailures()` says why an attempted load failed.

The response nevertheless puts the freshly scanned manifest in `row.installed`, including its client
hash, permissions, and contributions. The client treats that block as the declaration behind the
running plugin. After an update, the row can therefore say all of these at once:

```text
running node half:        plugin 1.0
row.installed manifest:   plugin 2.0
row.installed client:     hash for plugin 2.0
state:                    pending-restart
```

`eligiblePlugins()` then chooses the 2.0 manifest and bundle. `pluginEnabledOnNode()` checks only the
plugin name and `running`, so it allows the 2.0 UI to call the 1.0 node half. `apiVersion` cannot make
that safe: it describes compatibility with acorn's plugin API, not a plugin's private routes and
payloads.

The inverse also occurs. An uninstalled package can keep serving until restart, but its matching
manifest and client bytes have disappeared from the disk scan. A failed reload can leave the previous
instance serving while the new candidate remains on disk. A boot failure has a candidate but no
running service at all. A boolean cannot represent these cases.

## Decision: publish a boot or commit snapshot

`NodePluginRow` will carry two separate optional blocks during the compatibility window:

- `active`: the identity committed into the running plugin host; and
- `installed`: the package candidate currently on disk.

Names are illustrative until the protocol change is built. The distinction is settled.

```ts
type PluginRuntimeIdentity = {
  version: string
  apiVersion: string
  permissions: NodePluginPermissions
  contributions: PluginContributions
  client: { hash: string; bytes: number } | null
  activation: 'node' | 'client-only'
}

type NodePluginRow = {
  name: string
  active?: PluginRuntimeIdentity
  installed?: InstalledPluginRow
  state: 'active' | 'failed' | 'disabled' | 'pending-restart'
  // Existing compatibility fields remain while old clients exist.
  running: boolean
  disabled: boolean
  // Existing failure fields remain separate from identity.
  stage?: 'load' | 'init' | 'ready'
  reason?: string
}
```

The active block is an immutable snapshot of the declaration used for that running instance. It is
captured at boot, or when the reload path commits a replacement. It is never rebuilt from the current
plugin directory.

`active` is absent when no node service exists. A failure record does not become an active identity
just to suppress a restart banner. `restartRequired` is derived by comparing desired disk and toggle
state with the active identity; it is not derived from a misleading `running: true` value.

## What belongs in the snapshot

The snapshot contains everything the client uses to decide what the running plugin may show or call:

- plugin version and acorn plugin API range;
- permissions and declared event channels;
- namespaced contribution input before the client applies its namespace;
- client entrypoint hash and size, when one exists; and
- whether activation needs a node half.

Source and installation metadata remain on `installed`. They describe the candidate on disk, not the
running process. Failure time, failure stage, and failure reason remain on the row because they
describe an activation attempt and may coexist with a previous active identity after a failed reload.

The implementation should reuse one protocol shape for the manifest-derived fields rather than hand
copying a second projection. The exactness check beside `DeclaredRow` should continue to fail closed
when the loader's manifest model changes.

## Retain the matching client bytes

Publishing the old active hash is insufficient if the node can no longer serve those bytes. A device
that paired after an update would know that 1.0 is running but could only fetch 2.0 from disk.

For a package with a node half, composition must retain the active client entrypoint with the active
snapshot until the process stops or a reload commits. This can be an in-memory byte snapshot or a
private runtime cache. It must have these properties:

1. the hash is computed from the retained bytes;
2. the manifest snapshot and bytes are committed together;
3. an update of the package directory cannot mutate either;
4. an uninstall does not remove the active snapshot while the old node half is still serving; and
5. a failed reload leaves the previous snapshot and bytes intact.

The bundle route should address an advertised hash, for example
`GET /v1/core/plugins/:id/bundles/:hash`, rather than re-reading whichever entrypoint happens to be on
disk for that id. It may serve either an active or installed candidate hash, but it must refuse a hash
the current state response did not advertise. The device still recomputes the hash from the response;
addressing prevents a normal update race and does not replace verification.

## Client-only packages

A package installed on a node may have a client entrypoint and no node half. It has no process-bound
routes, tables, or jobs, so changing it does not need a node restart. For this case the node may promote
the validated disk declaration directly to an active identity and broadcast the normal plugin-change
event. The promotion is still a snapshot transition: the client must not observe half of the old
declaration with half of the new one.

This rule is about packages distributed by a node. Device-held client plugins from
[client-plugins](../client-plugins/README.md) have no node runtime identity and use device provenance
instead.

## State transitions

| Event | Active identity | Installed candidate | Result |
| --- | --- | --- | --- |
| Clean boot succeeds | New boot snapshot | Same package | `active`; no restart required. |
| Fresh node plugin install | Absent | New package | `pending-restart`; UI unavailable until restart. Candidate may be cached and trusted in advance. |
| Node plugin update | Previous snapshot | New package | `pending-restart`; previous UI remains selectable for the previous runtime. |
| Uninstall before restart | Previous snapshot | Absent | `pending-restart`; previous UI may remain until restart because its service and retained bytes still exist. |
| Boot load fails | Absent | Failed package, when readable | `failed`; no active contribution availability and no restart loop. |
| Live reload succeeds | New committed snapshot | Same package | `active`; distribution receives one source-aware change. |
| Live reload fails | Previous snapshot | New or unchanged package | Previous identity stays active; failure details describe the rejected candidate. |
| Disable saved | Current snapshot until restart | Package on disk | `pending-restart` or equivalent desired-state marker; current service remains available until the process stops. |
| Client-only install or update | New atomic snapshot | Same package | Effective immediately after trust and contribution reconciliation. |

The final protocol may represent desired toggle state separately from `state`. What matters is that
the table above remains expressible without overloading `running`.

## Client selection rule

The client uses the active identity for contributions shown against a node. It never combines an
installed candidate manifest with an older active service.

This programme chooses per-node exact selection rather than assuming private wire compatibility:

- each node has a selected client hash for the active runtime it reports;
- the renderer registers at most one version of a plugin id at a time;
- changing the active node can atomically swap that plugin's registered version; and
- two nodes may share a selection when they report the same client hash.

A future manifest field could declare a private wire compatibility range. It is not part of this
programme. Until a concrete need defines its semantics, a different active client hash means a
different selection. An author can ship the same client bytes with two node versions when they are
actually compatible.

## Protocol compatibility

The fields are added before any legacy field is removed. `active` is optional because per-node query
caches persist responses and have no general version buster.

Rollout order:

1. Ship a node that publishes `active`, retains its bytes, and keeps the legacy fields.
2. Ship clients that prefer `active`.
3. For an older node with no `active`, use a conservative adapter:
   - treat `state: active` with an installed declaration as the legacy active identity;
   - withhold loaded UI for `pending-restart` and `failed` rows because coherence cannot be proven;
   - keep compiled contributions on their existing gates; and
   - record a compatibility diagnostic so the reason for a missing loaded surface is visible.
4. Remove the adapter and legacy fields only when the supported node floor guarantees `active`.

This allows node-first and client-first deployment without parsing failure. A mixed version may hide a
pending loaded surface, which is safer and more intelligible than running the wrong client against it.

## Code touched

Paths are current hints, not promises.

- `packages/protocol/src/api.ts`: the runtime identity and additive `NodePluginRow` field.
- `packages/node-core/src/server/pluginHost/host.ts`: retain each committed declaration rather than
  only the plugin name and version.
- `packages/node-core/src/server/pluginHost/state.ts`: publish active and installed separately and
  derive restart state from their difference.
- `packages/node-core/src/server/plugins/loader.ts`: build the declaration and byte snapshot once.
- `packages/node-core/src/server/plugins/reload.ts`: replace the active snapshot only inside the
  candidate-then-commit window.
- `apps/node/src/composition/pluginState.ts`: expose active snapshot and hash-addressed bundle reads
  instead of re-scanning disk for the running answer.
- `packages/node-core/src/server/routes/plugins/plugins.ts`: serve a named advertised bundle hash.
- `packages/client-core/src/host/plugins/distribution.ts`: adapt legacy rows and consume runtime
  identities.
- `packages/client-core/src/host/plugins/contributions.ts`: source the declaration from the selected
  runtime identity.

## Tests

- State projection: 1.0 active with 2.0 installed publishes both identities and requires restart.
- State projection: an uninstalled 1.0 remains active with no installed candidate until restart.
- State projection: a boot failure has no active identity even if the candidate manifest parsed.
- Reload: failed 2.0 reload preserves the complete 1.0 snapshot and bytes; successful reload swaps
  both atomically.
- Bundle route: active 1.0 and installed 2.0 can both be fetched by advertised hash; any other hash is
  refused; each response matches its claim.
- Client-only update: the active declaration and bundle change without a node restart.
- Legacy adapter: active legacy rows work, while failed and pending-restart legacy rows withhold loaded
  UI.
- Contribution selection: the manifest, permissions, contribution ids, and client bytes all come from
  one active identity.
- Node switch: nodes running different hashes never produce a manifest from one and bytes from the
  other.

The broader combinations are in [06-test-matrix-and-rollout.md](./06-test-matrix-and-rollout.md).

## Docs owed

When this phase ships, update the runtime and activation contracts in:

- `docs/architecture-overview.md`;
- `docs/plugins/activation.md`;
- `docs/plugins/package-shape.md`;
- `docs/api-reference.md`;
- `docs/caching.md`;
- `docs/security.md`; and
- `docs/testing.md`.

## Done when

- A newly paired device can fetch the client bundle matching an old node half after that plugin was
  updated or uninstalled on disk.
- No client path uses `row.installed` as proof of what a node process is running.
- A failed plugin has no fabricated active identity, and restart state remains accurate.
- A successful live reload changes the node half, declaration, and served client bytes as one commit.
- Old cached responses and old nodes are handled by the documented adapter without a parse failure.

## Verify before building

- Confirm `PluginsBridge.booted()` still exposes only `{ id, version }` and
  `PluginsBridge.installed()` still re-scans disk.
- Confirm `buildPluginStateBridge().clientBundle` still calls `readClientBundle(scanInstalled(...))`
  at request time.
- Confirm `pluginState()` still creates `installed` from the current disk entry even when `booted()`
  names another version.
- Confirm the reload host still has a candidate-then-commit point at which a complete active snapshot
  can be swapped.
- Confirm `NodePluginRow` additions must remain optional while persisted query responses can predate
  the field.
- Confirm no existing manifest field defines compatibility for a plugin's own private client-to-node
  routes; `apiVersion` remains the acorn plugin API contract.
