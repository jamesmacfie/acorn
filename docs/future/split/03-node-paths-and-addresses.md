# Phase 3: respect which machine the Node is on

## Completion note

Landed October 14, 2026.

What changed:

- `pickNodeFolder(nodeId)` and `canPickNodeFolder(nodeId)` sit beside `canAddProjectFromFolder()` in
  `packages/client-core/src/features/workspaces/addProject.ts`. The picker opens only when that Node
  is local and the host has one. Otherwise it resolves null. `canAddProjectFromFolder()` now calls
  `canPickNodeFolder` for the active Node.
- Every Node-path caller uses it: **Add folder…** in `AddProjectControls.tsx`, **Change folder…** and
  **Add folder…** in `ProjectSettings.tsx`, the row's **Add folder** in `ProjectTable.tsx`, the GitHub
  importer, the onboarding wizard, and the Node target in `InstallPlugin.tsx`. That last one now
  takes `nodeId` in place of `nodeIsLocal`.
- `NodePathForm.tsx` is the typed path field `AddProjectControls.tsx` already had, moved out so the
  project page and the table row draw the same one. The project page shows it in place of the button.
  The row shows it after **Add folder** is pressed. `ProjectTable` owns the choice between picker and
  field, and its `mapFolder` prop became `(projectId, path) => Promise<boolean>`.
- `tools/arch/boundaries.test.ts` fails when anything but `addProject.ts` and `InstallPlugin.tsx`
  calls `pickFolder()`. The rule is in `docs/architecture/packages.md` § Runtime rules.
- `@acorn/plugin-api/client` exports `pickNodeFolder` and no longer exports `pickFolder`. No plugin in
  this repo or in the outside `~/Source/acorn-*` checkouts used it.
- Docker builds a copied port address from the remote Node's endpoint host
  (`plugins/docker/src/client/nodeAddress.ts`). A port bound to the remote Node's loopback copies
  `http://localhost:<port>` and says it's only reachable on that Node or through an SSH tunnel. The
  tooltip says the same. The copied exec command's notice names the remote Node to run it on. A local
  Node keeps `localhost` as before. `docs/docker.md` describes it.

Decisions and deviations:

- The doc asked for one function. There are two, because the installer and the project screens need
  a synchronous check to decide what to draw, and that check must name a Node that isn't always the
  active one.
- `pickNodeFolder` doesn't check that the active Node is unchanged after the dialog. Each caller
  already did, or now does, because a caller sends the path to the active Node, not to `nodeId`.
- The typed field in a table row has no cancel. It goes away once the folder saves or the page
  changes. A file browser on the Node stays out of scope.
- Docker uses the endpoint host, not the port's `hostIp`, for a port bound to a specific
  non-loopback address. That case stays as the doc described it.

Checked by hand with `pnpm dev:remote -- --session p3-check1`, with `window.acorn.folderPath.pick`
replaced by a function that counts its calls:

- Container Node: Overview showed the typed field and no **Add folder…**. The sample project's
  General tab showed the typed field and no **Change folder…** button. A Mac path returned "Directory
  does not exist." Typing `/srv/projects`, then `/srv/projects/sample`, saved each. The installer's
  **Local folder** offered **Choose…** for **This device** and not for the Node. The picker count
  stayed at zero.
- Local Node: **Add folder…** on Overview and **Change folder…** on a project page each opened the
  picker.
- The table row's typed field is covered by `ProjectTable.test.tsx`, not by hand. A project without a
  folder comes only from a GitHub import, and the auto-mode classifier refused clearing the path in
  the container's database.
- The Docker address wasn't checked by hand. The container Node has no Docker CLI or socket, so its
  Docker plugin has nothing to list. `nodeAddress.test.ts` covers the address and the loopback note.

The full `pnpm test` run had reds that also fail on the base commit 940b8c1db: the four arch-test doc
and logger checks, `cssHygiene` border radius, `toolFoldPrefs`, two `TerminalPanel` cases, the Node's
route golden list and plugin-disable pair, and the desktop boot bound. `mcpReviewProxy` flaked on both.
The rest passed when run alone.

For later phases:

- A new caller that needs a folder for a Node calls `pickNodeFolder`. A caller that needs a folder
  this device reads calls `pickFolder()` and must be added to the arch rule's list with its reason.
- Running Docker against the container Node needs a Docker socket or a Docker-in-Docker setup in the
  rig. Nothing in phase 2 provides one.

Date: October 14, 2026. Status: done. Verify with [phase 2](./02-remote-test-rig.md).

## Goal

No client sends a path from its own disk to a remote Node, and no client copies an address or a
command that only works on the Node's machine without saying so.

## Starting point

The platform seam's `pickFolder()` in `packages/client-core/src/infra/platform/index.ts` returns a
path on the client's machine. It doesn't know which Node the path is for. Each caller has to add the
check that the active Node is local, which `canAddProjectFromFolder()` in
`packages/client-core/src/features/workspaces/addProject.ts` does.

These callers check it:

- `packages/client-core/src/features/workspaces/AddProjectControls.tsx`
- `plugins/onboarding/src/client/OnboardingWizard.tsx`
- `plugins/github/src/client/GithubImporter.tsx`
- `packages/client-core/src/features/settings/plugins/InstallPlugin.tsx`, which also has a device
  target where a client path is correct

These callers don't:

- **Change folder…** and **Add folder…** in
  `packages/client-core/src/features/settings/ProjectSettings.tsx`
- **Add folder** in `packages/client-core/src/features/workspaces/ProjectTable.tsx`, which calls
  `mapFolder` in `packages/client-core/src/features/workspaces/WorkspaceProjectAssignments.tsx`

Neither screen offers a typed path for a remote Node, so a remote project can't change its folder at
all.

Docker has two smaller cases. `plugins/docker/src/client/ContainerDetail.tsx` copies
`http://localhost:<port>` and a `docker exec` command. `plugins/docker/src/client/ContainerInfo.tsx`
shows the same address in a tooltip.

## Changes

1. Add one function beside `canAddProjectFromFolder()` that picks a folder for a given Node. It
   returns nothing when that Node isn't local or the host has no picker. Have every Node-path caller
   use it, and keep `pickFolder()` for device paths only.
2. Add a check to `tools/arch/boundaries.test.ts` that only that function and the device target in
   `InstallPlugin.tsx` call `pickFolder()`. The bug class came from a caller forgetting a second
   check, so make forgetting fail a test.
3. Give **Change folder…** and **Add folder** the typed path field that `AddProjectControls.tsx`
   already has, shown when the picker isn't available for the Node.
4. In Docker, build the copied address from the host in the active Node's endpoint, which the fleet
   record in `packages/client-core/src/infra/node/fleet.ts` holds. When the port is bound to the
   Node's loopback, say that it's only reachable on that machine or through an SSH tunnel. When the
   Node is remote, have the exec toast name the Node the command must run on.

## Out of scope

A file browser that lists folders on the Node. The typed path covers the need, and a browser is a
larger design.

## Acceptance

- On the phase 2 container Node, no picker opens from any project or workspace screen, and each one
  offers the typed path instead.
- Typing `/srv/projects/sample` maps the folder. Typing a macOS path fails with the Node's own error.
- On the local Node, every picker still opens.
- Docker on the container Node copies an address that opens from the Mac when the port is published,
  and says why when it isn't.
