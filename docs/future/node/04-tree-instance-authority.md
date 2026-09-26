# Phase 4: route remote-tree authority through the mounted tree

Status: proposal, 2026-09-26. Not started. Waits on
[phase 0](./00-worker-identity.md). It can proceed alongside phases 1 to 3.

Part of [Node-provided UI](./README.md).

## Goal

One plugin bundle can draw several remote trees in one worker without the first mounted tree lending
its task, project, node, document, focus, or selection to the others. Every host effect whose answer
depends on a visible tree is addressed to that tree's host-owned slot and is rejected after that slot
unmounts.

The worker remains shared for code and plugin module state. Authority is per principal and per mounted
instance.

## The current failure

`workerHost.ts` creates one bridge port and calls `connect()` once for a live worker.
`RemoteTree.tsx` supplies that callback. Its `FrameBinding`, `createFrameServices()` instance, initial
context, `container`, and optional document accessor all close over the first `RemoteTree` component
that acquired the worker.

Later trees from the same `(pluginId, hash)` share that bridge. The accessors are live, but they are
live accessors into the first component only. They do not identify the tree that made a bridge call.

This is already reachable in a first-party plugin. Linear declares a task pane, a project pane, and a
reference panel with the same remote entry. The tree calls `bridge.ui.openUrl()`. If a second Linear
tree is visible, its call is checked against the first tree's container and scope. It can be denied for
lacking focus even when the clicked tree has focus. If the first component unmounts while another tree
keeps the worker alive, the bridge retains its stale container and binding.

The same shape affects more than links:

- API calls are pinned to the first tree's node id;
- `openPane` and `openDestination` use the first task id;
- keybinding resolution tests the first task and surface;
- a composed-pane document can be granted to a tree that has no document, or withheld from one that
  does;
- state and subscriptions can follow the wrong node lifecycle; and
- `postSelect()` sends an unaddressed bundle-wide message, so every listener in that worker can observe
  a selection intended for one tree.

`owner.invoke` and `overlay.open` already avoid this problem. They travel as
`tree:host-request` messages with a host-minted slot, and `workerHost.ts` dispatches them to a handler
registered for that slot. That is the pattern to extend.

## Decision: every mounted tree gets a scoped bridge proxy

The plugin-facing API remains `bridge.api`, `bridge.ui`, `bridge.state`, and the existing event
callbacks. The object supplied to a tree mount is a proxy bound to that mount's slot. Every request it
sends carries the host-minted slot internally.

The worker may continue to use one transport port for the bundle. The wire is logically:

```ts
type ScopedBridgeRequest = {
  kind: 'bridge:request'
  slot: string
  id: number
  group: 'api' | 'state' | 'ui' | 'document' | 'subscribe'
  operation: string
  payload: unknown
}
```

The exact envelope should reuse the existing broker schemas rather than introduce an untyped parallel
protocol. The settled decisions are:

1. the worker cannot choose or forge a slot; it receives one with a mount;
2. the SDK object handed to that mount adds the slot to every request;
3. the host resolves services from that slot at call time;
4. an unknown or unmounted slot receives a bounded public error;
5. replies carry both request id and slot so two mounts cannot cross-settle promises; and
6. unmount rejects outstanding requests and removes subscriptions for that slot.

The existing per-slot tree channel can carry these requests, or the bridge port can become
slot-addressed. Use one request dispatcher either way. Do not keep a second implementation of API and
UI policy beside `frames/broker.ts`.

## Per-slot host record

`workerHost.ts` already has a `Slot` record. Extend it or associate it with a host-owned authority
record:

```ts
type TreeAuthority = {
  pluginId: string
  hash: string
  surface: string
  nodeId: string
  scope: { taskId?: string; projectId?: string; item?: string }
  frameHasFocus(): boolean
  document?: DocumentGrant
  navigate(to: string): void
  ownerActions: OwnerActions
  declaredActions: readonly string[]
}
```

