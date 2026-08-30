# Findings: what the 2026-08-30 structure review found

Part of [docs/future/structure/](./README.md). This is the review condensed to what the phases act
on. Counts were taken on 2026-08-30 against the working tree, which at the time had the `layout/`
programme deleted but uncommitted and the `terminal/` programme untracked. Paths are hints, not
promises.

## Apps

### apps/node

`src/service/` (three files) is the supervised-service entry. `src/server/` (five files) holds the
other entry, `apps/node/src/server/standalone.ts`, plus `composition.ts`, `plugins.ts`,
`pluginDeps.ts`, and `pluginState.ts`. `apps/node/src/server/pluginDeps.ts` line 8 says it is "built
once for both composition roots". So the folder named `server` holds the shared code and the folder
named `service` imports from it. Neither name predicts its contents.

`apps/node/vite.config.ts` line 41 builds the `mcp` entry from
`packages/node-core/src/mcp/main.ts`. An app reaching into a library for an executable entry.

`test/integration/` is 30 flat files, 5,282 lines, covering plugin suites (rollbar, linear,
workflowRunner, workflowFiles, memoryGen, httpLoaded), lifecycle (standaloneShutdown,
standaloneParity, serviceSpawn, enrollment), auth (pairing, internalPrincipal, idempotency), and the
plugin system (pluginLoader, pluginDisable, mainBarrelLoad). `test/fixtures/` holds one file,
`apps/node/test/fixtures/fake-agent.sh`, which `packages/node-core/src/server/headless.ts` line 10
points at from another package. Two helpers in test dirs (`apps/node/test/registerProviders.ts`,
`apps/node/test/integration/golden.ts`) carry no suffix marking them as helpers. One colocated test
(`apps/node/src/service/runtime.test.ts`) against 32 under `test/`.

### apps/desktop

`src/app/` contains only `client/`. Two directory levels for one folder.

`src/shell/` is documented as "the bridge the window injects", the one folder allowed to import
Tauri (`docs/architecture-overview.md`). It also holds `apps/desktop/src/shell/helperMain.ts` and
`apps/desktop/src/shell/helperServer.ts`, 540 lines of a separate Node process built by
`apps/desktop/vite.helper.config.ts` with zero Tauri imports.

`apps/desktop/src/app/client/scopedEviction.test.ts` (114 lines) is collected by no vitest project.
`apps/desktop/vitest.config.ts` includes `src/shell/**`, `test/boot.test.ts`, `test/integration/**`,
and `test/client/**`. Verified with `vitest list`: 76 tests collected, zero from that file.

Three feature components (`App.tsx`, `TaskView.tsx`, `CommandPalette.tsx`) live in the composition
root with no written reason while comparable UI lives in client-core. `pageContributions.tsx` and
`slotContributions.tsx` are `.tsx` with no JSX while `sourceContributions.ts` does the same job as
`.ts`. `apps/desktop/scripts/nodeRuntime.mjs` is the one camelCase script among five kebab-case.

## packages/node-core

No README, no `description`. Nothing states what `main/` means versus `server/`.

`src/main/` is 78 files flat (42 source, 36 tests), 12,823 lines, at least six concerns: HTTPS
listener and TLS (`server.ts`, `tls.ts`), WebSocket hub (`wsHub.ts`, 322 lines), preview tunnel,
SQLite and data root, backup and archive, git worktrees, enrollment and mDNS, headless agent runner,
and ten plugin-lifecycle modules: `pluginManifest`, `pluginLoader`, `pluginInstaller`,
`pluginMigrations`, `pluginPermissions`, `pluginReload`, `pluginStorage`, `bundledPlugins`,
`bundledPluginState`, `disabledPlugins`. `main/server.ts` creates the listener while
`server/index.ts` creates the Hono app.

