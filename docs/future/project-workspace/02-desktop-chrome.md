# Phase 02: desktop chrome

Date: October 7, 2026. Status: planned; implementation not started. Dependencies: [phase 01](./01-node-switch.md).
Read the [plan](./README.md) first, especially [decisions](./README.md#decisions) 3, 5, and 8.

## Deliverable

With workspaces off, the desktop topbar, folder picker, and Settings treat each project as the top
level. With workspaces on, nothing changes. Wording outside these surfaces is
[phase 05](./05-wording.md).

## Steps

1. Add a client accessor for the mode in `packages/client-core/src/features/workspaces/`, beside
   `activeWorkspace.ts`. It reads `prefsOptions` and `projectsOptions` and calls the function from
   phase 01. Export it through the feature's public file.
2. Add the mode to `TopbarProps` in `packages/protocol/src/chrome/surfaces.ts:55`. Fill it in
   `apps/desktop/src/client/App.tsx` where `topbarProps` is built.
3. In `packages/client-core/src/host/chrome/Topbar.tsx`, while off:
   - The left picker reads **Project**, and its placeholder and empty text say "projects".
   - Each row's project-count description goes away, because every count is one.
   - The second project picker never shows. `projectPickerVisible` is false.
   - **Add project…** stays in the picker footer.
4. In `addProjectFromFolder` (`packages/client-core/src/features/workspaces/addProject.ts:14`), pass no
   workspace while off. Drop the "already in another workspace" toast while off, and say "already
   added" instead.
5. In Settings → Overview (`WorkspaceProjectAssignments.tsx` and `ProjectTable.tsx`), while off:
   - Show one flat table with no workspace groups and no **Unassigned** group.
   - Remove the move action and the **New workspace** option from the selection bar. Hide and color
     stay.
   - Remove the **Add workspace** control.
6. Remove workspace pages from the Settings navigation while off. Find the entries through
   `workspaceSettingsTarget` in `packages/client-core/src/host/registries/shell/settings.ts`.
7. On a project's settings page, remove the workspace field while off.
8. On a connection's page in Settings → Services (`ConnectionProjectMap.tsx`), pick a project instead
   of a workspace while off. Write the project's workspace with no `projectId`, because the workspace
   holds one project.
9. Change the project delete confirmation while off. It names the task count, as it does today, and
   says the project's Home boards, notes, saved queries, and workflow definitions go with it.
10. Update the docs that own this behavior:
    - `docs/ui-design/shell-hierarchy.md`: the topbar in each mode.
    - `docs/frontend/settings-groups.md` § Workspaces and projects: Settings in each mode.
    - `docs/plugins/replacing-core-surfaces.md`: the new `TopbarProps` field.

## Acceptance

- jsdom tests in the `client-core` hosts project cover:
  - Topbar labels and picker visibility in each mode.
  - The flat Overview table and its selection bar while off.
  - The workspace field missing from the project page while off.
  - The folder picker passing no workspace while off.
- Existing Settings and topbar tests pass unchanged while on.
- In `pnpm dev:agent -- --session pw-chrome --workspaces off`, a snapshot shows **Project** in the
  topbar. Adding a folder creates a second entry in the picker, and Settings → Overview shows a flat
  table.
- `pnpm lint`, `pnpm test --filter=@acorn/client-core`, `pnpm test --filter=@acorn/protocol`, and
  `pnpm --filter @acorn/desktop test` pass.

## Verify before building

- Whether any first-party plugin provides its own topbar, and needs the new field.
- How `fleetWorkspaces.ts` labels entries from other Nodes. A fleet can mix modes, and the plan says
  the label follows the active Node.
- What `Workspace.projects` includes for a hidden project. A workspace whose only project is hidden
  should drop out of the picker while off.
