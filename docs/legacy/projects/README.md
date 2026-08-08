# Projects migration — GitHub becomes optional (completed record)

This folder is the completed implementation record for the migration that turns acorn's repo model
into a **project** model. The phase files are retained for rationale and migration history; active
architecture and product contracts live in the sibling docs linked from the repository root.

## The goal

Today acorn effectively requires GitHub sign-in even though GitHub is architecturally "just a
plugin". The target model:

```text
Workspace: named group of projects
  └─ Project: a folder on this machine
       ├─ optional VCS facet   (.git detected → diff pane, branches, worktrees)
       └─ optional GitHub facet (github.com remote detected → PR viewer, when connected)
            └─ Task: project + optional branch + optional worktree + panes
```

- **Plain folder** (no `.git`): tasks, terminal, editor, find-in-files, preview, database, HTTP,
  notes, agents all work. No diff pane, no branches.
- **Git folder** (no GitHub remote, or a non-GitHub remote): everything above plus the changes
  pane, branches, worktrees, push (if a remote exists).
- **GitHub-backed folder** + GitHub connected: everything, including the PR list/viewer/checks.

GitHub sign-in becomes an optional enrichment used for exactly two things: importing repos
(clone/map) and the PR surfaces. "Open a folder" is a first-class way to add a project.

## Why this was hard: the four couplings

The exploration phase (2026-08-08) found GitHub mandatory through four distinct mechanisms. Each
phase of this migration removes one or more:

1. **Identity was the GitHub login.** `userId` — the scope key for every user-scoped table — was
   bound only by the GitHub device-auth route. Internal callers (MCP, agents, PTY children)
   failed closed until GitHub was connected once. → removed in **Phase 0** (shipped).
2. **No project entity.** Repo identity was loose `(owner, name)` TEXT pairs with no FKs, spread
   over `workspace_repos`, `repo_paths`, `ignored_repos`, `tasks`, `config_acks`, and three
   plugin databases. The only actual repo rows lived in GitHub's disposable mirror.
   → replaced in **Phase 1** (shipped), finished in **Phases 2/4/5**.
3. **`setRepoPath` hard gate.** Mapping a folder required `.git` AND a `github.com/<owner>/<repo>`
   remote. → bypassed in **Phase 1** (`/v2/core/projects` has no such gate); the legacy route
   dies in **Phase 2**.
4. **Discovery and shell shape.** The repo list came only from GitHub's mirror, workspace bootstrap
   auto-assigned from it, the new-task dropdown read it, and the app's URL space is literally
   `/:owner/:repo`. → replaced by project-based navigation and the plugin-owned importer in **Phases 2 and 3**.

## After the fact: the chains were squashed

Once all six phases landed, every migration chain (core and plugin) was regenerated from the current
schema as a single baseline migration, and the one-way conversion code went with it: the projects
backfill and cutover migrations, their replay tests, the `.pre-projects` / `.pre-legacy-drop`
database copies in `openDb`, the plugin pair-rekey staging tables and init backfills, and the HTTP
plugin's legacy unscoped-row claim. There is no upgrade path from a pre-baseline database — a new
install starts from a fresh data root. The phase files below describe how the model changed, not
code that still exists.

## Status

All six phases are implemented on `james/vnext-fable` and, at the time of writing, still uncommitted.

| Phase | File | Status | Size |
| --- | --- | --- | --- |
| 0 — Identity decouple | [phase-0-identity.md](./phase-0-identity.md) | ✅ Shipped | S |
| 1 — Projects schema + dual-key server | [phase-1-projects-schema.md](./phase-1-projects-schema.md) | ✅ Shipped | L |
| 2 — Protocol + client cutover | [phase-2-client-cutover.md](./phase-2-client-cutover.md) | ✅ Implemented | L |
| 3 — GitHub as importer + de-defaulting | [phase-3-github-importer.md](./phase-3-github-importer.md) | ✅ Implemented | M |
| 4 — Plugin data rekey | [phase-4-plugin-rekey.md](./phase-4-plugin-rekey.md) | ✅ Implemented | M |
| 5 — Drop legacy + docs | [phase-5-drop-legacy.md](./phase-5-drop-legacy.md) | ✅ Completed | S |

Still owed, and NOT done: the desktop e2e tour (`pnpm --filter @acorn/desktop test:e2e`) and the manual
upgrade of a real pre-0046 `core.sqlite` through the 0046→0048 chain. Every unit and integration suite
is green apart from the environmental failures listed below.

Phases were ordered by dependency: 2 required 1; 3 required 2; 4 required 1; and 5 completed the
cutover after the preceding phases.

## Invariants that hold during the migration

These are the rules every phase must preserve. Breaking one silently corrupts the transition.

### The dual-write invariant (until Phase 5)

The `projects` table and the legacy tables (`repo_paths`, `workspace_repos`, `ignored_repos`,
`tasks.repo_owner/repo_name`) coexist. **The legacy (owner,name) routes are still authoritative;
every legacy write mirrors into `projects`.** The mirrors live at three seams:

- `packages/node-core/src/main/repoPaths.ts` — `setRepoPath` → `syncLegacyCheckout`;
  `setRepoConfig`/`setRunTargets` → `syncLegacyConfig` (the two tables share column names, so the
  same `set` record is applied verbatim to both).
- `packages/node-core/src/server/routes/workspaces.ts` — assign/ignore/unignore/ignore-all/
  workspace-delete → `syncLegacyMembership` / direct `projects` updates.