Electron residue that is live code, not comments: `packages/node-core/src/server/bindings.ts` line 116
and `packages/node-core/src/server/plugins/migrations.ts` line 42 both read a variable named
`electronResourcesPath`. Comments in `main/server.ts` lines 221 to 227 explain layout in terms of
"Electron's utility service". `apps/node/src/server/standalone.ts` opens with "The Electron-free
entry" and `apps/node/src/service/runtime.test.ts` has `describe('Electron-free service runtime')`.

### The `main/core/` facades

`src/main/core/` has nine two-line re-export files, each commented "Compatibility facade: the
implementation lives in the domain-owned module this re-exports."

| Facade | Points at | External import sites |
| --- | --- | --- |
| `core/tasks.ts` | `core/tasks/service.ts` | about 51 |
| `core/secrets.ts` | `core/security/secrets.ts` | about 23 |
| `core/prefs.ts` | `core/identity/preferences.ts` | about 13 |
| `core/proc.ts` | `core/exec/proc.ts` | about 6 |
| `core/fs.ts` | `core/filesystem/confinement.ts` | about 4 |
| `core/git.ts` | `core/vcs/git.ts` | about 3 |
| `core/context.ts` | `core/context/launch.ts` | 0 |
| `core/identity.ts` | `core/identity/identity.ts` | 0 |
| `core/models.ts` | `core/models/text.ts` | 0 |

Seven of the eight subfolders hold one file. Tests are colocated with the facade, not the
implementation. `docs/security.md` cites both spellings of `secrets` (line 166 and line 560). Two
`projects` modules exist: `main/projects.ts` (326 lines) and `main/core/projects.ts` (79 lines),
the second importing the first.

### Other node-core findings

- `src/server/routes/` is 28 flat files with clear families: auth and pairing, projects and
  workspaces and tasks, plugins and harness and agent tools, security and audit and backup.
- `src/server/plugin/` is 24 files, singular name, with `pluginState.ts` and `pluginSchedules.test.ts`
  carrying the prefix inside a folder already called `plugin`.
- `registry.ts` appears seven times in seven folders; `routeRegistry.ts` and
  `connectionRegistry.ts` use the suffix form.
- Single-file folders: `server/nodeActions/`, `server/integrations/providers/`, seven under
  `main/core/`. Two-file folders: `server/collections/`, `server/nodeProviders/`, `server/runs/`.
- 13 orphan tests named after a behaviour with no sibling module. Two test a module in another
  folder: `packages/node-core/src/server/plugins/reload.test.ts` tests `main/pluginReload.ts`;
  `packages/node-core/src/server/middleware/requireUser.test.ts` tests `middleware/requireUser.ts`.
- One `.integration.test.ts` infix in the package: `main/tunnelPorts.integration.test.ts`, beside
  `main/tunnelPorts.test.ts`.
- `packages/node-core/scripts/locate-db.ts` is kebab-case beside `migrate.ts`.
- `src/testkit/` ships in `src/` on purpose (`docs/testing.md`). Two of its nine files are tests of
  the test helpers.
- `src/server/bridge.ts` says of itself: "Keeping this helper in the historical bridge module makes
  the migration mechanical for existing route families."

## packages/desktop-helper

Every file is in `src/main/`, the only child of `src/`. The package exports `./*`, so the `main/`
level satisfies nothing. 22 files fall into four groups that are not folders: broker (`nodeBroker`,
`nodeRequest`, `nodePairing`, `fleetStore`), custody (`deviceTokenStore`, `legacyCustody`), plugin
custody (`pluginCache`, `pluginTrustStore`, `bundledPluginTrust`, `pluginRequests`), and supervision
(`serviceHost`, `crashBudget`, `previewTunnel`). Otherwise the cleanest package: 100% camelCase, zero
orphan tests. `legacyCustody.ts` is a real migration path for an Electron-era custody root, not
residue.

## packages/client-core

516 files, about 61,000 lines, 25 top-level folders, two barrels (`layouts/index.ts`,
`platform/index.ts`).

