# Phase 2: make plugin distribution an authoritative fleet state machine

Status: proposal, 2026-09-26. Not started. Waits on
[phase 1](./01-runtime-identity.md).

Part of [Node-provided UI](./README.md).

## Goal

Every paired node's plugin state converges after arrival, reconnect, switch, change, and removal.
Adding one node does not repin unrelated plugins. Removing a node removes its authority immediately.
Only one reconciliation publishes state at a time, and contribution registration observes one
complete snapshot rather than a sequence of partly updated signals.

## The current failure

`packages/client-core/src/host/plugins/distribution.ts` holds four module signals and updates them in
separate steps. Its fleet pass starts with the old `installedByNode` map, overwrites rows for nodes it
can currently reach, and resolves a global winner only when `activeBundles()` is null or a caller sets
`repin`.

`watchPluginChanges()` adds each reachable node to an `asked` set once. A later reconnect is ignored.
The WebSocket client drops ordinary frames from inactive nodes, so a plugin change there is not seen.
Switching the active node does not by itself reconcile distribution. Unpaired nodes are not removed
from the old map.

That produces four repeatable gaps:

1. **Late unique plugin.** Node A starts the session. Node B arrives later with plugin `reports`.
   The roster is cached, but the non-null global winner map is not extended. `reports` has no hash in
   `eligiblePlugins()` and its code contributions stay withheld until a repin or restart.
2. **Late higher version.** Node B arrives with a newer version of a plugin. It is ignored until an
   unrelated `plugins:changed` event repins every plugin, at which point several surfaces may move at
   once.
3. **Inactive change.** Node B updates while node A is active. Its event is filtered out. Switching to
   B can render from stale state for the rest of the session.
4. **Removed node.** A node is unpaired, but its last roster remains in `installedByNode`. Its bundle
   can continue to participate in global resolution.

Phase 1 removes the need for a global version winner by publishing the runtime each node actually
runs. This phase turns those runtime identities into one coherent client snapshot.

## Decision: one immutable distribution snapshot

Replace the independently updated module signals with one read-only snapshot and selectors over it.
Names are illustrative; the ownership is the decision.

```ts
type NodePluginObservation = {
  nodeId: string
  reachable: boolean
  observedAt: number
  generation: number
  rows: readonly NodePluginRow[]
}

type PluginSelection = {
  pluginId: string
  nodeId: string
  runtime: PluginRuntimeIdentity
  hash: string
  trust: 'accepted' | 'rejected' | 'pending'
}

type PluginDistributionSnapshot = {
  revision: number
  byNode: ReadonlyMap<string, NodePluginObservation>
  selectionsByNode: ReadonlyMap<string, ReadonlyMap<string, PluginSelection>>
  offeredCandidates: readonly OfferedPluginCandidate[]
  acceptedKeys: ReadonlySet<string>
  pendingTrust: readonly PluginTrustRequest[]
}
```

The state machine may keep mutable working data internally. Consumers see one snapshot replacement.
`eligiblePlugins()`, settings, trust UI, and availability selectors all read the same revision.

`activeBundles`, `installedByNode`, `acceptedBundles`, and `pendingTrust` may remain exported selector
functions during migration, but they must not remain independent sources of truth.

## Per-node selection

A selection belongs to `(nodeId, pluginId)`. Its runtime declaration and hash come from that node's
`active` identity from phase 1. This has several consequences:

- A second node cannot change the bundle selected for the first node.
- Two nodes reporting the same `(pluginId, hash)` share cached bytes and one trust decision.
- Two nodes running different hashes have different selections. The contribution host uses the
  selection for the active node and atomically re-registers on node switch.
- A node with an installed update still selects its old active identity. The update is an offered
  candidate and may be cached and reviewed, but it is not that node's runtime selection.
- A node with no active identity has no loaded contribution selection, regardless of what is on disk.

Contribution ids remain globally unique inside the renderer because only the active node's selection
set is registered. Persisted layout ids remain stable because namespacing still uses the plugin id,
not its version.

The terminal host follows the same selectors even though it projects fewer contribution kinds.

