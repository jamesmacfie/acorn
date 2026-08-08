# Phase 4 — Plugin data rekey (IMPLEMENTED; completed record)

Prerequisite: the Phase 2 task/project contract. Phase 3's importer is not part of this phase.

Three plugins carry `(repo_owner, repo_name)` TEXT columns in their own SQLite files. This phase
moves them to `project_id`. Plugin DBs are **isolated files with no cross-file FKs**
(docs/data-layer.md): a plugin never queries core's DB directly, so the rekey is a per-plugin
migration plus an init-time backfill through a core-owned lookup.

## The lookup seam

Expose project resolution to plugins via CoreServices (plugins already receive `ctx.core`):

```ts
// packages/node-core/src/main/core/index.ts
projects: {
  byId(id: string): Promise<ProjectRef | null>
  byGithub(owner: string, name: string): Promise<ProjectRef | null>  // oldest wins
  checkouts(): Promise<{ id: string; path: string }[]>               // for memory's reconciler
  create(input: ProjectCreateRefInput): Promise<ProjectRef>          // controlled importer seam
  update(id: string, patch: ProjectUpdateRefInput): Promise<ProjectRef | null>
}
```

Back it with `main/projects.ts` (`getProject`, `projectByGithub`, `listProjects`). Keep the
returned shape narrow (id, name, path, workspaceId, github facet) — plugins should not see core's
config columns.

The implementation keeps the existing `core.repos` compatibility seam for Phase 2 consumers. Plugins use
`core.projects` for project identity and never receive a core database handle or configuration projection.

## Per-plugin work

Each plugin ships a `0001_*.sql` adding a nullable `project_id` column (with table rebuilds where
indexes/nullable legacy columns require them), and its `init` hook runs an idempotent backfill. The pattern
to copy is plugins/http's legacy identity claim (`protectLegacyHttpStorage` — read legacy rows,
resolve, update own file, idempotent).

### plugins/database (`db_saved_queries`)

- `0001`: adds `project_id` and replaces the pair-keyed unique index with `(project_id, name)`.
- Backfill at init: distinct `(repo_owner, repo_name)` → `core.projects.byGithub` → UPDATE.
- The legacy pair columns remain nullable compatibility data because the Phase 2 contract still
  exposes the pair on some task/runtime projections; they are inert after backfill and are not part
  of the scope key.
- Queries scope by `project_id`; plain projects are valid saved-query owners.

### plugins/http (`http_requests`, `http_variables`)

- Same column-add + backfill. `http_variables` unique index `(user_id, repo_owner+repo_name,
  name)` → `(user_id, project_id, name)`.
- These tables also carry `task_id` on requests; nothing to do there.
- HTTP panel scoping semantics (task-local drafts until "Save to project") are unchanged — only the
  storage key changes. Encryption and request-local `task_id`/execution-task semantics are unchanged.

### plugins/memory (`memories.project_id`, scope `'project'`)

- Cheapest of all: the table is a **derived index over markdown files on disk**
  (`plugins/memory/src/node/schema.ts` documents this). Don't backfill — `0001` truncates, the
  scope value renames `'repo'` → `'project'`, and the reconciler rebuilds from
  `core.projects.checkouts()` plus active task worktrees.
- The reconciler treats `git diff HEAD` / `git rev-parse HEAD` as optional anchoring:
  plain folders use project scope without Git anchoring, while Git worktrees retain revision/diff metadata.

### Unresolvable rows

A legacy pair that resolves to no project (repo deleted before this phase ran) keeps
`project_id NULL` and becomes invisible to project-scoped queries — inert, same posture as
http's `__legacy_unscoped__`. Never guess an owner for them.

## What does NOT change

- `plugins/github`'s mirror DB — already keyed by numeric GitHub repo id, a disposable
  projection. Untouched.
- `plugins/terminal` (`terminal_sessions`) — keyed by `task_id` + cwd; repo context is derived
  through the task join. Untouched.
- `plugins/agents`, `plugins/changes`, `plugins/workflows` — task-keyed. Untouched.
- Core's `config_acks` rekey is Phase 2/5 territory (core table, not plugin).

## Gotchas

- **Plugin migrations replay on fresh installs** where the backfill finds zero rows — the init
  backfill must be a cheap no-op (guard on "any rows with project_id IS NULL and a legacy pair").
- **Two clones**: `byGithub` returns the oldest. For saved queries/variables that's the
  documented tie-break; if a user complains their saved query landed on the wrong clone, the fix
  is a UI move action, not a smarter guess.
- **Do not add cross-file FKs or attach core's DB** — resolve through the seam, write only your
  own file. The boundaries test (`tools/arch/boundaries.test.ts`) and the schema-import ratchet
  will fail you otherwise.
- Plugin migration test harness: `makeTestPluginDb(name, migrationsDir())` in
  `@acorn/node-core/testkit/db.ts` — see `plugins/http/src/server/storage.test.ts` for the
  pattern including seeding legacy rows.

## Verification

Per plugin: a backfill unit test (seeded legacy rows resolve via a stubbed/real core lookup;
unresolvable rows stay NULL and inert; re-running is a no-op). Memory: reconcile-rebuild test
(truncate → reconcile → rows reappear for known checkouts). Then `pnpm lint` + full suites.
