# 17: Housekeeping

This proposal collects small structural fixes that don't need their own proposal, plus three naming
decisions the owner should make.

Date: October 11, 2026. Status: proposed. Depends on: nothing. Each item stands alone. Part of the
[cleanup programme](./README.md).

## Fixes

**Group node-core's loose files.** `packages/node-core/src/server/` holds 29 loose files.
`docs/conventions.md` asks for a group above twelve. Ten of them are about projects and workspaces,
and would read better as one folder:

- `projects.ts`, `projectConfig.ts`, `projectDeletion.ts`, `repoConfigSnapshot.ts`,
  `repoConfigTrust.ts`, and `runConfig.ts`.
- `workspaceImages.ts`, `workspaceProjectOrder.ts`, `workspaceRemoval.ts`, and `workspacesMode.ts`.

Move them, keep the exports map paths that other packages use, and update imports.

**Call the terminal plugin through a capability.** `apps/node/src/composition/composition.ts` calls
`reconcileTmux`, and `apps/node/src/composition/runtime.ts` calls `refreshAcornMcpRegistrations`, both
imported from the terminal plugin's entry. Agents and workflows reach the composition root through
capabilities instead: `AGENTS_RUNTIME` and `WORKFLOWS_RUNNER`. Give the terminal plugin a capability
for its reconcile step. Registering Acorn's MCP server with Claude and Codex is a job for core or the
agents plugin, not the terminal. Move it to whichever owns the harness profiles.

**Share `isRecord`.** Eleven files define the same `isRecord` guard, four of them inside node-core:
`packages/node-core/src/server/integrations/codec.ts`, `packages/node-core/src/server/plugins/manifest.ts`,
`packages/node-core/src/server/plugins/rpcValues.ts`, and `packages/node-core/src/server/schedules/nodeAction.ts`.
Keep one per package that can't import another's. The loaded plugins `http` and `sentry-telemetry`
may keep their own copies.

**Name `createHelper`'s file for what it is.** `packages/custody/src/index.ts` holds the 333-line
`createHelper`, the desktop helper's composition. It isn't an entry point. The exports map reaches it
through `packages/custody/src/runtime/public.ts`. `docs/conventions.md` says `index.ts` exists only
as an entry point, so rename the file, for example to `helper.ts`.

**Name the single-viewer event transport for what it is.** `packages/node-core/src/server/transport/wsViewers.ts`
calls the default viewer `legacy`. It isn't legacy: the terminal client and the CLI always connect
that way, and only the desktop helper turns on viewer multiplexing. Rename it, for example to
`single`.

**Remove the local `plugins/changes/` folder.** On the investigation machine, `plugins/changes/`
holds only build output, `dist`, `node_modules`, and `.turbo`, left from before Changes moved into
Git. Git doesn't track it, so each developer with a stale checkout deletes it by hand. Mention it in
the commit or note that ships the move.

## Decisions for the owner

**The `claude` and `claude-code` ID pair.** A session row names its harness twice, as `providerId`
and `profileId`. The two match for every harness except Claude Code, where the harness ID is `claude`
and the profile ID is `claude-code`. See `plugins/agents/src/server/drivers/harness.ts`,
`plugins/agents/src/server/harnessRegistry.ts`, and `plugins/agents/src/server/customAgents.ts`. The
names predate the harness seam. Both are stored in `acorn-1` session rows and appear in workflow
files in repositories as a step's `profile`. Unifying them needs a data migration and accepting both
spellings in workflow files for a while. Decide whether the one-off mapping is worth that cost.

**The recoverable reset.** `scripts/db-reset.mjs`, `scripts/reset/run.mjs`, `scripts/reset/inventory.mjs`,
and `apps/desktop/src-tauri/src/reset_stage.rs` with its page come to about 700 lines. They were built
for the September 24 crossover to `acorn-1`. `docs/local-development.md` still documents them as the
way to reset a data root, and the Node's old-schema error points at them. Decide whether to keep them
as the reset tool or replace them with a simpler "move the data root aside" instruction.

**Commands without a `kind`.** `packages/client-core/src/host/registries/commands/commands.ts` keeps a
union member with no `kind`, so registrations written before September 3 still type-check. It is the
default action shape every registration uses. Keep it as the action shape and change its comment,
or add `kind: 'action'` to every registration. The first is cheaper.

## Acceptance

Each fix lands as its own commit with `pnpm lint` and the touched packages' suites passing. Each
decision is recorded in the owning reference page, or as a follow-up proposal if it needs work.