| Folder | Files | Kind |
| --- | --- | --- |
| `ui` | 64 (+ `kit` 10, `diff` 11) | the closed kit, plus 15 utility modules |
| `registries` | 60 | the contract layer every `@acorn/plugin-api/client` export comes from |
| `plugins` | 90 across `annotations` 4, `chrome` 20, `frames` 26, `tree` 16 | the plugin runtime |
| `dashboards` | 28 (+ `views` 9) | feature; seven files are three-line re-exports of dashboards-core |
| `settings` | 31 | feature |
| `tasks` | 29 | feature |
| `node` | 22 | transport, wsClient, apiClient, nodes UI |
| `styles` | 19 | 16 CSS, one reader, two tests |
| `persistence` | 15 | device prefs, query persistence, restore |
| `keys` | 11 | keymap engine |
| `layouts` | 11 | seven layout components |
| `diff` | 11 | feature; pane, canvas, toolbar |
| `workspaces` | 11 | feature |
| `tabs` | 10 | feature |
| `notifications` | 8 | feature |
| `lib` | 8 | six utils, eight import sites |
| `integrations` | 7 | feature |
| `palette` | 7 | overlay palette |
| `editor` | 6 | feature |
| `highlight` | 6 | Shiki and a worker |
| `agent` | 3 | feature |
| `configTrust` | 3 | one dialog, one CSS, a 472-byte module |
| `platform` | 3 | the host seam |
| `projects` | 2 | feature |
| `modelProviders` | 2 | one picker, a 513-byte module |

Overlaps and misplacements:

- `lib/` is a leftovers bin. Utilities accumulate in `ui/` instead: `anchor.ts`, `split.ts`,
  `tokenAxes.ts`, `markdown.ts`, `mentions.ts`, `frameTips.ts`, `confirm.ts`, `dismissable.ts`,
  `metrics.ts`, `followScroll.ts`, `cx.ts`, `appearance.ts`, `brandMarks.ts`, `displayMeta.ts`,
  `iconNodes.ts`.
- `registries/` and `plugins/` are a real split (62 imports go `plugins` to `registries`, zero the
  other way) but share basenames: `extensionPoints.ts`, `contextMenus.ts`, `themes.ts` (also in
  `settings/`), `registry.ts`.
- `railMarkers.ts` and `sources.ts` exist in both `registries/` and `tabs/`.
- `diff/` and `ui/diff/` are two diff folders; `packages/plugin-api/src/ui/diff.ts` exists to
  publish half of one because `Row` would collide.
- Annotations live in `plugins/annotations/`, `tasks/taskAnnotations.ts`, and
  `diff/annotationKey.ts`.
- `packages/client-core/src/registries/ProviderHtml.tsx`, `RefPanelBox.tsx`, and
  `RefPanelTaskLink.tsx` are components filed under registries because `ui/` may not import a
  registry function. `packages/plugin-api/src/ui/host.ts` explains this in a comment.
- `packages/client-core/src/AccountMenu.tsx` (its header says the name is wrong),
  `packages/client-core/src/Acorn.tsx` (19 lines of ASCII art, marked prune candidate in
  `plugin-api/src/ui/host.ts`), and `packages/client-core/src/styles.css` beside `styles/`.
- `packages/client-core/src/highlight/protocol.ts` shares a name with the `@acorn/protocol`
  dependency.
- Three tests in `plugins/tree/` test modules in `plugins/frames/`: `remoteSolid.test.tsx`,
  `compiledSlot.test.tsx`, `twoPaths.test.tsx`.
- `tools/arch/boundaries.test.ts` rule "client-core ui/ is pure presentation" (around line 629)
  carries six carve-outs, four at file level. The rule is a list of exceptions.
- Exactly one `use*` file in 516: `workspaces/useActiveWorkspaceId.ts`. Everything else is Solid's
  `create*`.
