# Work groups for parallel agents

`README.md` in this directory is the brief: what to do to a comment, the style to leave it in, and the
tooling (`showc.py`, `cedit.py`) to do it with. This file only answers a second question: how to split
the remaining files across several agents running at the same time without two of them touching the
same file.

Read the README first. This file assumes it.

## How to use this

Each group below is a disjoint set of directories: no file appears in two groups, so agents working
different groups never conflict on a file and never need to coordinate mid-pass. Hand one group to one
agent (or one agent per group, run in parallel). Each agent should:

1. Read `README.md` in this directory for the workflow, the style, and the two scripts.
2. Scope the audit script in the README to its own group's paths only, rather than the whole repo, to
   get an up-to-date worklist. The counts below are a snapshot from when this file was written; they
   will already be stale, and files converted by earlier passes will simply show fewer or no marks.
3. Work top-down within the group, batching roughly a dozen files per `cedit.py` call as the README
   says.
4. Verify with the per-file comment-only diff, `pnpm lint`, and the tests for whatever package it
   touched, same as any other comment-pass work.
5. Commit only the files in its own group. A commit that also touches a file from another group is the
   one thing that can still cause a conflict between two agents working at the same time.

The **likely doc** column is a starting guess, not a ruling. Search the doc before deleting a comment,
exactly as the README says; if the guess is wrong, the file's own imports and neighbours will make the
right doc obvious quickly.

A **needs new doc** count means some files in that group are on the README's 25-plus-comment-lines,
no-doc-reference list: the code may be the only record of that rationale, so the agent should expect to
write a doc section before cutting some of its comments, not just add pointers.

## The groups

