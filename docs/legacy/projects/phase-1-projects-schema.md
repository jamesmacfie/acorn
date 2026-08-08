# Phase 1 — Projects schema + dual-key server (SHIPPED; completed record)

**Status: shipped**, uncommitted on `james/vnext-fable`. As-built record. Read this before
touching Phase 2 — the dual-key state it establishes is exactly what Phase 2 dismantles.

## What exists now

### The `projects` table

`packages/node-core/src/server/db/schema.ts`, created by migration
`packages/node-core/migrations/0046_light_mercury.sql`:

```
projects (
  id TEXT PK                    -- opaque uuid (randomUUID from routes; hex(randomblob) from SQL backfills)
  name TEXT NOT NULL            -- display; defaults to basename(path) or the GitHub repo name
  path TEXT                     -- absolute folder; NULL = known but not on disk yet (deferred import)
  workspace_id TEXT NOT NULL    -- a project lives in exactly one workspace
  sort INTEGER DEFAULT 0
  hidden INTEGER DEFAULT 0      -- replaces ignored_repos
  -- VCS facet (cache of disk truth)
  vcs TEXT                      -- 'git' | NULL
  default_branch TEXT
  -- GitHub facet
  remote_url TEXT, github_owner TEXT, github_name TEXT, github_repo_id INTEGER
  -- config, moved verbatim from repo_paths (same column names — that is load-bearing, see dual-write):
  run_targets, editor_command, setup_script, setup_script_trigger, dev_script,
  dev_restart_script, teardown_script, db_url_script, db_schema_mode, db_schema_value,
  db_schema_notes, preview_mode, preview_value, browser_rules, branch_prefix
  created_at, updated_at
)
INDEX projects_workspace_idx (workspace_id)
INDEX projects_github_idx (github_owner, github_name)   -- NON-unique: two clones are legal
```

`path` uniqueness is app-enforced (createProject is idempotent on path), NOT a DB constraint —
a UNIQUE index could have made migration 0046 unrunnable if legacy data ever mapped two repos to
one folder.

### Migration 0046 backfill (and its mirror, `reconcileLegacyProjects`)

Projection order, all in `0046_light_mercury.sql` after the DDL:

1. Ensure a default workspace exists IF any legacy rows exist at all (guarded insert).
2. One project per `repo_paths` row: path, all config columns copied, `vcs='git'` (historically
   guaranteed — `setRepoPath` demanded `.git`), github facet = the (owner,repo) key,
   workspace from the `workspace_repos` join else the default workspace, `hidden` from
   `ignored_repos`.
3. One path-NULL project per `workspace_repos` row with no `repo_paths` row (assigned, never
   mapped).
4. One path-NULL project (default workspace) per distinct `tasks.(repo_owner, repo_name)` with no
   project yet.
5. `UPDATE tasks SET project_id = (oldest matching project)`.

`tasks.project_id` was added in the same migration (nullable TEXT — nullability is deliberate,
see Phase 2).

**`reconcileLegacyProjects`** (`packages/node-core/src/main/projects.ts`) is the same projection
with `NOT EXISTS` guards, run synchronously in `openDb` after every `migrate()`. It exists
because the v1 importer (`packages/node-core/src/main/v1Import.ts`) writes
`repo_paths`/`workspace_repos`/`tasks` directly, bypassing the route-level mirrors. Idempotent;
a no-op on a healthy DB.

**Backup**: `openDb` (`packages/node-core/src/main/bindings.ts`) copies `core.sqlite` →
`core.sqlite.pre-projects.bak` (0600) when it sees `repo_paths` without `projects` — i.e. exactly
once, on the boot that runs 0046.

### `main/projects.ts` — the project module

- `parseGithubRemote(url)` — https/ssh/`.git`-suffix/case-insensitive github.com parser
  (the inverse of `remoteMatches` in repoPaths.ts).