- 14 CSS files colocated in feature folders; `settings/NodesSettings.tsx` imports `../node/nodes.css`
  and `packages/client-core/src/plugins/frames/ExtendedPane.tsx` imports `../chrome/extension-points.css`.
- `configTrust`, `modelProviders`, `projects`, and `dashboards/views` have zero tests.

## The shared packages

The four-way split is sound: `@acorn/protocol` (wire types, zod only), `@acorn/plugin-api` (internal
facade, re-exports only), `acorn-plugin-types` (published node-side declarations), `acorn-plugin-sdk`
(published frame bridge). Each published package is locked to its source by a `contract.test.ts`.

- The 62-name remote component list exists three times: `packages/plugin-sdk/src/remote/solid.ts`,
  `packages/plugin-api/src/ui/tree.ts`, `packages/client-core/src/plugins/frames/remoteSolid.ts`.
  The first two already differ on `ConfirmButton`.
- `packages/protocol/src` is 59 flat modules with one subfolder, `tree/`, which is justified
  (`tree/nodes.ts` has zero imports so a bundle can take it without zod). The five `plugin*.ts`
  modules (`pluginContract.ts` at 1,049 lines) would be `plugin/` by the same logic.
- `packages/plugin-api` spells "entrypoint" two ways: `node/index.ts`, `client/index.ts`,
  `testkit/index.ts` in single-file folders; `ui/host.ts`, `ui/sdk.ts`, `testkit/client.ts` bare.
- `packages/create-acorn-plugin/index.mjs` has no `src/` and embeds about 300 lines of frame-bridge
  logic as template strings (lines 190 to 505), a hand-maintained copy of plugin-sdk. Commented as
  deliberate.
- `protocol` has 23 of 41 modules untested; `pluginContract.ts` is tested only from
  `packages/plugin-types/src/pluginSchema.test.ts`.

## Plugins

19 packages have `src/`; 606 source files, about 63,000 lines. Zero READMEs. Six carry
`acorn-plugin.config.mjs`, which `apps/node/scripts/build-plugin.mjs` turns into the manifest; that
is the marker of a loaded plugin.

| Plugin | client | contract | main | node | server | shared | tree | testkit | Files | Subpaths |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| agents | 69 | 3 | 77 | 3 | 5 | 9 | | 2 | 168 | 6 |
| browser | | | | 2 | 7 | | | 1 | 10 | 2 |
| changes | 10 | | 5 | 2 | 4 | 3 | | 1 | 25 | 3 |
| context | 14 | 2 | | | | | | 1 | 17 | 3 |
| database | | | 3 | 2 | 7 | 1 | 8 | | 21 | 1 |
| docker | 20 | | 11 | 1 | 2 | 2 | | 1 | 37 | 3 |
| editor | 16 | 1 | 3 | 1 | 4 | 1 | | 1 | 27 | 4 |
| github | 48 | 7 | 2 | 3 | 43 | | | 3 | 106 | 5 |
| http | | | | 4 | 8 | 2 | 13 | | 27 | 1 |
| linear | | | | 1 | 6 | 8 | 5 | 1 | 21 | 3 |
| memory | 3 | 1 | 7 | 3 | 2 | 1 | | 1 | 18 | 4 |
| model-providers | | | | 1 | 4 | | | | 5 | 1 |
| nodes-file | | | | 1 | 2 | | | | 3 | 1 |
| notes | 7 | 1 | 6 | 1 | 2 | 1 | | 1 | 19 | 4 |
| onboarding | 9 | | | | | | | | 9 | 1 |
| preview | 3 | 1 | | 1 | 1 | | | | 6 | 3 |
| rollbar | | | | 2 | 10 | 4 | 5 | 1 | 22 | 3 |
| terminal | 15 | 6 | 13 | 2 | 3 | 1 | | 2 | 42 | 6 |
| workflows | 4 | 5 | 9 | 2 | 2 | | | 1 | 23 | 4 |

