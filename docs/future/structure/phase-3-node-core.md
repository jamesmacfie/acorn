# Phase 3: node-core and desktop-helper

Status: shipped 2026-08-30. Waited on phase 2.

## Goal

`packages/node-core/src` has no `main/`. Its library folder is `server/`, grouped so the ten plugin
lifecycle modules, the transport, the storage, and the worktree code each have a folder instead of a
prefix. The `core/` facade migration is finished, not abandoned halfway. `packages/desktop-helper/src`
has four groups and no `main/` level. The word "Electron" survives only where it names a real
migration path.

## Why this phase, and why now

This is the worst folder in the repo and the one every plugin's node half imports through
`@acorn/plugin-api/node`. Doing it before the plugins (phase 4) means the plugin moves are pure
`git mv` with no import churn from underneath. Doing it after the apps (phase 2) means the two
composition roots that construct node-core already have their final paths.

## Scope

### Step 1: finish the `core/` migration

1. The three facades with zero importers are gone: `core/context.ts`, `core/identity.ts`,
   `core/models.ts`.
2. The six live facades are gone too, and each implementation took the facade's path, so no importer
   moved. `core/tasks/service.ts` is `core/tasks.ts`, `core/security/secrets.ts` is `core/secrets.ts`,
   `core/identity/preferences.ts` is `core/prefs.ts`, `core/exec/proc.ts` is `core/proc.ts`,
   `core/filesystem/confinement.ts` is `core/fs.ts`, and `core/vcs/git.ts` is `core/git.ts`.
3. All eight subfolders are gone. Every test already sat beside the facade name, so each one now sits
   beside the implementation it tests.
4. `core/projects.ts` is `core/projectRefs.ts`, which is what it deals in, so the two `projects`
   modules one directory apart are one `projects.ts` and one `projectRefs.ts`.
5. `docs/security.md` names `packages/node-core/src/server/core/secrets.ts` at both sites.

### Step 2: merge `main/` into `server/`

- `server/transport/`: `listener.ts` (was `main/server.ts`), `listenerConfig.ts`, `tls.ts`,
  `wsHub.ts`, `tunnel.ts`, `tunnelPorts.ts`, `advertise.ts`, `upgradeClaim.ts`, and their tests.
- `server/storage/`: `sqlite.ts`, `dataRoot.ts`, `paths.ts` (was `serverPaths.ts`), `backup.ts`,
  `archive.ts`, `footprint.ts`, `diskEncryption.ts`.
- `server/plugins/`: the ten lifecycle modules with the prefix stripped: `manifest.ts`, `loader.ts`,
  `installer.ts`, `migrations.ts`, `permissions.ts`, `reload.ts`, `storage.ts`, `bundled.ts`,
  `bundledState.ts`, `disabled.ts`, plus `fiveKinds.test.ts`.
- `server/worktrees/`: `worktrees.ts`, `taskWorktree.ts`, `pathGuards.ts`.
- `server/core/`: the result of step 1.
- The rest flat in `server/`: `activeIdentity`, `bindings`, `enrollment`, `headless`, `mcpRegister`,
  `notify`, `profiles`, `projectConfig`, `projects`, `repoConfigTrust`, `runConfig`, `sessionKey`,
  `taskEnv`, `urlGuards`, `agentProfiles/`.
- `server/plugin/` is `server/pluginHost/`, with `pluginState.ts` as `state.ts` and
  `pluginSchedules.test.ts` as `schedules.test.ts`.

`src/main/` is deleted.

### Step 3: group `routes/`

`routes/projects/` (projects, workspaces, tasks, taskContext, worktree, membership,
externalProjects), `routes/plugins/` (plugins, harness, agentTools), and `routes/security/`
(security, audit, backup, configTrust). `routes/requireUser.test.ts` moved beside
`server/middleware/requireUser.ts`. `server/routeRegistry.ts` stayed where it was.

### Step 4: Electron residue

`electronResourcesPath` is `resourcesPath` in `server/bindings.ts` and
`server/plugins/migrations.ts`. The comments in `server/transport/listener.ts`,
`server/auth/deviceTokens.ts`, `src/mcp/server.ts`, and `server/transport/wsHub.test.ts` describe the
composition roots and the desktop shell rather than Electron.

### Step 5: tests and scripts

`server/plugin/reload.test.ts` moved to `server/plugins/reload.test.ts`.
`main/tunnelPorts.integration.test.ts` folded into `server/transport/tunnelPorts.test.ts`.
`packages/node-core/scripts/locate-db.ts` moved to `packages/node-core/scripts/locateDb.ts`, and
`packages/node-core/package.json` names it.
`server/nodeActions/registry.ts` is `server/nodeActions.ts` and
`server/integrations/providers/shared.ts` is `server/integrations/providerShared.ts`.

### Step 6: the arch test

