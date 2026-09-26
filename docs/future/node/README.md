# Node-provided UI: runtime identity and lifecycle correctness

Status: proposal, 2026-09-26. Nothing here has started.

This programme is about the UI that a node's installed plugins contribute to a client. It is not a
general rewrite of the Node runtime. The shell still owns layout, routing, focus, persistence, the
closed UI kit, and every privilege boundary. A node still supplies manifests, data, and client
bundles; accepted client code still runs in a worker or sandboxed frame.

The audit behind this programme found that those boundaries are sound, but the lifecycle joining
them is not yet sound for a changing fleet. The current client often treats five different facts as
one:

1. a package is on a node's disk;
2. a particular package version is running in that node process;
3. a client bundle is cached on this device;
4. this device accepted that exact `(pluginId, hash)` pair; and
5. contributions from that bundle are registered in this renderer.

They happen to agree after a clean start with one node and one plugin version. They separate after
an install, update, rejection, reconnect, node switch, failed load, or a second tree from the same
bundle. The result ranges from missing UI to a worker receiving the wrong plugin identity.

The programme makes each fact explicit and derives the next one from it. It preserves the current
security and product model rather than adding a new rendering tier.

Where this folder and an owning document under `docs/` disagree after a phase ships, the owning
document wins.

## Current architecture

The renderer is a host for UI from several owners, not a downloaded application shell. As of the
audit date:

- `apps/desktop/src/client/plugins.ts` composes 12 client plugins into the desktop build;
- `apps/desktop/scripts/build-bundled-plugins.mjs` stages eight loaded plugin packages that travel
  through the same cache and trust path as an owner-installed package; and
- `apps/node/src/composition/plugins.ts` composes the node's built-in plugin set and the loader adds
  packages from the node data root.

Those counts are evidence for 2026-09-26, not an architectural target. The permanent distinction is
between compiled contributions that are part of a client build and loaded contributions whose
manifest and bytes arrive from a node.

The loaded path crosses these owners:

1. node composition loads a package, wires its node half, and exposes plugin state through the core
   API;
2. the device broker reaches that node without giving the renderer a token or filesystem path;
3. device custody fetches and hashes the client bytes, stores them content-addressed, and reads the
   device's trust decision;
4. client distribution combines per-node observations with custody state;
5. the contribution host namespaces the accepted manifest and registers disposable descriptors;
6. the shell draws facts itself, renders a closed remote tree from a worker, or places a sandboxed
   frame for plugin-owned pixels; and
7. the shell continues to own layout, focus, routing, persistence, and fallback when a contribution
   is absent or fails.

The implementation gaps are at the joins between those owners. The rendering boundaries themselves
remain the design this programme protects.

## What the audit found

| Priority | Finding | User-visible or security consequence | Plan |
| --- | --- | --- | --- |
| P0 | Tree workers are cached by bundle hash alone although bridge authority is bound to a plugin id. | Two plugin ids with identical client bytes share the first plugin's bridge identity and API namespace. | [00-worker-identity.md](./00-worker-identity.md) |
| P0 | Fleet resolution chooses the highest installed client bundle while a node may still run an older node half. | A newer manifest and client can call private routes or rely on behavior the active node has not loaded. | [01-runtime-identity.md](./01-runtime-identity.md) |
| P1 | The first successful fleet read freezes bundle winners for the session; later nodes, reconnects, switches, and removals do not reconcile reliably. | A valid plugin can remain absent, a stale node can keep winning, or an unrelated plugin event can unexpectedly change all winners. | [02-fleet-distribution.md](./02-fleet-distribution.md) |
| P1 | A new untrusted winner displaces an accepted old winner before the owner decides. Rejecting or dismissing it does not restore the old contribution set. Revoking a dev grant does not synchronously unregister code contributions. | UI disappears during an update and the dialog's “keep previous version” promise is false; revoked code can remain live until another sync. | [03-trust-transitions.md](./03-trust-transitions.md) |
| P1 | One bridge is connected for a whole worker, but its scope, document access, focus element, and initial selection come from the first tree that mounted it. | A second tree from the same bundle can be denied a valid action, inherit another tree's authority, or receive an unscoped selection. | [04-tree-instance-authority.md](./04-tree-instance-authority.md) |
| P2 | Presence, enabled state, running state, and failure state are represented by several incomplete predicates. Some loaded surfaces have no node-availability gate. | Failed plugins can still appear available; settings pages, importers, and footer slots can remain visible or call routes that do not exist. | [05-contribution-availability.md](./05-contribution-availability.md) |