### The documented shape is not the real one

`docs/plugins.md` lines 16 to 30 give the canonical shape as
`src/{node,server,main,client,frame,contract,shared}/`. No directory named `frame` exists. The four
loaded plugins use `tree/`, and `tools/arch/boundaries.test.ts` hardcodes those four paths.
`testkit/` (13 plugins) and `node/schema.ts` (nine plugins, each paired with `migrations/`) are not in
the documented shape. A seventh export kind, `./server/index.ts`, exists on linear and rollbar; those
files are the vendor HTTP clients, not barrels, and `plugins/github/src/server/index.ts` is the same
thing unexported. Zero of 19 plugins declare all six subpaths.

### `main/` versus `server/`

`node/` is consistent (`index.ts` plus `schema.ts`) with two exceptions:
`plugins/http/src/node/workflowStep.ts` is an engine, and `plugins/workflows/src/node/index.ts` is
355 lines with `toRunStatus`, status sets, and list limits in the activation entrypoint. `main/` is
engines and stores; `server/` is Hono routers and vendor clients. But `tools/arch/boundaries.test.ts`
around line 146 collapses them, only agents and terminal have a `main/index.ts`, and only terminal's
is imported outside the package (from `apps/node/src/service/runtime.ts` and
`apps/node/src/server/composition.ts`). The same role lands on either side:

- `agentTools.ts` is under `main/` in changes, github, memory, notes, terminal and under `server/` in
  browser.
- Process-spawning engines: `plugins/docker/src/main/dockerService.ts`,
  `plugins/editor/src/main/search.ts`, `plugins/database/src/main/database.ts`, but
  `plugins/http/src/server/send.ts`.
- `plugins/github/src/main/` holds two files (`agentTools.ts` and its test). That is the whole reason
  github has a `main/`.

Electron residue: `plugins/preview/src/node/index.ts` lines 3 to 6 describe a `main/` folder preview
does not have and a lazy electron import the arch test bans. `plugins/editor/src/main/search.ts`
lines 18 to 24 rewrite `app.asar` to `app.asar.unpacked`, with `search.test.ts` asserting it.
`plugins/memory/src/main/knowledgeIpc.ts` and `plugins/terminal/src/main/runIpc.ts` are named for
IPC over what is loopback HTTP. 13 files still say "main process" or "renderer" in prose.

### `contract/` versus `shared/`

External importers per contract module: `notes/contract/store.ts` 4, `workflows/contract/extensions.ts`
3, `terminal/contract/sessionsClient.ts` 2, `github/contract/mirror.ts` 2,
`context/contract/contextBlock.ts` 2, eleven others 1 each, and zero for
`plugins/github/src/contract/api.ts`, `plugins/github/src/contract/collections.ts`,
`plugins/github/src/contract/pullRef.ts`, `plugins/workflows/src/contract/workflowContracts.ts`,
`plugins/workflows/src/contract/workflowClient.ts`. `github/contract/api.ts` line 4 justifies itself
with "plugins/changes types its local diff rows against `PullFile`"; changes has its own
`toPullFile` in `plugins/changes/src/client/model.ts` and imports nothing from github.

Route builders and wire types are `shared/api.ts` in changes, memory, notes, linear, rollbar and
`contract/api.ts` in github and editor. 12 contract modules import `@acorn/plugin-api/node`. Five
test files sit under `contract/`, which every plugin exports as a wildcard:
`plugins/context/src/contract/contextBlock.test.ts`, `plugins/github/src/contract/api.test.ts`,
`plugins/github/src/contract/collections.test.ts`, `plugins/github/src/contract/pullRef.test.ts`,
`plugins/terminal/src/contract/routes.test.ts`. `plugins/github/src/testkit/githubToken.ts` is not in
github's exports map and is reached by relative import from three route tests.

### Size and shape