`side()` in `tools/arch/boundaries.test.ts` no longer lists `service` or `wiring`. The plugin-route
segment check reads `server/plugins/manifest.ts`, the broadcast ratchet names the new hub and
notifier paths, and the testkit baseline lists the `server/*` roots that replaced the two `main`
ones.

### desktop-helper

`src/main/index.ts` is `src/index.ts`, and the other 21 files are in `broker/`, `custody/`,
`plugins/`, and `supervision/`. The three importers in `apps/desktop/src/helper/`, the client-core
trust modules, `docs/architecture-overview.md`, and `docs/shell.md` follow.

### Docs

`docs/architecture-overview.md`, `docs/security.md`, `docs/data-layer.md`, `docs/plugins.md`,
`docs/node-enrollment.md`, `docs/shell.md`, `docs/testing.md`, `docs/schedules.md`,
`docs/managed-agents.md`, `docs/agent-tools.md`, `docs/plugin-authoring.md`, `docs/editor-monaco.md`,
`docs/ui-design.md`, `docs/integrations.md`, and `docs/conventions.md` name the new paths.

## Out of scope

Closing node-core's `./*` export (a separate decision the architecture doc already records as bigger
than the plugins). Renaming `server/` to `domain/` (refused). Any change to what the modules do.

## Done when

- `ls packages/node-core/src` prints `mcp server testkit`.
- `ls packages/node-core/src/server/core` has no subdirectories and no two-line files.
- `grep -rn electron packages/node-core packages/desktop-helper -i` hits only the legacy custody path.
- `ls packages/desktop-helper/src` prints `broker custody index.ts plugins supervision`.
- No test file in node-core sits in a different folder from the module it imports most.
- `pnpm lint`, `pnpm test`, and `tools/arch` are green.

## Verified before building

All four held. No file imported `core/context'`, `src/main` had 78 direct files, `side()` still
listed `main`, and `bindings.ts` still read `electronResourcesPath`.

## What shipped, and where it differed

Every step landed. Nine things are worth knowing before phase 4.

**The facade migration cost no import churn at all.** Step 1 asked for two passes: rewrite about 100
import sites from the facade to the implementation, then flatten the implementation back up to the
facade's own path. The two cancel. Deleting the facade file and moving the implementation into its
place in one step leaves every importer on a path that still resolves, and the diff is nine deleted
two-line files plus nine renames.

**`core/prefs.ts`, not `core/preferences.ts`.** Step 3 and
[03-target-layout.md](./03-target-layout.md) disagreed on the name. `prefs.ts` won: it is the name 13
import sites already used, and `prefs` is what the service is called in `CoreServices`.

**`storage/footprint.ts`, not `storage/storageFootprint.ts`.** The phase file listed the old name in
the storage group, which would have kept exactly the prefix stutter the same phase strips off the ten
plugin modules. The convention in `docs/conventions.md` says a folder does not repeat its own name in
its files, so the prefix went.

**Six modules the phase file did not place found a group.** `serverConfig.ts` is
`transport/listenerConfig.ts` and `upgradeClaim.ts` is `transport/upgradeClaim.ts`, both because they
are about the listener's ports and sockets. `serverPaths.ts` is `storage/paths.ts` and
`diskEncryption.ts` is `storage/diskEncryption.ts`. `pathGuards.ts` is `worktrees/pathGuards.ts`,
which its own header already argued for. `fiveKinds.test.ts` is `server/plugins/fiveKinds.test.ts`, beside
the manifest and loader it drives.

**`tunnelPorts.integration.test.ts` was folded, not renamed.** Both files test exports of
`tunnelPorts.ts`, one pure and one against a real database. A rename would have left a test file
named after no module, so the two describes now share `transport/tunnelPorts.test.ts` and the
`.integration.` infix is gone from the package.

**`routes/auth/` was not created.** `pairing.ts` is the only auth route, and `deviceTokens.ts` is a
service under `server/auth/`, not a route. A one-file folder is one of the findings this programme
removes, so `pairing.ts` stays flat with the other seven ungrouped routes.

**`main` stays in `side()`.** Step 6 asked for `main` and `service` to come out of the node-side list
in the arch test. Ten plugins still have a `main/`, and removing the name would drop those files into
`shared` and stop the client/node rule biting on them. `service` and `wiring` came out; `main` goes
in phase 4, with the plugins.

**The testkit baseline grew by two roots before it shrinks.** `rootOf()` in the arch test keys on the
first two path segments, so the two old roots (`@acorn/node-core/main`, `@acorn/node-core/main/core`)
became four (`server/core`, `server/plugins`, `server/worktrees`, and the existing `server`). The
count of deep imports did not move; only how they group. Phase 4 is where the number falls.

**The Electron grep has two hits, not one.** `legacyCustody.ts` keeps the word because it names the
custody root a previous shell left behind, and so does `legacyCustody.test.ts`, which writes real
os_crypt blobs to prove the decryption constant has not drifted. Both are the migration path, not
residue.
