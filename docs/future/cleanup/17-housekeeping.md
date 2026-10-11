# 17: Housekeeping

> **Completion note, October 12, 2026.** All five code fixes landed, one commit each, and the three
> decisions are recorded in their reference pages. `pnpm lint`, the arch tests, and the touched
> packages' suites pass on Node 26.8.1 after each commit. `pnpm test` passed 35 of 36 packages. The
> red was the `PreviewTaskPane.test.tsx` case "binds same-ID task reads to the originating Node",
> which proposals 13 and 15 saw fail under load. This branch doesn't touch the preview plugin, and
> its suite passed twice alone.
>
> What landed:
>
> - **Node-core's project files.** The ten modules and their four tests are in
>   `packages/node-core/src/server/projects/`. The file names stay. Inside a `projects/` folder,
>   `projectConfig.ts` would lose its prefix and become `config.ts` beside `runConfig.ts` and
>   `repoConfigTrust.ts`, which reads worse. `routes/projects/projects.ts` already sets the
>   `projects/projects.ts` pattern. The exports map keeps its three keys, so no other package's
>   import changed. Docs and comments that named the old paths follow.
> - **The terminal capability.** The terminal plugin provides `TERMINAL_RUNTIME`
>   (`plugins/terminal/src/contract/runtime.ts`), a `{ reconcile() }` handle in the same shape as
>   `AGENTS_RUNTIME`, and `reconcileNode` calls it with `get`, so a boot without terminal skips the
>   pass as `reconcileTmux` did. The entry no longer re-exports `reconcileTmux` or
>   `refreshAcornMcpRegistrations`.
> - **MCP registration moved to node-core.** Core holds the profile registry, and each harness's
>   `mcpRegistration` is registered there, so core owns the job. `mcpRegister.ts` gained
>   `refreshAcornMcpRegistrations(name, launcher)`, which the boot calls, and
>   `registerAcornMcpBeforeSpawn(profile, name, launcher)`, which the terminal calls before it
>   starts a harness's CLI. They share one set of registered profiles, as the two terminal
>   functions did, so a spawn after a good boot refresh skips the CLI round trip. The
>   `ACORN_SKIP_MCP_REGISTRATION` check moved with them. Phase 02's rule holds: the boot refreshes
>   only when the root hands it an MCP launcher, so a standalone Node never does. The terminal keeps
>   its own fallback launcher for spawn on a standalone Node, unchanged. `@acorn/plugin-api/node`
>   exports the spawn function, and its surface snapshot gained that line.
> - **`isRecord`.** Node-core's exported copy in `integrations/codec.ts` is its only one. The
>   manifest reader and the schedule action parser import it, and the git and workflows plugins
>   take it from `@acorn/plugin-api/node`.
> - **`createHelper`** is in `packages/custody/src/helper.ts`. `runtime/public.ts` still exports it,
>   so no caller changed.
> - **The single viewer.** `WsViewers.legacy` is `WsViewers.single`, with a comment that says which
>   connections use it.
>
> Decisions:
>
> - **The `claude` and `claude-code` pair stays.** `docs/managed-agents/harnesses.md` says why,
>   beside the paragraph on persisted IDs, and tells the next harness not to copy the split.
> - **The recoverable reset stays.** `docs/data-layer/data-root.md` says it's the supported way to
>   reset any data root. The docs and the Node's old-schema error already described it that way.
>   The crossover framing was in the reset's own messages: "restore with the old Acorn binary" and
>   "do not import them into the new baseline". Both now name the build that wrote the files, and so
>   does `docs/local-development.md`.
> - **A command without a `kind` stays the default action.** Phase 15 had already replaced the
>   compatibility wording. The comment still said the leaf "carries no `kind` at all", which is
>   wrong, because `ActionCommand` allows `kind: 'action'`, so it now says the kind is optional. The
>   decision is in the refusals list in `docs/command-palette-and-shortcuts/palette-data.md`.
>
> Deviations:
>
> - **`rpcValues.ts` kept its guard, renamed `isObject`.** It wasn't the same check: it accepts
>   arrays, because the RPC value walk descends into them. Merging it would have changed behavior.
> - **Client-core and dashboards-core keep one `isRecord` each.** Client-core could import the
>   dashboards contract's copy, but the plugin host would then load the panel parser and the
>   dashboard view schema for one line.
> - **Nothing to commit for `plugins/changes/`.** Git tracks nothing there, and this worktree has no
>   such folder. `~/Source/acorn` still has one holding `dist` and `node_modules`. It's untracked
>   build output from before Changes moved into Git, so delete it by hand in any checkout that has
>   it.
> - **One stale fact fixed in passing.** `docs/data-layer/migrations.md` listed a `changes`
>   migration chain. That chain is `git`'s.
> - `docs/future/cleanup/17-housekeeping.md` stays, with this note, as the coordinator asked. Its
>   custody paragraph marks the old `index.ts` path as moved, so the doc path check passes.
>
> For later phases: proposal 11 owns the custody broker's `legacyOwner` and `legacyRecipient`. Those
> do describe a Node without viewer multiplexing, so they were left alone. A new compiled plugin
> that the composition root has to call gets a capability in its `contract/`, not an export from its
> entry.

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

**Name `createHelper`'s file for what it is.** `packages/custody/src/index.ts` (since moved to
`helper.ts`) held the 333-line `createHelper`, the desktop helper's composition. It isn't an entry point. The exports map reaches it
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
