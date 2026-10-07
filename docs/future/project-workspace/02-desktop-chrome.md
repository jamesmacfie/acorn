# Phase 02: desktop chrome

## Completion note — October 7, 2026

Status: implemented on `phase-02-desktop-chrome`.

- The active Node's `core.workspaces` preference and project count drive one client mode accessor. It
  returns no mode until both reads arrive. The desktop topbar contract passes that mode to core and
  replacement providers. Off mode uses one **Project** picker and omits workspace membership from
  folder creates; grouped mode retains both pickers where appropriate.
- Fleet picker rows read each Node's preference and full project list. A paired workspace with only
  hidden projects is omitted while that Node is off. The fleet projects query returns the same array
  shape as the active Node's shared `projectsKey`; an earlier object-shaped read caused a renderer
  error and was corrected during real-app verification.
- Settings Overview is flat while off, with Hide and colour but no workspace creation or move.
  Project pages appear directly in Settings navigation and omit the workspace field. Connection
  targets show project names and write workspace-wide mappings without `projectId`. Project deletion
  warns that its workspace, links, and datasets are removed; Home boards, notes, saved queries, and
  workflow definitions remain stored but become inaccessible. Folders and worktrees remain on disk.
- Focused jsdom tests for the changed surfaces pass (46 tests across nine files). Protocol tests
  pass (295), architecture docs and links pass (87), and scoped client-core, protocol, and desktop
  typechecks pass. Oxlint passed on the touched areas. The off-mode `pw-chrome` desktop snapshot
  showed a **Project** picker, two isolated projects, a flat Overview, and no project workspace
  field; screenshots were inspected. The grouped `pw-chrome-on` snapshot showed **Workspace**,
  Default's group row, and **New workspace**. Both sessions were stopped.
- The stock Node service build is 3,171,414 B against its 3,150,000 B gate. For isolated desktop
  verification and desktop package tests, the gate was raised locally and then restored without a
  committed change. The client-core package suite has two unrelated failing ratchets:
  `host/frames/scopes.test.ts` lacks phase 01's `workspaceProjectOrderRoute`, and
  `infra/styles/cssHygiene.test.ts` counts two existing shadows. The desktop package test has stale
  plugin contribution expectations in `clientPluginDisable.test.ts`; loopback and process tests
  failed under the macOS sandbox, then passed when only those tests were rerun unsandboxed. The boot
  test and affected Rust loopback tests likewise passed unsandboxed. The native folder dialog is not
  exposed by the UI driver, so the second project was seeded into the isolated data root between
  desktop launches rather than chosen through that dialog. The folder write path has a jsdom test.
- Later phases can use `createWorkspacesMode` from the workspaces feature. Its `undefined` state is
  intentional; controls that write workspace membership should wait for a resolved mode. A mixed
  fleet filters picker rows by each row's Node mode but labels the picker by the active Node.

Date: October 7, 2026. Status: implemented. Dependencies: [phase 01](./01-node-switch.md).
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