## Inputs to reconciliation

Every event that can change the answer enters the same queue with its source node where applicable.

| Input | Required action |
| --- | --- |
| Client boot or plugin host becoming available | Reconcile every paired, reachable node. |
| Node first becomes reachable | Read that node even when another snapshot already exists. |
| Node reconnects | Re-read that node; do not suppress it because it was read earlier. |
| `plugins:changed` | Re-read the node that emitted the event. |
| Active-node switch | Ensure the destination node has a current observation before publishing its selection as active. A retained fresh observation can make this immediate; a stale or absent one triggers a read. |
| Pair | Add the node and reconcile when reachable. |
| Unpair | Remove its observation and selections immediately, then remove the node from cache provenance. |
| Trust accept, reject, dismiss, or revoke | Recompute selection and pending state without re-reading every roster. Phase 3 defines the transition. |
| Device cache change or sweep | Recompute whether an advertised selection has usable local bytes. |

The general active-node WebSocket filter remains correct for task streams. Plugin lifecycle is a
fleet control channel and needs a source-aware subscription before that filter. This can be a narrow
`onPluginsChanged((nodeId) => ...)` hook on the node transport; it must not route every inactive
node's application events into active-node consumers.

Node status notifications already include a node id. Distribution subscribes directly to the status
source for first connect and reconnect rather than inferring both through an `asked` set.

## Reconciliation transaction

One serialized queue owns all state changes. A pass follows this order:

1. Capture the paired-node inventory and assign a monotonically increasing request generation.
2. Remove observations for nodes no longer paired. Mark paired offline nodes unreachable without
   turning their last known roster into an empty roster.
3. Read only nodes named by the event, or every reachable node for a full pass.
4. Validate each response and adapt legacy rows using phase 1's conservative rules.
5. Fetch missing active and offered candidate bundles through device custody. The locally computed
   hash remains authoritative.
6. Read trust decisions once.
7. Purely derive per-node selections, offered candidates, pending requests, and diagnostics.
8. Discard the result if a later generation superseded it or its node was unpaired while I/O was in
   flight.
9. Publish one immutable snapshot.
10. Re-register contributions once when the effective selection set for the active node changed.

An implementation may coalesce queued events by node id. It may not run two publishing passes in
parallel. A slow response from node A must not overwrite a newer response from A or resurrect an
unpaired node.

## Winner stability

The current “pin once, repin everything” rule is removed. Stability comes from explicit state:

- A node's accepted selection stays selected while it remains that node's active runtime and the
  device's decision remains accepted.
- A newly observed plugin id adds a selection without touching existing ids.
- A changed runtime hash creates a candidate transition for that `(nodeId, pluginId)` only.
- Trust changes affect every node offering the exact same `(pluginId, hash)` because the consent key
  is device-wide.
- A disappeared runtime removes only selections that depended on it.

No unrelated plugin event can change another plugin's selection. A full reconciliation may discover
several real changes, but each diff is attributable to a changed observation, trust decision, or
paired-node inventory.

## Offline and stale observations

Offline is different from absent. Keep the last valid observation for a paired offline node so
Settings can explain what was last known and the cache does not churn. Mark it unreachable and do not
use it to serve an active-node surface.

On switch to an offline node, normal fleet behavior prevents that node becoming active. If the shell
has a transitional state in which the id is selected before reachability settles, loaded contributions
remain unavailable until a fresh read succeeds.

Unpaired is different again. Delete the observation, selections, and node provenance immediately.
`PluginCache.forgetNode(nodeId)` may leave content-addressed bytes until the normal retention sweep;
it removes the node's claim without making unpairing depend on file deletion.

## Failure handling and diagnostics

A transient roster read failure retains the last valid observation and marks it stale. It does not
replace it with an empty list. The snapshot records enough diagnostic state for Settings or telemetry
to distinguish:

- node unreachable;
- roster request failed;
- advertised bundle missing;
- bundle hash mismatch;
- runtime incompatible with this client API major;
- trust pending or rejected; and
- no active runtime.

