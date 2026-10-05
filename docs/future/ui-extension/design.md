# UI extension ownership and contracts

Status: implementation design, October 6, 2026. Implementation not started.
Baseline: `0ce874a15c856db07992cc5f7650b6730c6aadaf`. Editor file viewers land first.

This design governs the [phased programme](./README.md). Each feature adds a named place that its
owner draws. No contributor intercepts another plugin's document or replaces essential controls.

## Data flow

An owner selects a resource and projects bounded JSON facts. The host binds Node, task, project, and
mount identity. It resolves contributions from the running, enabled, device-accepted plugin roster.
Descriptors become host UI. A remote contribution runs in its own worker and emits validated kit
nodes. Binary or domain reads go through the contributor's own Node routes and declared capabilities.

The shared kit owns presentation and input semantics. Host modules own registries, attribution,
mounting, and transport. Plugins own domain data and decisions. The Tauri shell owns native pages.
Protocol is a pure contract package and imports no plugin. Keep those dependencies acyclic.

## Choose the mechanism

| Need | Mechanism |
| --- | --- |
| Actions in a menu | Extend context-menu locations and typed targets. |
| Marks on many visible objects | Batched annotations. |
| Records related to a pane | Footer rows. |
| Interactive UI made from kit nodes | Remote point, with compiled and loaded carriers. |
| A library that owns pixels | Host-placed rectangle or declared companion overlay. |
| A decision before an operation | Node hook, only if the feature actually needs a decision. |
| Document hover or diagnostics | Typed language-service routes, not remote editor widgets. |

Use `replace` for a single viewer and `stack` for bounded additions. Match keys follow each owner's
vocabulary. Exact, leading-star suffix, and trailing-star prefix matches have no specificity ranking.
Multiple replacements require the user's pick; the owner fallback draws while no pick resolves.
Generic defaults are owner children, not wildcard contributors that compete with specialized ones.

## Identity and access

Keep resource identity separate from a renderer key. A file is `{ taskId, path }` within the bound
Node, and `path` retains its original case. A basename or media type selects a renderer, not data.
Transcript media uses its stored kind and ID plus verified task/session ownership. Workflow bodies
use run and step identity, not the displayed step name. Selections carry an owner revision.

An ID is not a grant. Loaded client code cannot read another plugin's `/v1/p/` routes. A plugin's
Node half declares and calls a read capability, then exposes bounded results through its own route.
Do not share writable Editor or managed-agent bridges with viewers. Stored media stays immutable.

Contributions receive their own bridge and permissions. Host actions are declared on the point and
bound per mount; contributors cannot choose another mount or owner. Preserve person-only controls
for sends, gate answers, trust, destructive operations, and state replacement.

## Mounting and lifecycle

Remote cooperative trees are one level deep. The SDK `Slot` takes a host-minted `slotRef` only for
selected rail or topbar replacements. It does not accept a cooperative `point`. Loaded owners get
explicit outer host regions in phase 06, rather than arbitrary slot creation inside their trees.

Keep a mounted renderer stable while props change. Abort obsolete reads and reject late results
using Node, owner, resource, revision, and registration identity. Disposal removes workers, timers,
listeners, object URLs, overlays, and marks. Registration replacement must invalidate captured actions.

Mount remote trees only for visible or deliberately expanded content. Keep one link preview open.
Use visible-key batches for annotations. Add no worker, listener, or polling loop per hidden row.
The host owns viewport caps, scrolling, attribution, keyboard access, and fallback affordances.

## Compatibility and authoring

Keep plugin API major 3 for additive optional contracts unless a real incompatible change requires
otherwise. An older host may refuse a closed vocabulary it does not know; do not promise compatibility
from the major alone. Validate descriptors at Node parse and client arrival, and regenerate schemas.
Preserve persisted surface IDs, choices, layout state, hashes, and trust records.

Expose accepted props, match keys, actions, host support, unavailable owners, and invalid declarations
through `plugin_authoring` and **Settings > Advanced > Extension points**. Use the same registry for
execution and discovery. Bundle loaded examples through the published SDK, not private imports.

## Verification policy

Each phase runs focused tests while editing, then `pnpm lint`, its affected package suites and direct
consumers, and `pnpm --filter @acorn/arch-tests test` for contract or source-shape changes.
Phase 13 runs the complete gate and combined desktop and terminal flows.
Phase 14 completes reference and authoring documentation, checks executable examples, and reruns
documentation gates. Implementation phases maintain typed contracts, validation, discovery, and
test evidence; public prose is consolidated in the final phase before release.

## Verify before building

- Read `packages/protocol/src/chrome/extensionPoints.ts` and `packages/protocol/src/tree/nodes.ts`.
- Read `packages/client-core/src/host/tree/Slot.tsx` and its arbitration before adding a viewer.
- Read `packages/client-core/src/host/frames/scopes.ts` before adding any data access.
- Recheck the Editor identity and revision contract after its prerequisite implementation.