The focused suites passed during the audit: 129 client tests and 61 node tests. That is evidence that
the tested local contracts hold. The fleet, update, and multiple-tree combinations above do not
currently have coverage. [06-test-matrix-and-rollout.md](./06-test-matrix-and-rollout.md) turns those
combinations into acceptance tests and describes the compatible rollout.

## Invariants to preserve

These are strengths of the current design. A phase that weakens one is wrong even if it fixes its
local symptom.

- Trust stays keyed to the exact `(pluginId, hash)` pair, and the device computes the hash from bytes
  it holds.
- The shell owns layout, focus, routing, placement, host state, and the UI kit.
- A plugin manifest is data. Contribution ids are namespaced once by the host.
- Remote trees use the closed node vocabulary and run in a worker. Rectangles remain sandboxed
  frames. Neither runs in the shell's own module graph.
- Node and client state remain per node. An ambient active node id is not allowed to turn a
  fleet-wide fact into a device-wide one.
- Contribution registration remains disposable and repeatable. Reconciliation may replace a
  registration set without reloading the renderer.
- Compiled plugins and loaded plugins remain two permanent tiers. This programme does not move a
  plugin between them for structural tidiness.

## The lifecycle after this programme

The words below have one meaning throughout the phase files.

| Fact | Owner | Meaning |
| --- | --- | --- |
| Installed candidate | Node process, from disk | The manifest and bundle currently present on disk. It may need a restart before any node code uses it. |
| Running identity | Node process, from its boot snapshot | The plugin id, version, manifest or declaration snapshot, and client hash that match the node half actually serving requests now. |
| Cached bundle | Device custody | Bytes held locally and addressed by their locally computed hash. Caching grants no authority. |
| Trust decision | Device custody | The decision for one exact `(pluginId, hash)` pair. It does not select a fleet winner by itself. |
| Accepted winner | Client distribution | The compatible, accepted bundle selected for a plugin id under the fleet policy. A pending candidate is separate. |
| Registration | Renderer registries | The disposable contribution set created from the accepted winner. It changes only after an atomic selection transition. |
| Availability | Client, per node | Whether the matching running identity can serve a contribution on a particular node now. |

The intended data flow is:

```text
node boot snapshot + disk candidate
                 │
                 ▼
     per-node runtime identities
                 │
                 ▼
     fleet candidate reconciliation ──► device cache
                 │                         │
                 └──────────────┬──────────┘
                                ▼
                    exact-hash trust decision
                                │
                                ▼
                      accepted active winner
                                │
                  ┌─────────────┴─────────────┐
                  ▼                           ▼
       disposable registrations     per-node availability
                  │                           │
                  └─────────────┬─────────────┘
                                ▼
                         visible contribution
```

The host must be able to explain every visible contribution with that chain. It must also be able to
say which link withheld a contribution without executing its code.

## The files

| File | What it decides |
| --- | --- |
| [00-worker-identity.md](./00-worker-identity.md) | The immediate worker cache-key correction and the identity invariants around content deduplication. |
| [01-runtime-identity.md](./01-runtime-identity.md) | The protocol and node model that separate what is installed from what is running. |
| [02-fleet-distribution.md](./02-fleet-distribution.md) | The authoritative fleet state machine, event inputs, stable winner policy, and stale-node pruning. |
| [03-trust-transitions.md](./03-trust-transitions.md) | Candidate, accepted winner, fallback, rejection, dismissal, and revocation as atomic transitions. |
| [04-tree-instance-authority.md](./04-tree-instance-authority.md) | Per-tree routing for focus-, scope-, selection-, and document-sensitive effects. |
| [05-contribution-availability.md](./05-contribution-availability.md) | One per-node availability model and gates for every loaded contribution kind. |
| [06-test-matrix-and-rollout.md](./06-test-matrix-and-rollout.md) | Cross-product tests, protocol compatibility, delivery slices, telemetry, and rollback. |
| [refused.md](./refused.md) | Attractive alternatives this programme rejects, with the reason. |

## Delivery order