| # | Group | Paths | Snapshot size | Likely doc(s) | Needs new doc |
| --- | --- | --- | --- | --- | --- |
| 1 | Client plugin runtime | `packages/client-core/src/plugins/` | 46 files, ~410 marks | `docs/plugins.md` (client half), `docs/security.md` (frame containment) | 8 files |
| 2 | Client registries | `packages/client-core/src/registries/` | 32 files, ~275 marks | `docs/plugins.md` (content links, ref panels, extension points, context menus), `docs/panes.md` | 9 files |
| 3 | Client UI primitives | `packages/client-core/src/ui/` | 35 files, ~175 marks | `docs/ui-design.md` | 5 files |
| 4 | Client dashboards (remainder) | `packages/client-core/src/dashboards/` | 24 files, ~135 marks | `docs/dashboards.md` | 2 files |
| 5 | Client styles & highlighting | `packages/client-core/src/styles/`, `packages/client-core/src/highlight/` | 20 files, ~180 marks | `docs/ui-design.md` | 8 files |
| 6 | Client node & settings | `packages/client-core/src/node/`, `packages/client-core/src/settings/` | 31 files, ~175 marks | `docs/architecture-overview.md`, `docs/security.md` (permissions UI) | none |
| 7 | Client misc | `packages/client-core/src/tasks/`, `persistence/`, `notifications/`, `platform/`, `tabs/`, `editor/`, `workspaces/`, `palette/`, `integrations/`, `lib/`, plus root files `apiClient.ts(+test)`, `wsClient.ts(+test)`, `wsChannels.test.ts`, `queries.ts`, `clientCapabilities.ts(+test)`, `AccountMenu.tsx`, `styles.css`, `vitest.config.ts` | ~60 files, ~265 marks | `docs/workspaces-and-tasks.md`, `docs/caching.md`, `docs/panes.md` | 1 file |
| 8 | Node server: routes & plugin registration | `packages/node-core/src/server/routes/`, `middleware/`, `auth/`, `plugin/`, plus root files `routeRegistry.ts`, `index.ts`, `respond.ts(+test)`, `auditRequest.ts`, `pluginFetchRoute.test.ts` | 46 files, ~270 marks | `docs/api-reference.md`, `docs/plugins.md` | 6 files |
| 9 | Node server: agent tools | `packages/node-core/src/server/agentTools/` | 8 files, ~80 marks | `docs/plugins.md` (agent tools), `docs/terminal-and-agents.md` | 1 file |
| 10 | Node server: schedules, collections, actions | `packages/node-core/src/server/schedules/`, `collections/`, `nodeActions/`, `sync/`, `db/`, plus root files `audit.ts(+test)`, `blobs.ts`, `secretBox.ts(+test)`, `background.ts` | 19 files, ~120 marks | `docs/schedules.md`, `docs/data-layer.md` | none |
| 11 | Node server: integrations & dashboards routes | `packages/node-core/src/server/integrations/`, `packages/node-core/src/server/dashboards/` | 13 files, ~80 marks | `docs/integrations.md`, `docs/dashboards.md` | 2 files |
| 12 | Node composition root, testkit, MCP | `packages/node-core/src/main/core/`, `packages/node-core/src/testkit/`, `packages/node-core/src/mcp/`, plus `tools/arch/boundaries.test.ts` | 21 files, ~135 marks | `docs/architecture-overview.md` (§ Package boundaries) | 5 files |
| 13 | Node main: worktrees, backup, crypto | `packages/node-core/src/main/worktrees.ts(+test)`, `taskWorktree.ts`, `taskEnv.ts`, `archive.ts(+test)`, `backup.ts(+test)`, `dataRoot.ts`, `runConfig.ts`, `projects.ts`, `storageFootprint.ts`, `sqlite.ts`, `diskEncryption.ts(+test)`, `sessionKey.ts`, `tls.ts(+test)`, `activeIdentity.ts`, `bindings.ts`, `profiles.ts`, `agentProfiles/` | 23 files, ~170 marks | `docs/workspaces-and-tasks.md`, `docs/data-layer.md` | 1 file |
| 14 | Node main: network, transport, plugin loading | `packages/node-core/src/main/wsHub.ts(+test)`, `tunnel.ts(+test)`, `tunnelPorts.ts(+test)`, `upgradeClaim.ts`, `urlGuards.ts`, `pathGuards.ts`, `advertise.ts(+test)`, `server.ts(+test)`, `serverDrain.test.ts`, `notify.ts`, `headless.ts`, `pluginStorage.ts`, `pluginLoader.ts(+test)`, `pluginInstaller.ts(+test)`, `pluginPermissions.ts`, `pluginMigrations.ts`, `bundledPlugins.ts(+test)`, `bundledPluginState.ts`, `disabledPlugins.ts(+test)`, `mcpRegister.ts` | 29 files, ~230 marks | `docs/security.md`, `docs/plugins.md` | 2 files |
| 15 | Desktop main process | `apps/desktop/src/app/main/`, `apps/desktop/electron.vite.config.ts`, `apps/desktop/vitest.config.ts` | 29 files, ~280 marks | `docs/security.md` (Electron), `docs/architecture-overview.md` | 2 files |
| 16 | Desktop client & e2e | `apps/desktop/src/app/client/`, `apps/desktop/e2e/`, `apps/desktop/test/` | 17 files, ~185 marks | `docs/panes.md`, `docs/plugins.md`. Do not add new e2e specs, only edit comments in the existing ones. | 1 file |
| 17 | apps/node integration tests | `apps/node/test/integration/` | 17 files, ~140 marks | Mostly code facts (integration tests); `docs/plugins.md` where a test documents a manifest rule | 3 files |
| 18 | apps/node server & service | `apps/node/src/`, plus `apps/node/test/registerProviders.ts`, `apps/node/test/pluginConfigs.test.ts`, `apps/node/vitest.config.ts`, `apps/node/vite.config.ts` | 11 files, ~85 marks | `docs/architecture-overview.md` | 2 files |
| 19 | GitHub plugin client | `plugins/github/src/client/` | 22 files, ~120 marks | `docs/integrations.md`, `docs/plugins.md` | 3 files |
| 20 | GitHub plugin server | `plugins/github/src/server/`, `contract/`, `node/`, `testkit/` | 33 files, ~170 marks | `docs/integrations.md` | 3 files |
| 21 | Protocol wire contracts | `packages/protocol/src/` | 33 files, ~205 marks | `docs/api-reference.md`, `docs/plugins.md` | 4 files |
| 22 | Plugin API facade | `packages/plugin-api/src/` | 9 files, ~125 marks | `docs/plugins.md` (§ Loaded plugins) | 2 files |
| 23 | Dashboards-core remainder & plugin SDK | `packages/dashboards-core/src/`, `packages/plugin-sdk/`, `packages/create-acorn-plugin/` | 17 files, ~105 marks | `docs/dashboards.md`, `docs/third-party/README.md` | none |
| 24 | Agents plugin | `plugins/agents/src/` | 39 files, ~150 marks | `docs/terminal-and-agents.md` | 3 files |
| 25 | Linear & database plugins | `plugins/linear/src/`, `plugins/database/src/` | 31 files, ~240 marks | `docs/integrations.md` (linear), `docs/data-layer.md` (database) | 3 files |
| 26 | Terminal & HTTP plugins | `plugins/terminal/src/`, `plugins/http/src/` | 42 files, ~200 marks | `docs/terminal-and-agents.md` (terminal), `docs/plugins.md` (HTTP panel) | 5 files |
| 27 | Docker & memory plugins | `plugins/docker/src/`, `plugins/memory/src/` | 29 files, ~115 marks | `docs/notes-and-memory.md` (memory); docker has no dedicated doc, treat as case (3) | none |
| 28 | Editor & changes plugins | `plugins/editor/src/`, `plugins/changes/src/` | 25 files, ~90 marks | `docs/third-party/monaco.md` (editor); changes has no dedicated doc, treat as case (3) | none |
| 29 | Workflows & Rollbar plugins | `plugins/workflows/src/`, `plugins/rollbar/src/` | 25 files, ~75 marks | `docs/integrations.md` (rollbar); workflows has no dedicated doc, treat as case (3) | none |
| 30 | Small plugins | `plugins/preview/src/`, `plugins/notes/src/`, `plugins/context/src/`, `plugins/onboarding/src/`, `plugins/model-providers/src/`, plus `plugins/vitest.shared.ts`, `plugins/drizzle.shared.ts` | 27 files, ~85 marks | `docs/panes.md` (preview tunnel), `docs/notes-and-memory.md` (notes), `docs/integrations.md` (model-providers) | none |

That is 30 groups covering all remaining files as of this snapshot: about 810 files and 5,000 marks by
the README's audit script, against 831 files and 6,100 marks when the comment pass began. Group sizes
range from about 75 to 410 marks; split a large group further, or merge two small ones, if a different
number of agents is available.

## Notes for whoever assigns the groups

- Groups 1 to 7 are `packages/client-core`, the single largest area. Groups 8 to 14 are
  `packages/node-core`, the second largest. Both packages are split by `src` subdirectory, so a group
  boundary never cuts a directory in half.
- Every plugin package under `plugins/` keeps its `client`, `server`, `main`, `node`, `frame`, `shared`
  and `contract` subdirectories together in one group, since a plugin's client and node halves usually
  cite the same design decision from opposite sides of the wire.
- Groups 27 to 30 cover the plugins with no dedicated topic doc (`docker`, `changes`, `workflows`,
  `context`, `onboarding`, `preview` beyond its tunnel). Most of their comments will land in outcome
  (3), a fact about the code kept and rewritten, rather than outcome (1) or (2).
- `docs/future/` itself, and this directory, are out of scope: the README says never to point live code
  at a file in `docs/future/` unless the comment says "git history", and neither of these directories
  is code.