The record is created by the `RemoteTree` that owns the container and updated when reactive scope
changes. The plugin receives data such as task id and selected item through its mount context; it never
receives the authority record or a way to widen it.

`pluginId`, accepted hash, surface id, and permission snapshot come from the selected distribution
entry, not from props that a plugin controls. `nodeId` comes from the surface owner. It must not be an
ambient lookup performed later inside a bundle-wide bridge.

## Effect classification

All calls made through a mounted tree carry a slot, even when the implementation uses only
principal-level data. This gives uniform cleanup and attribution.

| Effect | Authority read from |
| --- | --- |
| `api` and `api.bytes` | Plugin permission snapshot plus the slot's pinned node id. |
| `state.get` and `state.set` | Plugin key namespace plus the slot's node or device state owner. |
| `subscribe` | Plugin event grants plus slot lifecycle and pinned node where the channel is node-backed. |
| `openPane` and `openDestination` | Slot task id and declared destination allowlist. |
| `openUrl` | Slot task/project scope, surface target, navigator, focused container, and gesture policy. |
| `copy`, overlay opening, importer completion, and close | Slot surface kind, focus or gesture where required, and owner callbacks. |
| `document.read`, `write`, and `flush` | The document grant on that exact composed-pane slot. |
| Keydown forwarding | Slot plugin id, surface id, and whether that slot's task is active. |
| `owner.invoke` | Existing slot action handler and declared action names. |
| Toast and logging | Plugin principal plus slot attribution; no extra scope grant. |

Appearance is a bundle-wide host-to-plugin broadcast and can remain on the bundle channel. Bundle
shutdown and bridge-version negotiation are also bundle-wide. Everything about a selected item,
surface command, task, project, focus element, document, or owner action is instance-addressed.

## Host-to-plugin addressing

The same rule applies in the other direction:

- initial context is sent with `tree:mount`, not once with bundle connection;
- a later selection names the target slot;
- a surface action names the mounted slot or a host-resolved set of target slots;
- unmount cancels that slot's listeners before the slot id can be reused; and
- appearance may broadcast because it is intentionally common to every tree in the worker.

The plugin SDK exposes each selection only to the callback registered by the target mount. A plugin
can still share it through its own module state, but the host does not broadcast it accidentally.

Slot ids are unique for the lifetime of a worker generation. A monotonic counter is sufficient. If a
worker restarts, outstanding messages from the old generation are rejected by the closed port.

## Focus and gesture proof

`RemoteTree` remains the only component that can identify its rendered container. It registers:

- `frameHasFocus`, based on that container;
- the last pointer or keyboard gesture time for that container; and
- teardown that removes capturing listeners.

The broker reads these functions for the requesting slot. A call from background module code with no
live mount has no slot and is denied. A call using a slot after unmount is denied. Sharing a worker
does not turn a gesture on tree A into authority for tree B.

## Document authority

Document access is structural: only a remote region mounted beside a host editor gets a document
grant. The grant belongs on the slot. A bundle with one document region and one settings or reference
tree may use both in the same worker; only the first can issue document calls successfully.

The accessor stays live so independent region mount order works. Removing the document region updates
or removes the grant before any later request is handled.

## Compatibility

The public SDK method names do not need to change. The worker bootstrap and remote-tree SDK need a
wire revision that creates one proxy per mount.

Before choosing the migration, inspect how older published SDK bundles negotiate
`PLUGIN_BRIDGE_VERSION`:

- if the host can adapt an old bridge internally, do so and keep one worker;
- otherwise run an old-protocol bundle in one worker per mounted tree, which restores correct
  first-tree binding at a resource cost; and
- remove that compatibility path only with a plugin API major that permits old bundles to stop
  loading.

Do not let an old unscoped bundle share one bridge across concurrent trees. Refusing a second mount is
safer than sharing authority, but per-tree isolation provides a better compatibility path if the
worker bootstrap supports it.

