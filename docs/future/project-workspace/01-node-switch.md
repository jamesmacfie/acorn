# Phase 01: Node switch

## Completion note — October 7, 2026

Status: implemented on `phase-01-node-switch`.

- Review follow-up (October 7, 2026): `core.workspaces` validation and its write now run together
  in the synchronous preference transaction shared by HTTP and the raw plugin service seam. The
  first write, same-value write, and legacy-project fallback use the same rule. Off mode refuses
  explicit workspace membership even when re-adding an existing project path; plain re-adds remain
  idempotent. The CLI's HTTP decoder is tested with a 409 Node error envelope. Driver parsers cover
  both flag values, invalid values, and onboarding conflicts. Repeat desktop seeding reads the bound
  owner ID after identity adoption, preserving one preference row and the saved mode on `--reuse`.
- Follow-up checks: Node `workspacesMode.test.ts` (6) and `core/prefs.test.ts` (2), CLI `node.test.ts`
  (4) and `commands.test.ts` (6), desktop `options.test.mjs` (3) and `seed.test.mjs` (4) all pass.
  Typechecks for `@acorn/node-core`, `@acorn/cli`, `@acorn/desktop`, and `@acorn/tui` pass; oxlint
  passes on changed TypeScript files. The full repository gate was not rerun for this follow-up.
- The protocol owns `core.workspaces` and its unset-value rule. Node project creation settles the
  preference, inserts a project, and creates either its own workspace or Default in one transaction.
  Routes and the plugin project seam use the active owner ID. Broadcasts follow commit.
- The Node refuses explicit membership, project moves, and workspace create, rename, and delete while
  off. The rename refusal is an extra guard so a paired workspace cannot diverge from its project.
  Project rename and delete keep that pair in sync; deletion removes links and datasets.
- The CLI accepts `project add` without `--workspace`, resolves `agent list` and `run list`
  `--project` filters, and reports `workspaces_off` as a usage error. Both dev drivers pass
  `--workspaces on|off` to the seed. The `tui-navigation` fixture creates a second paired workspace
  while off and retains its grouped layout with `--workspaces on`.
- The grouped Default fallback now lives inside the project transaction rather than calling the old
  `defaultWorkspaceId` helper. Its observable behavior is unchanged. The preboot seed writes the
  preference under the empty owner ID; Node boot adopts it into the bound owner as it does other
  preferences. Subsequent seed calls use that bound owner.
- Later phases should read `core.workspaces` through the protocol helper, omit explicit workspace IDs
  from project creation while off, and account for the existing workspace-scoped records that both
  workspace and project deletion leave behind. The desktop and terminal UI still use grouped-mode
  controls until their phases land.
- Initial focused Node, CLI, protocol, and seed checks passed; the CLI and protocol package suites
  passed. Three Node 26 storage backup tests timed out, including when run alone. Their cause remains
  unresolved for the final combined gate. The architecture doc check reported three missing
  generated Tauri schema files cited by the security plan; that check is pending desktop staging.