| Phase | Delivers | Waits on |
| --- | --- | --- |
| 0 | Worker identity keyed by `(pluginId, hash)` and a regression test. | Nothing. It is a contained correction and should land first. |
| 1 | An explicit running identity beside the installed candidate in the node protocol. | Nothing beyond the current activation contract. |
| 2 | A serialized, authoritative fleet distribution state machine. | Phase 1, because it must resolve what nodes run rather than infer it from disk. |
| 3 | Accepted-winner trust transitions with reliable fallback and revocation. | Phase 2, because selection belongs inside the distribution state machine. |
| 4 | Per-tree authority routing for the remote-tree bridge. | Phase 0. It can proceed alongside phases 1 to 3. |
| 5 | Uniform per-node contribution availability and missing gates. | Phase 1. It should use running identity rather than add another temporary predicate. |
| 6 | Full scenario matrix, compatibility rollout, real-window and multi-node acceptance. | The behavior phases it verifies. Tests are added with each phase; this closes the programme. |

Phase 0 is deliberately small. Phases 1 through 3 form one chain and should not be reordered. Phase
4 is independent after the worker key is correct. Phase 5 can begin when the runtime identity exists,
but its final tests need the fleet state machine.

## Relationship to other future work

This programme owns lifecycle correctness for node-provided plugin UI. It links to adjacent work
rather than absorbing it:

- [compiled-tier.md](../compiled-tier.md) decides which compiled plugins could move to the loaded
  tier and records the missing contribution kinds that block them.
- [contribution-kinds.md](../../contribution-kinds.md) owns the shipped inventory of contribution
  kinds. Integration flows, rail markers, and search providers still need loaded-manifest twins;
  session sources, client schedules, persisted state, and client capabilities remain compiled.
- [ecosystem/blockers.md](../ecosystem/blockers.md) owns signing, discovery, and update provenance.
- [client-plugins/](../client-plugins/README.md) owns plugins installed on a device with no node half.
  If that programme ships, it consumes the accepted-winner model but has a different availability
  source.

## What this folder does not do

- It does not make every UI surface plugin-owned.
- It does not add arbitrary HTML, CSS, keyboard handling, or shell access to remote trees.
- It does not make private client-to-node routes compatible across plugin versions by assumption.
- It does not solve signing, discovery, automatic updates, or plugin marketplace policy.
- It does not hot-reload a node half whose routes, tables, and jobs were wired at process start.
- It does not remove the compiled tier.
- It does not schedule any work.

## Programme acceptance

The programme is complete when all of these are true:

1. A contribution shown against node A is derived from the identity node A is actually running and
   uses the client hash selected for that runtime.
2. A later node arrival, reconnect, switch, unpair, update, or failure produces a deterministic
   reconciliation without waiting for an unrelated plugin event.
3. An untrusted update cannot displace the accepted version. Rejection, dismissal, and revocation
   each leave the renderer in the documented state immediately.
4. Two plugin ids with identical bytes never share authority, while multiple trees from one accepted
   bundle share code safely and keep their instance authority separate.
5. Every loaded contribution kind is hidden or disabled when its matching node runtime is unavailable.
6. The multi-node and multi-tree matrix in phase 6 passes, along with `pnpm lint`, `pnpm test`, the
   desktop boot test, and the real Tauri checks named there.
7. The final phase moves each shipped contract into its owning documentation and records any
   deviation from this proposal.

## How to work a phase

Each phase begins by running its verify list. Paths here were checked on 2026-09-26 and are clues,
not promises. Implement the smallest vertical transition, update its focused tests and owning docs in
the same change, then run the broader gates from phase 6. Do not add a second state model beside the
one this programme defines to make an individual registry pass.

## Verify before building

- Confirm `docs/architecture-overview.md` still assigns layout and plugin custody to the client and
  routes, jobs, tables, and node plugin activation to the node.
- Confirm `packages/node-core/src/server/pluginHost/state.ts` still builds one response from
  `installed()`, `booted()`, `roster()`, and `loadFailures()`.
- Confirm `packages/client-core/src/host/plugins/distribution.ts` still owns `installedByNode`,
  `pendingTrust`, `activeBundles`, and `acceptedBundles`.
- Confirm `packages/client-core/src/host/plugins/contributions.ts` still chooses the manifest row by
  the active bundle hash before namespacing contributions.
- Confirm `packages/client-core/src/host/tree/workerHost.ts` still owns one worker map and
  `packages/client-core/src/host/tree/RemoteTree.tsx` still connects its bridge.
- Re-run the focused audit suites listed in [06-test-matrix-and-rollout.md](./06-test-matrix-and-rollout.md)
  before treating the baseline counts in this file as current.
