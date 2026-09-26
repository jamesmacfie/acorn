# Refused: shortcuts around node-provided UI lifecycle

Status: proposal record, 2026-09-26.

Part of [Node-provided UI](./README.md). These alternatives are plausible and some are smaller than
the programme. They are refused because they preserve or move the ambiguity that caused the audit
findings.

## Treat the package on disk as the running plugin

Refused. Routes, tables, jobs, worker realms, and registrations are committed into a node process.
Updating a directory does not update that process. A version comparison between `booted()` and
`installed()` can identify disagreement, but it cannot reconstruct the old declaration and bytes a
newly paired device needs. The running identity must be a snapshot in its own right.

## Let the highest installed version win across the fleet

Refused. A fleet is not one deployment unit. Node A may run 1.0 while node B runs 2.0, and neither
installed candidate says what the other process serves. One global winner either calls an older node
with a newer client or hides valid UI on the older node. Selection belongs to a node runtime; only the
active node's selected version is registered in the renderer.

## Declare all private plugin protocols compatible

Refused. `apiVersion` is the plugin's compatibility range with acorn's host API. It says nothing about
the plugin's own `/v1/p/<id>` request and response shapes. Exact runtime-to-client selection is the
safe baseline. A private wire range can be designed later from a real multi-version need.

## Always keep the previously accepted client after rejection

Refused as an unconditional rule. It is correct while the node still runs the matching previous node
half. It becomes a cross-version protocol gamble after the node restarts into the rejected version.
The UI must say which case applies and withhold loaded UI when no accepted client matches the active
runtime.

## Make rejection roll the node back

Refused. Device trust is per device, while installation is node administration shared by every paired
device. One device rejecting client bytes must not mutate the package on the node for everyone. A node
rollback remains an explicit owner action on the node, after which the runtime identity drives client
selection normally.

## Persist the selected winner

Refused. Node observations, active runtime, cache contents, and durable trust already determine the
answer. A persisted winner becomes stale after unpair, restart, rollback, revocation, or cache repair
and creates a fifth recovery policy. Recompute it into one in-memory distribution snapshot.

## Re-read every node continuously

Refused. Polling masks missing lifecycle inputs and scales work with fleet size even when nothing
changed. Reconcile on boot, first reachability, reconnect, source-aware plugin change, node switch,
pair, unpair, and trust transitions. A manual refresh can remain a recovery action, not the consistency
model.

## Route every inactive-node WebSocket frame to the active client

Refused. The active-node filter protects task, terminal, and stream identities from collisions.
Plugin lifecycle needs one narrow source-aware fleet control subscription before that filter. Widening
all event delivery would fix one missed signal by breaking a larger boundary.

## Key workers only by bytes because the code is identical

Refused. A content hash identifies code; it does not identify the principal running it. API namespace,
permissions, logs, trust, and stop lifecycle bind to a plugin id. Content files may deduplicate by hash;
live workers use `(pluginId, hash)`.

## Create one worker per tree forever

Refused as the main design. It avoids first-tree authority capture but loses shared plugin module state,
multiplies framework startup and memory, and makes scrolling restart work the current grace period was
designed to retain. One worker per principal bundle with slot-scoped services preserves both isolation
and reuse. One worker per tree is acceptable only as a compatibility adapter for an old unscoped wire.

## Trust the worker to name its tree

Refused. A plugin-chosen surface or slot string is a claim. The host creates the slot when it mounts a
tree, binds authority to it, and gives the scoped proxy only that value. Unknown and unmounted slots are
rejected. The same rule already protects `owner.invoke` and companion overlay requests.

## Keep the bundle bridge alive during revocation grace

Refused. The 30-second grace period is a rendering performance choice. It cannot extend an authority
the owner revoked. Revocation stops the worker principal and bridge immediately; ordinary zero-tree
unmount keeps the grace period.

## Use “not disabled” as plugin availability

Refused. Absence, boot failure, fresh install, unreachable node, and unknown initial state are all “not
disabled” and none proves that a route exists. Compiled requirements use active node-service state;
loaded contributions additionally require a matching accepted client selection.

## Hide every pending-restart plugin

Refused. A pending change may coexist with an old runtime that is still serving. Hiding it makes an
update, uninstall, or saved disable take effect halfway on the client before it takes effect on the
node. Availability follows the active identity and reports the pending candidate separately. A fresh
install with no active identity remains unavailable.

## Keep adding direct predicates to each registry

Refused. That is how settings, importers, and task footer slots diverged from panes and topbar entries.
Loaded ownership must imply the common availability gate, with `when` reserved for real contextual
predicates. A typed registration helper or owner metadata should make omission difficult.

## Move every plugin into the compiled tier

Refused. It would avoid distribution by putting more code into the application build, while giving up
the update, containment, and third-party boundaries the loaded tier exists to provide. The two tiers
are permanent. [compiled-tier.md](../compiled-tier.md) decides individual moves based on concrete
capability gaps.

## Move shell layout and focus into plugins

Refused. The problems here come from lifecycle identity, not from the shell owning too much. Layout,
focus, routing, placement, the closed kit, and persistence are what let node-provided UI remain
contained and project into desktop and terminal hosts consistently.

## Combine this programme with signing and discovery

Refused. Signing and discovery change how a package is found and attributed. They do not tell a client
which version a node process runs, which tree made a call, or whether a contribution is available.
[ecosystem/blockers.md](../ecosystem/blockers.md) owns those gates and can consume the corrected
lifecycle later.

## Break the published plugin API to simplify the tree wire

Refused within the current supported major. The public tree bridge can keep its method names while the
host and SDK add slot addressing. If an old wire cannot be adapted, isolate its trees in separate
workers until a plugin API major permits removal. Silent authority sharing is not an acceptable
compatibility mode.

## Verify before building

- Re-read [README.md](./README.md) and the applicable phase before reopening one of these decisions.
- Confirm the cited behavior still exists in `packages/node-core/src/server/pluginHost/state.ts`,
  `packages/client-core/src/host/plugins/distribution.ts`, or
  `packages/client-core/src/host/tree/workerHost.ts`; paths and constraints can change.
- Check [compiled-tier.md](../compiled-tier.md) and
  [ecosystem/blockers.md](../ecosystem/blockers.md) before moving adjacent work into this programme.