- `detectFacets(path)` — `.git` **entry** check (a linked worktree has a `.git` FILE — keep
  `existsSync`, not `isDirectory`), `git remote get-url origin` (exit code as data — no origin is
  not an error), `git symbolic-ref --short refs/remotes/origin/HEAD` for the default branch
  (only set after a clone; a bare `git init` + `remote add` leaves it unset, that's fine).
- `createProject({path, workspaceId?, name?})` — absolute + existing-dir checks for the folder;
  a supplied workspace must exist. No `.git` gate, no remote gate. Idempotent on path. Mints the
  Default workspace if none exists.
- `getProject`, `listProjects` (sort, createdAt), `patchProject` (name/workspace/hidden/sort/
  path — setting path onto a path-NULL project re-detects facets and cannot duplicate another
  project's path), `detectProject` (re-probe;
  clears the github facet only when `.git` itself is gone, not on a transient remote change),
  `deleteProject` (row only, never the folder).
- `projectByGithub(owner, name)` — **the** legacy-pair bridge; oldest wins (`created_at, id`).
- The dual-write helpers: `syncLegacyMembership`, `syncLegacyCheckout`, `syncLegacyConfig` — see
  README § invariants. `syncLegacyConfig` works because the config column names are identical on
  both tables; if you rename a column on one side, rename it on both or the mirror silently
  drops it.

### Routes

`packages/node-core/src/server/routes/projects.ts`, mounted at `/v2/core/projects` in
`packages/node-core/src/server/index.ts`:

| Route | Purpose |
| --- | --- |
| `GET /v2/core/projects` | list (wire type `ProjectsResponse`) |
| `POST /v2/core/projects` | `{path, workspaceId?, name?}` — add a folder |
| `PATCH /v2/core/projects/:id` | name/workspace/hidden/sort/path |
| `POST /v2/core/projects/:id/detect` | re-probe facets |
| `DELETE /v2/core/projects/:id` | remove the row (folder untouched) |

Zod at every mutation boundary, per docs/architecture-overview.md § Wire validation.
`toWireProject` maps a row to the protocol `Project` type (github facet collapsed to a nullable
`{owner, name, repoId}` object).

### Protocol additions (additive, non-breaking)

`packages/protocol/src/api.ts`: `Project`, `ProjectSeed`, `ProjectPatch`, `ProjectsResponse`.
The legacy types (`WorkspaceRepo`, `RepoAssignment`, `Task.repoOwner/repoName`, `TaskSeed`) are
untouched — the client compiles and behaves identically. That is the definition of "dual-key":
new tables + new routes exist, old wire contracts still rule.

### Dual-write call sites (the complete list)

| Legacy write | Mirror |
| --- | --- |
| `setRepoPath` (repoPaths.ts) | `syncLegacyCheckout` — path + re-probed facets; creates the project if missing (workspace from `workspace_repos`, else Default) |
| `setRepoConfig` / `setRunTargets` (repoPaths.ts) | `syncLegacyConfig` — same `set` record applied to projects |
| `POST /workspaces/:id/repos` | `syncLegacyMembership` {workspaceId, hidden:false}, createIfMissing |
| `POST /workspaces/bootstrap` | `syncLegacyMembership` per newly-assigned repo, createIfMissing |
| `POST /workspaces/ignore-repo` / `unignore-repo` | `syncLegacyMembership` {hidden} |
| `POST /workspaces/ignore-all` | hidden=true per mirrored repo / global hidden=false reset |
| `DELETE /workspaces/:id` | `projects.workspace_id` reassigned to Default alongside `workspace_repos` |
| `POST /tasks` (routes/tasks.ts) | `project_id` stamped; unknown repo mints a path-NULL project |
| `createChild` (main/core/tasks/service.ts) | child inherits parent's `project_id` |

## Tests (the regression net for later phases)

- `packages/node-core/src/server/db/projectsBackfill.test.ts` — replays the journal to 0045 on a
  raw handle, seeds every legacy shape, applies 0046, asserts the projection (including
  config carry-over, hidden flag, default-workspace minting, task stamping, empty-DB no-op).
  **This is the template for testing any future data migration.**
- `packages/node-core/src/main/projects.test.ts` — facet detection matrix (plain folder /
  git-no-remote / github remote / gitlab remote), createProject validation + idempotence,
  `detectProject` after a late `git init`, `patchProject` mapping a folder onto a path-NULL
  project. Requires the real `git` binary (fine in CI — worktrees.test.ts already shells git).
- `packages/node-core/src/server/routes/projectsSync.test.ts` — the dual-write invariant at the
  route level: assign mints/moves, ignore flips hidden, workspace delete reassigns, task create
  stamps, and the `/projects` CRUD surface.

## Verification

```sh
pnpm rebuild:node
pnpm --filter @acorn/node-core exec vitest run          # 419 passing at ship time
pnpm --filter @acorn/arch-tests test
pnpm lint
cd packages/node-core && npx tsx scripts/check-migrations.ts   # fresh-DB chain replay
```

## Gotchas discovered while building (save yourself the hour)

- **drizzle-kit generate then hand-append**: backfill SQL goes into the GENERATED file, separated
  by `--> statement-breakpoint`. The snapshot (`meta/0046_snapshot.json`) only tracks schema
  shape, so data statements are invisible to future generates — correct and intended.
- **`hidden` boolean**: drizzle `integer(..., {mode:'boolean'})` — SQL backfills write 1/0,
  drizzle reads true/false. Tests comparing raw rows (`db.prepare(...).get()`) see 1/0; drizzle
  selects see booleans. Don't mix the two expectations.
- **`git symbolic-ref refs/remotes/origin/HEAD`** fails (non-zero) on any repo that never had a
  clone-time HEAD — treat exit code as data, never `gitOrThrow`, or every `git init` project
  becomes an error path.
- **`sql.raw` in reconcile**: the statements interpolate `Date.now()` only — never interpolate
  user input there; everything else goes through drizzle builders.