Date: October 7, 2026. Status: implemented. Dependencies: none.
Read the [plan](./README.md) first, especially [decisions](./README.md#decisions) 1 to 5 and
[facts from the code](./README.md#facts-from-the-code).

## Deliverable

The Node knows whether workspaces are on or off, and enforces one project per workspace while they're
off. A new project gets its own workspace, a project rename renames its workspace, and a project
delete removes its workspace. The CLI works without workspace IDs. The dev seed can start a session
in either mode. No desktop UI changes in this phase.

## Steps

1. Add the preference key `core.workspaces` and a pure function in `packages/protocol` that takes the
   stored value and the Node's project count and returns `on` or `off`. An unset value means `on`
   when projects exist and `off` when none do. Export the key and the function for the Node and the
   clients.
2. Give `createProject` and `createProjectRef` in `packages/node-core/src/server/projects.ts` a way to
   read and write that preference. Settle how they reach the owner ID first. See
   [verify before building](#verify-before-building).
3. In `createProject` and `createProjectRef`, when the preference is unset, write it in the same
   transaction as the new project. Use the function from step 1 with the project count before the
   insert.
4. While off, a create with no workspace inserts a workspace named after the project and puts the
   project in it, in the same transaction. Broadcast `workspace:changed` for the new workspace. A
   create that names a workspace returns 409 `workspaces_off`.
5. While on, keep the fallback to `defaultWorkspaceId` exactly as it is.
6. While off, `patchProject` refuses a `workspaceId` change with 409 `workspaces_off`. A `name`
   change also renames the project's workspace and broadcasts `workspace:changed`.
7. Move the cleanup steps out of the workspace delete route in
   `packages/node-core/src/server/routes/projects/workspaces.ts:148` into one function. The steps are:
   delete external project links, delete datasets, delete the row, and broadcast the events. Keep the
   move to Default in the route, so it only runs while workspaces are on.
8. While off, project delete calls that function for the project's workspace after `deleteProject`.
   Nothing moves to Default.
9. While off, refuse `POST /v1/core/workspaces` and `DELETE /v1/core/workspaces/:id` with 409
   `workspaces_off`. `POST /v1/core/workspaces/bootstrap` returns the list without creating Default.
   Write messages that say what to do: "Workspaces are off on this Node, so each project has its own.
   Add a project instead."
10. In the CLI, make `--workspace` optional on `project add` (`apps/cli/src/coreWrites.ts:106`,
    `apps/cli/src/args.ts:51`). The Node decides where the project goes.
11. Add `--project ID` to `agent list` and `run list`. The CLI looks up the project's workspace and
    calls the existing workspace-filtered routes. Refuse it alongside `--task` or `--workspace`, the
    same way `apps/cli/src/commands.ts:60` refuses `--task` with `--workspace`.
12. Check that the CLI prints the Node's 409 message for `workspace create`, `workspace remove`, and
    `project move`, with a usage-style exit code.
13. Add `--workspaces on|off` to `apps/desktop/scripts/agent/seed.ts`. It writes the preference before
    the seed creates its project. Pass it through `pnpm dev:agent` and `pnpm dev:tui:agent`.
14. Update the docs that own this behavior:
    - `docs/workspaces-and-tasks.md` § Workspace and project: the mode, and one project per workspace
      while off.
    - `docs/workspaces-and-tasks/projects.md`: where a new project goes in each mode, the refusals,
      and delete.
    - `docs/cli.md` and `docs/cli/workspaces-projects-tasks.md`: the optional `--workspace`, the
      `--project` filters, and the refusals.
    - `docs/local-development.md`: the seed flag.

## Acceptance

- Node route tests in `packages/node-core` cover:
  - Create with no workspace in each mode.
  - Create that names a workspace while off.
  - The unset preference settling to `on` with existing projects and `off` with none.
  - Rename sync while off.
  - Project delete removing the workspace, its links, and its datasets while off.
  - Each 409 refusal and its message.
  - `/bootstrap` creating no Default while off.
- Existing workspace route tests pass unchanged while on.
- CLI tests cover `project add` without `--workspace`, the `--project` filters and their conflicts,
  and the refusal messages.
- `pnpm lint`, `pnpm test --filter=@acorn/node-core`, `pnpm test --filter=@acorn/protocol`, and the
  CLI package's suite pass. Run `pnpm --filter @acorn/arch-tests test` for the doc changes.

## Verify before building

- How `createProject` reaches the owner ID. It takes only `db`, because projects are machine-scoped.
  Options are `runtime.ACTIVE_IDENTITY`, passing `ownerId(c)` from the route, or reading the single
  owner row. The plugin seam in `packages/node-core/src/server/core/projectRefs.ts:88` and the dev
  seed call it without a request, so the answer has to work for them too.
- Whether `PUT /v1/core/prefs` should refuse writes to `core.workspaces` once it's set, so a client
  can't flip the mode by hand. The plan treats the mode as fixed.
- Which other plugin tables carry a `workspace_id`. The delete confirmation in phase 02 lists what's
  left behind.
- How `pnpm dev:agent` passes arguments to the seed.