The desktop and terminal share `workerHost.ts`, so the wire migration is implemented once. Each host
still supplies its own focus, navigation, clipboard, and overlay capabilities.

## Code touched

- `packages/protocol/src/tree/messages.ts`: scoped bridge request, reply, context, selection, and
  cancellation messages with existing size limits.
- `packages/protocol/src/plugin/bridge.ts`: wire revision or negotiation.
- `packages/plugin-sdk/src/remote/public.ts` and its published declarations: one bridge proxy per mount with
  no public method-name change.
- `packages/client-core/src/host/tree/workerHost.ts`: slot authority registration, dispatch, cleanup,
  and host-to-plugin addressing.
- `packages/client-core/src/host/tree/RemoteTree.tsx`: register its own binding, container, scope,
  document, navigator, and initial context instead of connecting the bundle bridge from the first
  component.
- `packages/client-core/src/host/frames/broker.ts` and `frameServices.ts`: reuse policy with a scoped
  service resolver rather than copying it.
- `packages/client-core/src/host/tree/TreeHost.tsx`: pass mount context and targeted pushes where it
  owns them.
- `apps/tui/src/plugins/RemoteTree.tsx`: supply terminal slot services through the same contract.
- `plugins/linear/src/tree/app.tsx`: no product behavior change; use it as the real multi-surface
  fixture.

## Tests

- Mount Linear's task pane and project pane in either order. A link from each uses its own task or
  project routing and focus element.
- Unmount the first tree while the second remains. The second keeps working and the first slot is
  refused.
- Mount two task-scoped trees for different tasks. `openPane`, destination opening, keydown, state, and
  API requests remain pinned to the caller's task and node.
- Mount one composed document tree and one settings tree from the same bundle. Only the document slot
  can read, write, or flush.
- A gesture in tree A cannot authorize `openUrl` or overlay opening from tree B.
- A selection and surface action reach only the named mounted tree.
- Appearance reaches every mounted tree once.
- Requests in flight during unmount settle with the documented public error and cannot update a reused
  slot.
- Limits remain per slot where documented and per worker where documented.
- Run equivalent routing tests through the TUI worker adapter.

## Docs owed

- `docs/plugins/descriptors-for-facts-trees-for-ui-rectangles-for-pixels.md`: per-mount bridge context.
- `docs/plugins/client-authoring-and-the-ui-kit.md`: SDK behavior for multiple trees.
- `docs/plugins/frames.md`: instance versus bundle effects.
- `docs/security.md`: slot authority and document/focus isolation.
- `docs/shell.md`: worker and bridge transport.
- `docs/tui/chrome-and-plugins.md`: terminal projection.
- `docs/testing.md`: multi-tree acceptance cases.

## Done when

- No tree-sensitive service closes over whichever `RemoteTree` connected the worker first.
- Every plugin-to-host tree call is attributable to a live host-minted slot.
- Selection, context, and surface actions are delivered only to their intended mount.
- A bundle can concurrently render trees with different tasks, projects, nodes, focus elements, and
  document grants without cross-use or false denial.
- Older supported SDK bundles are either adapted or isolated per tree; none share an unscoped bridge.

## Verify before building

- Confirm `acquireTreeWorker().connect` still runs once per worker and `RemoteTree.tsx` still creates
  the bridge, services, and initial context inside that callback.
- Confirm the binding's getters, focus closure, document accessor, query client, and navigator still
  come from the first component.
- Confirm `postSelect()` still sends no slot and worker-side listeners cannot distinguish the intended
  tree.
- Confirm `tree:host-request` already carries a slot and enforces per-slot request bounds.
- Confirm Linear still declares three remote surfaces with the same entry and calls
  `bridge.ui.openUrl()` from that shared tree implementation.
- Confirm the published plugin SDK compatibility promise before choosing a bridge migration path.