Flat folders over 12 files: `agents/src/client` 69 (zero subfolders; `github/src/client` subdivides
at 28), `github/src/server/routes` 32, `agents/src/main` 32 plus `drivers/` 24, `docker/src/client`
20, `terminal/src/client` 15, `editor/src/client` 14, `context/src/client` 14, `terminal/src/main`
13, `http/src/tree` 13. agents is 27% of plugin source; the median plugin is 21 files. `preview` is
six files across four directories with zero tests.

29 single-file folders: ten `testkit/`, seven `node/`, five `shared/`, four `contract/`,
`linear/src/server/routes`, `preview/src/server`, `rollbar/src/server/__fixtures__`.

### Duplicates and dependency hygiene

`plugins/linear/src/shared/rail.ts` and `plugins/rollbar/src/shared/rail.ts` are both 44 lines with
names swapped. `plugins/agents/src/shared/wsFrames.ts` and `plugins/docker/src/shared/wsFrames.ts`
share the pattern. `plugins/database/src/main/formatSchema.test.ts` has no `formatSchema.ts`.
`linear`, `rollbar`, `http`, and `database` import `hono` in `server/routes/*.ts` although
`docs/first-party-plugins.md` says the loaded tier uses the portable `fetch` carrier.

13 plugins list `@acorn/node-core` or `@acorn/client-core` in `dependencies` and import them from zero
non-test files. browser, http, and model-providers put node-core in `devDependencies`.

### Naming inside plugins

Casing holds: PascalCase `.tsx` is a component, camelCase `.ts` is a module, zero PascalCase `.ts`.
Tests are 100% colocated `.test.ts(x)`. Outliers: one `.conformance.test.ts` (workflows), one
`__fixtures__/` (rollbar), one `testFixtures/` (agents, holding the only non-TS files in any `src/`),
one `test:smoke` script (browser).

What does not hold:

- `routes.ts` means Hono handlers in `server/routes/`, route builders in `terminal/contract/`, a
  client route table in `github/client/`.
- Client HTTP wrappers: `dockerClient`, `editorClient`, `memoryClient`, `notesClient`,
  `terminalClient`, `localGitClient`, `databaseClient`, `httpClient`; agents has five; two live in
  `contract/` (`terminal/contract/sessionsClient.ts`, `workflows/contract/workflowClient.ts`).
- Client state: `*Slice.ts` 3, `*State.ts` 7, `*Store.ts` 10, `*Prefs.ts` 2, `model.ts` 11. docker
  has `dockerStore`, `dockerLogStore`, `dockerViewState`, `dockerPrefs` in one folder; github has
  `filterSlice.ts` beside `filterState.ts`; context has `selectionSlice.ts` beside
  `selectionState.ts`.
- Contribution registration: `paneContribution.ts` 5, `slotContribution.tsx` 2,
  `sourceContribution.tsx` 2, `agentContextContribution.ts` 3, plus `drawerContribution`,
  `railMarkerContribution`, `referenceContribution`, `collectionContribution`, against
  `extensionPoints.ts` in agents, changes, docker, github doing the adjacent job.
- `plugins/onboarding/src/client/` has both `index.ts` and `index.tsx`, the only such folder.

## Docs

`docs/` is 41 top-level `.md` files, one `.html`, three subfolders, about 1.6 MB. `docs/future/` is
60 files and about 430 KB.

- No `docs/README.md` (new). `docs/architecture-overview.md` section "Documentation map" omits 19 of the
  41: `managed-agents.md` (32 KB), `schedules.md`, `workspaces-and-tasks.md`, `testing.md`,
  `integrations.md`, `github-integration.md`, `contribution-kinds.md`, `diff-rendering.md`,
  `http-client.md`, `mcp.md`, `docker.md`, `notes-and-memory.md`, `node-distribution.md`, `pg.md`,
  `terminal-and-agents.md`, `workflows.md`, `next-review.md`, `release-notes-vnext.md`,
  `plugin-map.html`.
