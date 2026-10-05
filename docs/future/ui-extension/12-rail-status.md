# Phase 12: add source and pane status annotations

Status: planned, October 6, 2026. Baseline: `0ce874a15c856db07992cc5f7650b6730c6aadaf`.
Depends on phase 11. Task status keeps using the shipped `core:task` point.

Let loaded plugins supply status marks for consenting rail sources and task panes. Use the shared
annotation transport and host legend rather than another rail-only route or remote subtree.

## Starting point and owners

`packages/client-core/src/host/annotations/taskAnnotations.ts` supplies loaded task marks.
`packages/client-core/src/host/annotations/annotations.ts` owns batches and invalidation.
`packages/client-core/src/features/tabs/TabRail.tsx` draws source/task rail controls.
`packages/client-core/src/features/tasks/PaneSwitcher.tsx` draws task pane controls.
`apps/tui/src/chrome/Rail.tsx` draws terminal rail state.
The compiled `railMarkers` contribution remains supported; it is not a loaded-plugin grant.

Read [annotations](../../plugins/rows-and-annotations.md),
[rail status](../../ui-design.md#rail-controls-and-status-markers), and
[core replacements](../../plugins/replacing-core-surfaces.md).

## Contract

Core owns `core:source`, annotation key `{ sourceId: 'string', projectId: 'string' }`, and
`core:pane`, annotation key `{ paneId: 'string', taskId: 'string' }`.
The viewed Node belongs to the host batch identity, not a key supplied by the contributor.
Source project IDs follow the routed project, with an empty string only for a declared Node-scoped
source. Panes target real task pane registrations, not arbitrary surface strings.

Add optional `statusAnnotations: true` to source descriptors and task-pane descriptors/compiled
contributions. This is the owner's consent to participate. Reject it on settings, project panes,
overlays, and other targets. Request marks only for visible consenting registrations, and accept
marks only for those requested keys. Owner disabled/untrusted state clears marks as contributor state does.

Return ordinary severity/text/icon marks through the contributor's own batched `items` route.
Accept at most 256 marks per contributor. Merge with owner status and compiled markers using the
host's deterministic legend ordering. Preserve all accepted labels in accessibility and the tooltip
even when the icon has no spare corner. No remote tree or per-icon request is created.

## Steps

1. Add typed points, owner opt-in descriptor fields, Node/client validation, schemas, and discovery.
   Preserve `core:task`, legacy compiled markers, and persisted rail identity.
2. Add source and pane batch owners beside rail composition. Deduplicate visible keys and clear
   immediately on project/task/Node, owner roster, or contributor registration changes.
3. Draw host marks without intercepting selection, drag, pinning, menus, or task notification state.
   Use the shared accessible legend and severity mapping in desktop and terminal.
4. Add normalized accepted marks to the data projection for rail/pane-switcher replacements. A
   selected replacement can draw that host data; contributors do not gain access to its private tree.
   Keep the default provider as fallback on replacement failure.
5. Opt one shipped source and one task pane into annotations and add a loaded fixture targeting them.
   Do not silently opt every owner in. Record which owners consented and why.

## Tests and acceptance

Extend annotation, TabRail, pane-switcher, and terminal tests. Cover opt-in absent, unknown targets,
disabled owner, same IDs on two Nodes, routed-project changes, closed tasks, more marks than corners,
malformed responses, late reads, contributor reload, and selected core replacement failure.
Count transport calls for many icons and prove one batch per contributor/key set, not one per icon.

Run `pnpm lint`, full suites for `@acorn/protocol`, `@acorn/node-core`, `@acorn/client-core`,
`@acorn/tui`, each owner plugin that opted in, affected declaration packages, and architecture.
Expect exit zero. Check source and pane marks in both real hosts and a rail replacement; ensure
menus still work without selecting their icon and every mark remains in the accessible legend.

Complete when loaded providers annotate only consenting visible owners, default and replacement rails
receive consistent data, and no status mark changes another plugin's state or authority.

## Verify before building

- Recheck source scope, pane IDs, and replacement data projection in the live rail contracts.
- Recheck the legacy marker ordering before merging accepted annotations.
- Stop if owner consent cannot be represented explicitly or requires another plugin's private tree.
