# Phase 0: bind every tree worker to a plugin identity

Status: proposal, 2026-09-26. Not started. Waits on nothing.

Part of [Node-provided UI](./README.md). This is phase 0 because it is a contained authority bug and
does not need the protocol or fleet redesign.

## Goal

A tree worker and its bridge always belong to the exact plugin id whose accepted bytes started it.
Identical JavaScript bytes may share content storage, but they never share runtime authority across
plugin ids. Revocation or an authority replacement can stop a worker immediately instead of leaving
its bridge live during the normal idle grace period.

## The current failure

`packages/client-core/src/host/tree/workerHost.ts` stores live workers in:

```ts
const workers = new Map<string, Live>()
```

`acquireTreeWorker()` looks up that map with `input.hash`. `start()` calls `input.connect()` only for
the first acquisition, and that callback creates a bridge bound to `input.pluginId`.

Two plugin packages can deliberately contain the same client file. This needs no SHA-256 collision:
an empty remote-tree entrypoint, a shared scaffold, or a copied bundle is enough. If plugin `alpha`
mounts first and plugin `beta` has the same bytes, `beta` receives `alpha`'s existing worker and
bridge.

The consequences are authority errors, not only lifecycle oddities:

- the broker identifies requests as `alpha`;
- the automatic API allowlist includes `/v1/p/alpha` rather than `/v1/p/beta`;
- permission and surface checks use the first plugin's binding;
- logs and refusal accounting name the first plugin; and
- stopping or idling one logical plugin affects the other.

Trust is already keyed by `(pluginId, hash)`. The worker identity must use the same pair.

## Decision: separate content identity from principal identity

The device bundle cache remains content-addressed by hash. It is safe and useful for identical bytes
to occupy one file.

The live worker map is keyed by a typed principal identity:

```ts
type TreeWorkerKey = { pluginId: string; hash: string }
```

The implementation can use a nested map or one canonical encoder. It must not concatenate strings
with an ambiguous delimiter. All lookup, insertion, grace-timer comparison, heartbeat stop, explicit
stop, and test cleanup paths use the same key helper.

`pluginWorkerUrl(hash)` remains hash-addressed. Creating two `Worker` instances from the same URL is
expected: they load the same code into separate principals and receive separate bridge ports.

## One worker per plugin bundle

Within one `(pluginId, hash)` pair, keeping one worker is still the right policy:

- framework and plugin module state are shared across that plugin's trees;
- tree mount messages already carry slots;
- the heartbeat and resource ceilings apply to one accepted bundle; and
- scrolling a tree out and back can reuse the warm worker.

[04-tree-instance-authority.md](./04-tree-instance-authority.md) changes which effects may use the
bundle-wide bridge. It does not create one worker per tree.

## Authority invalidation

The current 30-second zero-reference grace period is a performance policy. It is not an authority
policy. Unmounting the final tree after trust revocation can leave plugin timers and the bridge alive
until that grace expires.

Add an explicit host operation that stops a principal immediately:

```ts
stopTreeWorker({ pluginId, hash }, reason)
```

Use it when:

- the exact trust decision is revoked;
- a development grant invalidates the exact acceptance;
- the accepted selection is replaced with a different authority snapshot under the same bytes; or
- the plugin is uninstalled from the only provenance that allowed it to remain selected.

Ordinary UI unmount still uses the grace timer. A node switch may retain an accepted worker if its
authority snapshot remains valid and no surface is mounted; revocation may not.

Stopping closes the tree and bridge ports, disposes the bridge, terminates the worker, rejects or
fails outstanding slot requests with the existing public error shape, and removes exactly the matching
map entry. A late handle from an old generation cannot stop a newer generation with the same key.

## Cache metadata

`packages/custody/src/plugins/pluginCache.ts` may continue storing one JavaScript file per hash. Its
index currently has singular `pluginId` and `version` metadata even though the content can be
referenced by more than one plugin id. Before changing the schema, inspect every consumer:

- if those fields are display-only hints, make that explicit and ensure no authorization reads them;
- if provenance is shown or used for retention, model references as a set of
  `(pluginId, version, nodeId)` records; and
- preserve the existing cache file and retention behavior during migration.

This metadata normalization is not allowed to delay the worker-key correction. No cache index field
is a runtime authority source.

## Code touched

- `packages/client-core/src/host/tree/workerHost.ts`: composite key helper, every map access and stop
  path, and immediate principal invalidation.
- `packages/client-core/src/host/tree/workerHost.test.ts`: identical-hash/different-plugin regression,
  generation-safe timers, and explicit invalidation.
- `packages/client-core/src/host/plugins/syncContributions.ts` or the phase 3 distribution commit:
  invoke immediate invalidation for withdrawn accepted selections.
- `packages/custody/src/plugins/pluginCache.ts` and its tests only if the consumer audit proves its
  singular provenance metadata is observable or authoritative.
- `apps/tui/src/plugins/workerFactory.ts`: no separate cache logic, but its adapter exercises the
  shared worker host and must pass the same tests.

## Tests

- Acquire `alpha` and `beta` with identical bytes and hash. Two workers and two `connect()` calls are
  created; each bridge sees its own plugin id.
- Mount two trees for `alpha` with the same hash. They reuse one worker.
- Acquire the same plugin id with two hashes. They use two workers and stopping one does not affect the
  other.
- Release `alpha`, acquire `beta`, then fire `alpha`'s grace timer. `beta` remains alive.
- Release an old generation and acquire a new generation with the same composite key. The old timer
  cannot stop the new worker.
- Revoke an accepted key while its final tree is mounted and while it is in grace. Both paths dispose
  the bridge and terminate immediately.
- Verify that `allowApi` for the identical-byte pair admits only each plugin's own namespace.
- Run the shared worker host through the terminal adapter as well as the browser `Worker` stub.

## Docs owed

- `docs/plugins/activation.md`: one worker per accepted plugin bundle identity and immediate stop on
  revocation.
- `docs/security.md`: content deduplication versus principal isolation.
- `docs/shell.md`: worker key and authority lifecycle.
- `docs/tui/chrome-and-plugins.md`: the shared worker host inherits the same identity rule.
- `docs/testing.md`: identical-byte and revocation regression coverage.

## Done when

- No live-worker lookup is keyed by hash alone.
- Two plugin ids with identical bytes have different workers, bridge ports, API namespaces, logs, and
  stop lifecycles.
- The normal idle grace period cannot preserve authority after trust revocation.
- Content-addressed caching still stores the identical bytes once and grants nothing by itself.

## Verify before building

- Confirm `workers`, `start`, `stop`, `release`, heartbeat failure, and `_stopAllTreeWorkers` still use
  the hash as their worker-map identity.
- Confirm `input.connect()` still runs only when a worker is first created and captures the plugin id
  in the broker binding.
- Confirm `allowApi` still derives the plugin's own route namespace from that binding.
- Confirm the terminal imports the shared `workerHost.ts` rather than maintaining another worker map.
- Confirm `PluginCache` is content-addressed and audit whether its singular plugin metadata has any
  authority consumer before changing its schema.
