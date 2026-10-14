# Phase 3: respect which machine the Node is on

Date: October 14, 2026. Status: proposed. Verify with [phase 2](./02-remote-test-rig.md).

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