- `packages/node-core/src/server/routes/tasks.ts` and
  `packages/node-core/src/main/core/tasks/service.ts` (`createChild`) — every new task row gets
  `project_id` stamped at birth (minting a path-NULL project if the repo is unknown).

Safety net: `reconcileLegacyProjects` (`packages/node-core/src/main/projects.ts`) runs in
`openDb` after migrations — an idempotent, guarded re-run of the 0046 backfill projection. It
catches writers that bypass the seams (the v1 importer writes `repo_paths`/`workspace_repos`/
`tasks` directly). If you add a new legacy write path, either route it through the seams or rely
on reconcile — but know that reconcile only runs at boot.

### Two clones of one repo are legal

`projects` deliberately has a **non-unique** index on `(github_owner, github_name)`. The
resolution rule where one row must be picked is **oldest wins, deterministically**
(`projectByGithub` orders by `created_at, id`). Anything that should apply to all clones (PR
number adoption, membership sync) reads all matches.

### One-way migrations, backup first

Core migrations 0046+ are one-way data migrations. `openDb`
(`packages/node-core/src/main/bindings.ts`) copies `core.sqlite` →
`core.sqlite.pre-projects.bak` before the first projects migration runs (detected structurally:
`repo_paths` exists, `projects` doesn't). That file is the rollback story. Keep the same posture
for later destructive migrations (0047's table rebuild, Phase 5's drops): they replay against the
`.bak` if something goes wrong, so never delete it in a migration.

### Facets are a cache of disk truth

`projects.vcs`, `remote_url`, `github_owner/name`, `default_branch` are **detected, never
demanded**. Truth is the filesystem; `POST /v2/core/projects/:id/detect` re-probes. Don't add
code that trusts a facet for anything destructive without re-checking disk.

## Working on this codebase — practical notes

- **Monorepo layout**: `apps/{desktop,node}`, `packages/{protocol,node-core,client-core}`,
  `plugins/*` (17 plugins, each with its own SQLite file and migration chain).
- **Gate before handing work back**: `pnpm lint` (oxlint + `tsc --noEmit` in every package) and
  the relevant vitest suites. Both must be green.
- **better-sqlite3 ABI**: vitest runs under plain Node. If tests fail with a native-module ABI
  error, run `pnpm rebuild:node` first. (`pnpm test` at the root does this automatically;
  `pnpm --filter X exec vitest run` does not.)
- **Known pre-existing test failures** (not yours, verified on a clean tree):
  `apps/node/test/integration/serviceSpawn.test.ts` and `standaloneShutdown.test.ts` fail in some
  environments with `SyntaxError: The requested module 'electron' does not provide an export
  named 'dialog'` — from `plugins/terminal/src/main/folderPickerIpc.ts`, which this migration renamed
  from `pickerIpc.ts` and which the standalone (Electron-free) node still pulls in through the terminal
  plugin's main entry. Also one live-PTY `posix_spawnp` failure in agentSend tests. Don't chase these.
- **Plugin init runs on EVERY boot.** Both pair-rekey backfills (Phase 4) drop their staging table when
  they finish, so the guard they need is "does the staging table still exist?" — otherwise the second
  boot dies on `no such table` before the plugin starts. Same shape for any future upgrade-only table.
- **A migration chunk holding only comments is not a statement.** drizzle splits on
  `--> statement-breakpoint` and hands every chunk to better-sqlite3, which rejects a comment-only one
  with `RangeError: The supplied SQL string contains no statements`. Keep trailing prose inside the
  last statement's chunk. This is not caught by `db:generate`; the gate that catches it is
  `apps/node/test/integration/pluginDisable.test.ts`, which boots the full plugin set.
- **Migration workflow**: edit `packages/node-core/src/server/db/schema.ts`, run
  `pnpm --filter @acorn/node-core db:generate` (drizzle-kit + a fresh-DB replay check), then
  hand-append any data backfill statements to the generated SQL file using
  `--> statement-breakpoint` separators. Watch for the drizzle NOT-NULL table-rebuild quirk: the
  generated `INSERT INTO __new_… SELECT` can list a new column that doesn't exist in the source
  table — hand-trim it (the check script tells you when this happens).
- **Testing data migrations**: you can't use `openDb` (it applies the whole chain before you can
  seed). Replay the journal up to N-1 on a raw better-sqlite3 handle, seed, apply N, assert.
  `packages/node-core/src/server/db/projectsBackfill.test.ts` is the model to copy.
- **UI verification constraint**: unit tests are `*.test.ts` under plain Node with no Solid
  plugin — **a green suite proves nothing about rendered UI**. Desktop e2e:
  `pnpm --filter @acorn/desktop test:e2e` (rebuilds the bundled Node artifact first). For manual
  verification you need a checkout with a working `.env`; git worktrees generally have no `.env`,
  and port 4317 may be a live dev instance.
- **Client cache gotcha**: the renderer's query cache persists to IndexedDB with no buster. When
  a persisted response type gains required fields, bump the query key or stale cached shapes
  will be served to the new code.

## Reference documents

- `docs/architecture-overview.md` — runtime topology, process ownership, wire validation rules.
- `docs/workspaces-and-tasks.md` — the current (legacy-model) product docs; Phase 5 rewrites them.
- `docs/authentication.md` — already updated for the Phase 0 identity change.
- The original approved plan lives outside the repo
  (`~/.claude/plans/at-the-moment-we-crispy-wind.md` on the machine that ran the planning
  session); these files supersede it.