- Root `README.md` line 110 cites `docs/smolforge/`, which has never existed.
- The six plugin docs total 348 KB. `docs/plugins.md` is 198 KB and 2,836 lines; its `## Activation`
  at line 291 runs to `## Task checks` at line 2415 and holds 15 h3s that are each a top-level topic.
  `docs/plugin-authoring.md` section "The manifest" and `plugins.md` section "The manifest schema"
  are two full manifest references. `docs/extensibility.md` and `docs/first-party-plugins.md`
  section "What a loaded plugin cannot have" make the same argument twice. `docs/plugin-map.md` has
  two inbound links. `docs/contribution-kinds.md` is the clean one.
- Four files carried the wrong name; phase 1 renamed all four. `docs/pg.md`, moved to
  `docs/database.md`: H1 "PostgreSQL tools", describes the database plugin, zero inbound links,
  thinner than `docs/data-layer.md` section "Database plugin". `docs/terminal-and-agents.md`, moved to
  `docs/terminal.md`: the terminal plugin, colliding with `docs/future/terminal/`.
  `docs/state.md`, moved to `docs/state-ownership.md`: its own H1 already said "state ownership".
  `docs/release-notes-vnext.md`, moved to `docs/release-notes.md`: titled "Current release notes".
  The deleted `docs/next-review.md` was a personal TODO with zero inbound links.
- `docs/plugin-map.html`, since deleted, was 59 KB, referenced nowhere, with no generator and a
  title that already differed from the `.md`.
- `docs/third-party/README.md` was a migration review record, moved to
  `docs/loaded-plugin-migration.md`, and `docs/third-party/monaco.md` a Monaco design doc, moved to
  `docs/editor-monaco.md`. They shared a folder because both were "not core"; phase 1 deleted it.
- `docs/future/`: `refused.md` exists in `client-plugins/`, `dashboards/`, `terminal/` and not in
  `ecosystem/`, `marketing/`, `sandbox/`, though all three discuss refusals inline.
  `docs-migration.md` exists only in `terminal/` and `client-plugins/`. `sandbox/` is seven peer
  files with no order of work. The README's status table header says 2026-08-28 while rows say
  2026-08-29 and 2026-08-30.
- `docs/schemas/enrollment-v1.json` is the one well-governed file: generated, pinned by
  `packages/node-core/src/server/enrollmentSchema.test.ts`, versioned, immutable by rule.
- `tools/arch/docPaths.test.ts` walks only `docs/`, excuses extension-less paths, and excludes a
  `docs/reviews/` that does not exist. `.github/workflows/build-desktop.yml` runs neither `pnpm lint`
  nor `pnpm test` and has no `pull_request` trigger, so no arch or doc test runs anywhere but a
  developer's machine.

## Repo root

- `forge` is a gitlink (`git ls-files -s forge` shows mode `160000`) with no `.gitmodules` entry and
  an empty directory. `.oxlintrc.json` ignores `forge/**`.
- `.pnpm-store/v11/index.db` and its `-shm` and `-wal` siblings are committed; `.pnpm-store` is not
  in `.gitignore`.
- `test-results/migration-audit/index.html` is tracked although `test-results/` is gitignored; it
  predates the rule.
- `select-filter.png` (39 KB) at the root, referenced nowhere, committed 2026-08-27.
- `plans/` holds two records both numbered `001`, untouched since 2026-08-07; its README says it
  archives shipped design, which `docs/future/README.md` says git history does.
- `plugins/profiles-aider/`, `plugins/profiles-claude/`, `plugins/profiles-codex/` contain only
  gitignored `dist/` and `.turbo/` output from a deleted package set. Zero tracked files.
- `pnpm-workspace.yaml` lists the same three packages under `allowBuilds` and
  `onlyBuiltDependencies`.
- No workspace `package.json` has a `description`. No package has a README.
