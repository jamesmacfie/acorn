# Phase 3: node-core and desktop-helper

Status: not started. Waits on phase 2.

## Goal

`packages/node-core/src` has no `main/`. Its library folder is `server/`, grouped so the ten plugin
lifecycle modules, the transport, the storage, and the worktree code each have a folder instead of a
prefix. The `core/` facade migration is finished, not abandoned halfway. `packages/desktop-helper/src`
has four groups and no `main/` level. The word "Electron" appears only in `legacyCustody.ts`, where
it is a real migration path.

## Why this phase, and why now

This is the worst folder in the repo and the one every plugin's node half imports through
`@acorn/plugin-api/node`. Doing it before the plugins (phase 4) means the plugin moves are pure
`git mv` with no import churn from underneath. Doing it after the apps (phase 2) means the two
composition roots that construct node-core already have their final paths.

## Scope

### Step 1: finish the `core/` migration

1. Delete the three facades with zero importers: `packages/node-core/src/main/core/context.ts`,
   `packages/node-core/src/main/core/identity.ts`, `packages/node-core/src/main/core/models.ts`.
2. For the six live facades (`tasks`, `secrets`, `prefs`, `proc`, `fs`, `git`, about 100 import sites
   in total), rewrite every importer to the implementation module, then delete the facade.
3. Flatten the seven single-file subfolders back to one file each: `core/tasks/service.ts` becomes
   `core/tasks.ts`, `core/security/secrets.ts` becomes `core/secrets.ts`, and so on. `core/identity/`
   has two files; it becomes `core/identity.ts` and `core/preferences.ts`. Move each test beside the
   file it tests.
4. Rename `packages/node-core/src/main/core/projects.ts` to `core/projectRefs.ts` or fold it into
   `main/projects.ts`; two modules named `projects` one directory apart is the finding.
5. Fix `docs/security.md` lines 166 and 560 to one spelling.

### Step 2: merge `main/` into `server/`

`git mv` in one commit per group so `git log --follow` works:

- `server/transport/`: `main/server.ts` (rename to `listener.ts`; `server/server.ts` is not a name),
  `tls.ts`, `wsHub.ts`, `tunnel.ts`, `tunnelPorts.ts`, `advertise.ts`, and their tests.
- `server/storage/`: `sqlite.ts`, `dataRoot.ts`, `backup.ts`, `archive.ts`, `storageFootprint.ts`.
- `server/plugins/`: the ten lifecycle modules, prefix stripped: `manifest.ts`, `loader.ts`,
  `installer.ts`, `migrations.ts`, `permissions.ts`, `reload.ts`, `storage.ts`, `bundled.ts`,
  `bundledState.ts`, `disabled.ts`. `packages/node-core/src/main/pluginManifest.test.ts` (1,382
  lines) comes with `manifest.ts`.
- `server/worktrees/`: `worktrees.ts`, `taskWorktree.ts`.
- `server/core/`: the result of step 1.
- The rest of `main/` flat into `server/`: enrollment, headless, notify, mcpRegister, bindings,
  runConfig, projects, agentProfiles/.
- `git mv server/plugin server/pluginHost` and strip the prefix inside: `pluginState.ts` becomes
  `state.ts`, `pluginSchedules.test.ts` becomes `schedules.test.ts`.

Then delete `src/main/`.

### Step 3: group `routes/`

Per [03-target-layout.md](./03-target-layout.md): `routes/auth/`, `routes/projects/`,
`routes/plugins/`, `routes/security/`. Move `packages/node-core/src/server/routes/requireUser.test.ts`
beside `server/middleware/requireUser.ts`. Keep `packages/node-core/src/server/routeRegistry.ts`
where it is; it is the registry of routes and the name already says so.

### Step 4: Electron residue

Rename `electronResourcesPath` to `resourcesPath` in `packages/node-core/src/main/bindings.ts` line
116 and `packages/node-core/src/main/pluginMigrations.ts` line 42. Rewrite the comments in
`main/server.ts` lines 221 to 227, `packages/node-core/src/server/auth/deviceTokens.ts` line 53,
`packages/node-core/src/mcp/server.ts` line 6, `packages/node-core/src/main/wsHub.test.ts` line 15.

### Step 5: tests and scripts

Move `packages/node-core/src/server/plugin/reload.test.ts` beside `server/plugins/reload.ts`. Rename
`packages/node-core/src/main/tunnelPorts.integration.test.ts` to what it tests (`tunnelPortsReuse`
or fold into `tunnelPorts.test.ts`). Rename `packages/node-core/scripts/locate-db.ts` to
`locateDb.ts` and fix `packages/node-core/package.json`. Flatten
`packages/node-core/src/server/nodeActions/registry.ts` to `server/nodeActions.ts` and
`packages/node-core/src/server/integrations/providers/shared.ts` to
`server/integrations/providerShared.ts`.

### Step 6: the arch test

In `tools/arch/boundaries.test.ts` around line 146, remove `main` and `service` from the node-side
list (phase 2 removed the last `service/`). Keep `mcp` and `wiring` if anything still uses them;
check with a grep first. Every rule that names a `main/` path (the `TREE_DIRS` list does not; the
Electron rule at line 514 does not) gets the new path.

### desktop-helper

`git mv src/main/* src/` into `broker/`, `custody/`, `plugins/`, `supervision/` with
`packages/desktop-helper/src/main/index.ts` becoming `src/index.ts`. Update the three importers in
`apps/desktop/src/helper/` (after phase 2) and `docs/architecture-overview.md` line 145, plus the six
`docs/shell.md` citations. Rewrite the "booting Electron" comments in
`packages/desktop-helper/src/main/crashBudget.ts` lines 6 and 9 and
`packages/desktop-helper/src/main/pluginCache.test.ts` line 9.

### Docs

`docs/architecture-overview.md`, `docs/security.md`, `docs/data-layer.md`, `docs/plugins.md`,
`docs/node-enrollment.md`, `docs/shell.md`, `docs/testing.md`, `docs/schedules.md`, and
`docs/managed-agents.md` all cite `node-core/src/main/*` (19 distinct paths). Fix them in this
phase; the path checker lists them.

## Out of scope

Closing node-core's `./*` export (a separate decision the architecture doc already records as bigger
than the plugins). Renaming `server/` to `domain/` (refused). Any change to what the modules do.

## Done when

- `ls packages/node-core/src` prints `mcp server testkit`.
- `ls packages/node-core/src/server/core` has no subdirectories and no two-line files.
- `grep -rn electron packages/node-core packages/desktop-helper -i` hits only `legacyCustody.ts`.
- `ls packages/desktop-helper/src` prints `broker custody index.ts plugins supervision`.
- No test file in node-core sits in a different folder from the module it imports most.
- `pnpm lint`, `pnpm test`, and `tools/arch` are green.

## Verify before building

- The facade table in [01-findings.md](./01-findings.md) still matches: `grep -rn "core/context'" packages apps plugins` is empty.
- `packages/node-core/src/main` still has 78 direct files.
- `tools/arch/boundaries.test.ts` still lists `main` in `side()`.
- `grep -n electronResourcesPath packages/node-core/src/main/bindings.ts` still hits.
