# Phase 02: desktop chrome

## Completion note — October 7, 2026

Status: implemented on `phase-02-desktop-chrome`.

Follow-up review, October 7, 2026:

- Restored focus on the grouped selection bar's **New workspace name** input. A component test
  opens the move selector with a keyboard event, chooses **New workspace**, checks focus, and
  dismisses the form with Escape. The isolated grouped desktop session showed the same naming
  form in Overview; its screenshot was inspected and the session stopped.
- The fleet workspace resource now combines unavailable Nodes from workspace, preference, and
  project reads, once per Node. Resource tests cover a hidden-only off-mode row, a grouped-mode
  row on another Node, and missing required reads. The projects cache still receives an array.
- The service graph tool measured 3,144,464 B at `bf1143d08` and 3,166,786 B at phase 01 HEAD
  `79f7b77b7` in temporary source archives using the installed dependency tree. It found
  `datasets/store.ts` statically reachable through `projects.ts → workspaceRemoval.ts` only after
  phase 01. The phase 02 build before this review was 3,171,414 B. Deletion now loads the removal
  module before its synchronous transaction; project deletion, workspace link mappings, and
  workspace project ordering load on first request. The stock build and size check pass at
  **3,149,642 B / 3,150,000 B**. The archived measurements are useful for graph comparison but
  have different absolute paths from this checkout, so their byte counts are not exact same-path
  baselines. Row cleanup remains atomic and notifications run after commit.
- Focused client and Node route tests, touched typechecks, and the stock Node build pass. The
  desktop package staged and built successfully, then its test run reported 30 failures in five
  files: 11 assertions in `clientPluginDisable.test.ts`, plus 19 tests in `nativeApp.test.mjs`,
  `webdriver.test.mjs`, `helperServer.test.ts`, and `rendererConnection.test.ts` affected by
  process or loopback sandbox errors. The four affected files passed (22 tests) outside the
  sandbox; the desktop boot test passed there (10 tests). The two focused client-core ratchets
  still fail: `host/frames/scopes.test.ts` does not classify `workspaceProjectOrderRoute`, and
  `infra/styles/cssHygiene.test.ts` counts two box shadows. These are outstanding final-gate
  failures; this review did not establish them as pre-existing or unrelated.

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
- The initial verification used a local, uncommitted size-gate override for desktop sessions.
  The follow-up above removed that need. The native folder dialog is not exposed by the UI driver,
  so the second project was seeded into the isolated data root between desktop launches rather
  than chosen through that dialog. The folder write path has a jsdom test.
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
