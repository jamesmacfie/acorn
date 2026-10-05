# Phase 07: separate task editing from rail composition

Completion note, October 6, 2026: **done**. `taskDraftStore.ts` owns one dialog's editable fields,
resources, availability identity, mutation guard, and submission lifecycle. `TaskDraftDialog.tsx`
renders that model. `TabRail.tsx` captures the origin Node and project options when opening it and
keeps navigation, source/row menus, order, drag, hierarchy, and keyboard registration. Creation,
its setup notification, and rename can target the captured Node through the existing task mutation
path. The held-response and right-click integration tests passed. Live desktop verified folder,
branch, and linked-worktree creation, rename, and conflict clearing; TUI verified its separate task
setup and rail. [Phase 07 evidence](./evidence.md#phase-07-rail-task-editing-2026-10-06) records
gates and host output. Phase 08 can proceed without changing task payloads or rail menu IDs.

Date: 2026-10-04. Status: DONE. Risk: medium; reactive scope and asynchronous validation matter.
Prerequisite: accepted [phase 06](./06-import-cycles.md). Next: [phase 08](./08-agent-composer.md).
Planning revision: `2ae55abb5`; use current feature locations from the preceding handoff.

## Task and context

Make the rail readable by extracting its task creation/rename responsibility. The audited
`packages/client-core/src/features/tabs/TabRail.tsx` had 750 lines. It combines five query families,
menus, drag and lineage, task editing, resources, keyboard registration, and UI. Existing order,
visibility, source, marker, and drag modules are already useful seams; keep them.

Task editing begins with Node-scoped queries and a captured project choice, derives branch inputs,
checks worktree availability, and submits through the current task bridge. The rail remains the
composition owner for visible tasks, sources, navigation, menus, and drag.

## Starting points and invariants

- `packages/client-core/src/features/tabs/TabRail.tsx`, `TabRail.test.tsx`, `BranchOptions.tsx`.
- Adjacent `createRailDrag.ts`, `railOrder.ts`, `railVisibility.ts`, `railSources.ts`, `railMarkers.ts`.
- Task bridge calls, project queries/config reads, worktree and branch endpoints referenced there.
- [Tasks](../../workspaces-and-tasks.md), [state ownership](../../state-ownership.md),
  [shortcuts](../../command-palette-and-shortcuts.md), and [frontend](../../frontend.md).

Preserve dialog project snapshots across workspace switches, untouched vs explicitly edited branch
names, exact vs derived availability request keys, pending/conflicting submission guards, and the
current fail-open behavior when the availability request fails. Server validation remains authoritative.
Preserve setup opt-out/reset, folder/existing-worktree modes, rename/icon behavior, and error display.

## Implementation steps

1. Trace every draft field and resource in the live rail. Make an ownership table: dialog-local
   state, captured origin Node/project, live query data, persistent preferences, and mutation state.
   Identify cleanup and every await that could complete after navigation or a new dialog.
2. Extract a feature-owned reactive task draft model and a `TaskDraftDialog.tsx` component (new
   files beside the rail; adapt names to existing owners). The model exposes typed state/actions;
   the dialog renders fields and submits. Pass the captured origin and narrow read/mutation ports
   explicitly, or use the existing scoped bridge consistently. Do not duplicate query caches.
3. Move branch derivation and submission eligibility rules together. Use pure helpers only for
   actual pure rules. Keep Solid resources/effects in the dialog's owner and dispose them with it.
   Handle stale validation results by the same request identity as before.
4. Keep rail rendering, source selection, hierarchy, menus, ordering, and shortcuts in their current
   owners. Wire dialog open/close/rename through a small typed boundary. Register callbacks once per
   rail owner and remove them on disposal; avoid re-registering on every query update.
5. Retain tests at observable boundaries. Existing rail tests cover hover prefetch, drag, descendants,
   markers, setup choice, and worktree validation. Move only dialog-specific fixtures to a dedicated
   component test if that improves clarity; keep rail-to-dialog wiring covered.
6. Add a held-request case only if absent: switch workspace/Node or reopen a dialog while availability
   is pending, then resolve the old response. Prove it cannot submit the wrong origin/branch.
7. Inspect actual desktop and TUI behavior. In an isolated fixture project, create each supported task
   mode, rename, change branch, and try conflict/pending validation. Exercise rail navigation, hover,
   descendant collapse, drag, keyboard shortcuts, and source/row context menus.

## Verification

```sh
pnpm test:focus @acorn/client-core src/features/tabs/TabRail.test.tsx
pnpm lint
pnpm test --filter=@acorn/client-core --filter=@acorn/tui --filter=@acorn/desktop
pnpm --filter @acorn/arch-tests test
```

Also run the new dialog test file if introduced. Start `pnpm dev:agent -- --session trim-07`, then
`pnpm dev:agent:ui -- --session trim-07 snapshot`; use returned references and inspect screenshots.
Start `pnpm dev:tui:agent -- --session trim-07-tui --fixture tui-navigation` and its UI driver.
Resize to 120×40 and stop both sessions. Follow [local development](../../local-development.md).
Right-click must not change selection or start dragging; Escape/outside click and focus return remain.

## Acceptance and handoff

- Reading the rail reveals composition and rail behavior; task form state/commands have one named owner.
- Existing and new tests prove unchanged task payloads, branch guards, origin custody, and rail behavior.
- Real-host task/edit flows pass and are recorded. Persistent keys, routes, menu IDs, and kit use remain.
- No generic form framework, broad barrel, or duplicated global state is introduced.
- Record module responsibilities, tests, and screenshots in task/table/evidence. Rollback restores the
  dialog extraction and wiring together; no migration or production task deletion is required.

## Verify before building

Re-read current dialog state, task bridge, query scope, context menus, and phase 06's identities.
Stop if extraction requires a new task contract or changes availability policy; plan that separately.