Only the hash mismatch is a security refusal. The others are operational states. None may cause the
state machine to execute or register unaccepted bytes.

## Code touched

- `packages/client-core/src/host/plugins/distribution.ts`: state machine, immutable snapshot,
  reconciliation queue, and selectors.
- `packages/client-core/src/host/plugins/reload.ts`: source-aware event wiring; remove `asked` and the
  global `repin` branch.
- `packages/client-core/src/infra/node/wsClient.ts`: a narrow fleet plugin-change subscription that
  preserves the source node before active-node filtering.
- `packages/client-core/src/infra/node/fleet.ts` and `activeNode.ts`: pair, unpair, reachability, and
  switch inputs.
- `packages/client-core/src/host/plugins/contributions.ts`: select declarations from the active node's
  distribution snapshot.
- `packages/client-core/src/host/plugins/syncContributions.ts`: sync once after snapshot commit.
- `packages/custody/src/plugins/pluginCache.ts`: node provenance removal remains separate from byte
  retention.
- The terminal client's plugin distribution adapter, so desktop and terminal share the state
  transition rules rather than only the storage classes.

Keep pure resolution and transition functions outside Solid effects. Effects observe fleet inputs and
enqueue work; they do not contain the policy.

## Tests

### Pure state transitions

- An empty snapshot plus node A creates only A's selections.
- Adding node B with a unique plugin adds it without changing any A selection.
- Adding node B with a higher version of A's plugin does not change A's selection; B selects its own
  running hash.
- Updating one runtime changes only that `(nodeId, pluginId)` candidate.
- Removing B deletes its observations and selections and preserves A.
- An offline read failure retains B's last observation as stale; an unpair removes it.
- An old reconciliation result cannot overwrite a newer generation.

### Event integration

- First connect, reconnect, active-node switch, and source-aware `plugins:changed` each enqueue the
  expected node read.
- A change from inactive node B is not sent to task-stream subscribers but does reconcile B's plugin
  observation.
- Concurrent events coalesce or serialize and publish one final snapshot.
- A node unpaired while its request is in flight is not resurrected by the response.

### Registration integration

- A late unique plugin becomes available as soon as its node becomes active; no global repin or
  renderer restart is needed.
- Switching A → B → A with different plugin hashes produces B's registration set and then restores
  A's exact set.
- An unchanged effective selection publishes fleet metadata without disposing and rebuilding the
  registries.

The full scenarios and real-host pass are in
[06-test-matrix-and-rollout.md](./06-test-matrix-and-rollout.md).

## Docs owed

- `docs/architecture-overview.md`: fleet plugin data flow and source-aware control events.
- `docs/plugins/activation.md`: per-node selection and reconciliation triggers.
- `docs/caching.md`: retained stale observations, query cache interaction, and bundle provenance.
- `docs/security.md`: a node claim versus a device-computed hash and why inactive node events are a
  narrow control channel.
- `docs/tui/chrome-and-plugins.md`: shared distribution rules and terminal projection.
- `docs/testing.md`: multi-node lifecycle coverage.

## Done when

- There is no `asked` set and no boolean that repins every plugin winner.
- Every paired-node lifecycle event enters one serialized reconciliation queue with a source id.
- `eligiblePlugins()` and the trust UI read one distribution snapshot revision.
- A late node, inactive-node update, reconnect, switch, and unpair each converge without a renderer
  restart or an unrelated plugin event.
- No stale async response can restore old or unpaired state.

## Verify before building

- Confirm `syncPluginDistribution()` still starts from `new Map(installedByNode())` and only calls
  `resolveActiveBundles()` for a null pin or `repin`.
- Confirm `watchPluginChanges()` still records a node in `asked` once and does not respond to its
  reconnect.
- Confirm the node transport still drops inactive-node frames before `plugins:changed` reaches its
  subscriber.
- Confirm active-node changes do not currently force a plugin distribution read.
- Confirm `PluginCache.forgetNode()` removes provenance without deleting still-retained bytes.
- Confirm all contribution registries can dispose and register a complete replacement set after one
  snapshot commit.
