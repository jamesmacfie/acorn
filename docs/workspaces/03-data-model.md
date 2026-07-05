# 03 — Data model: entities & schema

> **✅ Status: shipped.** The entity this doc designs as `workspaces` shipped as the **`tasks`**
> table (`workspace_links` → **`task_links`**, `terminal_sessions.workspace_id` → **`task_id`**);
> the name `workspaces` now belongs to the top-level *group* table — see the two-tier table in
> [`README.md`](./README.md). This doc presents the **shipped** schema first
> (`apps/desktop/src/server/db/schema.ts` is the source of truth); the original single-tier design
> is kept as an [appendix](#appendix--original-design-as-written).

## The shipped schema

```ts
// Named group of repos — the top-level unit (machine-scoped). Has grown per-group settings
// (docs/workspaces-and-tasks.md; run/config design in docs/next 13): setup/dev/teardown scripts,
// preview resolution, icon & color.
workspaces            { id, name, isDefault, sort, setupScript, setupScriptTrigger,
                        devScript, devRestartScript, teardownScript, previewMode, previewValue,
                        icon, color, createdAt, updatedAt }
// Repo → Workspace membership. PK (repoOwner, repoName) = one workspace per repo (partition).
workspace_repos       { workspaceId, repoOwner, repoName, sort, createdAt }
// External projects linked to a workspace, provider-agnostic and keyed by CONNECTION.
// (Shipped first as `workspace_linear_projects`; replaced in migration 0005 when `integrations`
// became multi-row per provider.)
workspace_projects    { workspaceId, integrationId, externalId, createdAt }
// Repos hidden from the UI (onboarding eye-toggle). An ignored repo is excluded from the
// selector / rail / scoping, and bootstrap skips it.
ignored_repos         { owner, repo, createdAt }
// The single-repo unit of work — this doc's "workspace". Parent workspace is derived via
// workspace_repos on (repoOwner, repoName). parentId = task-tree fan-out (docs/next 14).
tasks                 { id, title, origin, repoOwner, repoName, branch, worktreePath,
                        pullNumber, status, parentId, sort, createdAt, updatedAt, archivedAt }
// integrationId pins a link to a specific connection (two Linears can both have an ENG-42);
// provider stays denormalized for filtering. PK (taskId, integrationId, identifier).
task_links            { taskId, integrationId, provider, identifier, createdAt }
// Deliberate subset of the vNext §7 design (no pid / last_attached_at — liveness re-derives from
// tmux; only tmux-backed rows are persisted). Bound to a task via NOT NULL taskId; the loose
// repo_owner / repo_name / pull_number columns were never created.
terminal_sessions     { id, title, kind, profileId, backend, status, cwd, taskId, command,
                        argvJson, tmuxSession, cols, rows, createdAt, exitedAt, exitCode }
```

**Drift from the original design (beyond the renames)**, so the appendix isn't silently wrong:

- **`integrations` was re-keyed** from `(userId, provider)` to an opaque `id` PK with a `label`
  — a user can connect *several* Linears/Rollbars. That cascaded: `issues` is now keyed
  `(userId, integrationId, identifier)` and `task_links` carries `integrationId`, so this doc's
  original claim that `(provider, identifier)` "matches the PK tail of `issues`" is **no longer
  true** — the matching tail is now `(integrationId, identifier)`.
- **`terminal_sessions` shipped as a deliberate subset** of vNext §7: no `pid` /
  `last_attached_at` (liveness re-derives from tmux), and only tmux-backed rows are persisted.
  The loose `repo_owner`/`repo_name`/`pull_number` columns were dropped exactly as this doc
  specifies.
- **New machine-scoped tables landed beside these** that this folder never designed:
  `review_notes`, `memories` (+ `memories_fts`), `workflow_runs` / `workflow_steps`. They belong
  to the [`../next/`](../next/README.md) designs (04, 12, 14) — listed here only so a schema
  diff against this doc isn't mistaken for drift.

## Convention recap (from the real schema)

- **Machine-scoped** desktop tables (`repo_paths`, `terminal_sessions`) have **no `user_id`** —
  they describe *this machine's* filesystem and are read by the terminal service in the Electron
  main process, outside any GitHub user context (see the `repoPaths` comment in `schema.ts`).
  Tasks are the same: they own local worktrees, so they're machine-scoped.
- Timestamps are `integer('…_at')` epoch millis, set in app code (not DB defaults).
- Text PKs for opaque ids (`terminal_sessions.id = text('id').primaryKey()`).
- Composite PKs via `primaryKey({ columns: [...] })` for join/child tables.
- JSON blobs as `text` columns when a shape should evolve without migrations (`issues.data`,
  `integrations.meta`).

## The `tasks` entity (designed as `workspaces`)

The owning entity. One row per "thing you're working on." Shipped columns are in the block above;
the original design sketch is in the appendix. The load-bearing decisions, unchanged from the
design:

- `(repoOwner, repoName)` are the join key into the GitHub mirror (`pull_requests`, etc.) and into
  `repo_paths` (to find the base checkout the worktree is added from).
- `pullNumber` + `(repoOwner, repoName)` is the FK-shaped link to `pull_requests`
  (PK `(userId, repoId, number)`). It's nullable — that nullability *is* the local-first state.
- No `agentProfileId` here; the agent lives on the terminal session, not the task (a task can have
  several terminals with different profiles).
- Shipped addition: `parentId` — fan-out task trees ([docs/next 14](../next/14-workflows.md)); the
  rail still renders a flat list.

## `task_links` (designed as `workspace_links`)

A task can reference zero-or-more external items (Linear tickets, Rollbar errors). This is the join
the pre-design schema lacked — Linear ids were only parsed out of PR bodies at render time.

The resolve-through-the-cache idea survived the re-key: `(integrationId, identifier)` on
`task_links` deliberately matches the PK tail of the `issues` cache table (see `issues` in
`schema.ts`), so the Linear pane resolves a link straight into cached issue detail with no new
fetch path: `task_links` → `(integrationId, identifier)` → `issues.data`. (`provider` is kept
denormalized on the link for cheap filtering.)

## `terminal_sessions`: bound to the task

Before this design, a session was bound to a PR via three loose columns
(`repo_owner`, `repo_name`, `pull_number`) and made visible by filtering on the **current URL** —
the source of the drift. On the fresh baseline (P0, [`06`](./06-implementation-phases.md)) a
session belongs to a task from row one, so the binding is mandatory and the loose columns were
never created:

- `taskId` is **`NOT NULL`**, not nullable: there were no legacy sessions to accommodate. (A clean
  baseline also means no Drizzle table-rebuild — see the risk note in
  [`06`](./06-implementation-phases.md).)
- Repo / branch / PR context comes from the `taskId → tasks` join. The main process fills the wire
  type's `repo` / `pull` fields from that join; the columns aren't denormalized onto the session row.
- Visibility is the `visibleSessions` memo in `TerminalPanel.tsx` —
  `sessions().filter(s => s.taskId === task.id)` — no router coupling. The shared wire type
  `TerminalSession` (`apps/desktop/src/shared/terminal.ts`) carries `taskId: string`, as does
  `CreateOpts`.
- `isWorktree` (the transient boolean on `TerminalSession`) is derivable: a session is in a
  worktree iff its `cwd === task.worktreePath`. The boolean stays as a convenience flag but the
  **truth** lives on the task's `worktreePath`.

## Promoting the worktree from "transient path" to "tracked relationship"

vNext Phase 4 created worktrees at inline paths (`.acorn/worktrees/<owner>-<repo>-pr-<n>`) with no
record. After this change the path lives on `tasks.worktreePath`, which gives us:
- **Ownership** — exactly one task owns a worktree path (the gap cmux flagged).
- **Reuse** — opening a second terminal in the task reuses the path instead of re-deriving it.
- **Teardown** — archiving a task has a definite path to `git worktree remove`.

Lifecycle detail (dirty detection, recovery, teardown) is in
[`05-lifecycle-and-isolation.md`](./05-lifecycle-and-isolation.md).

## What replaces `Tab` and `workspace:tabs`

Before this design the rail was client-only state: a `Tab = { id, icon, path }` list serialized
into the `prefs` table under the key `workspace:tabs` (the old `features/tabs/model.ts`, since
removed). On the clean baseline this mechanism was **never built** — there was nothing to retire or
migrate. The rail renders task entities from the start:

| Old path-bookmark concept | What the rail does instead |
| --- | --- |
| `Tab.path` (a router URL) | derived from the task (`/owner/repo` + active pane), not stored as the unit of truth |
| `Tab.icon` (cycled glyph) | **resolved: derived from `origin`** — the `ORIGIN_GLYPH` map in `TabRail.tsx` (a workspace emoji icon overrides it). A per-task `icon` column was never added; `icon`/`color` landed on the *group* `workspaces` table instead |
| `workspace:tabs` prefs blob | the `tasks` table (server-owned, queryable, joinable) |
| `seedFromPrefs()` / `recordLocation()` / `persist()` debounce | normal table reads/writes via TanStack Query |

The `prefs` table itself **stayed** on the baseline (theme, diff mode, keybindings) — it simply
never got a `workspace:tabs` key. The `TabRail.tsx` UI was reused; only its data source changed to
a tasks query (P1, [`06`](./06-implementation-phases.md)).

## Entity-relationship sketch (as shipped)

```
   workspaces (group) ◄── workspace_repos (PK repoOwner, repoName → workspaceId)
        ▲                      │  partition: a repo is in exactly one workspace;
        │ integrationId        │  (repoOwner, repoName) derives a task's parent workspace
   workspace_projects          │
                               │
            repo_paths (owner, repo) ── base checkout on disk
                  ▲
                  │ (repoOwner, repoName)
   pull_requests ─┤
   (…, number) ◄──┼── tasks ───────────┐
                  │   id               │ taskId (NOT NULL)
                  │   branch ──────────┼─────────────► terminal_sessions
                  │   worktreePath     │               (drawer sessions; tmux rows persisted)
                  │   pullNumber ──────┘
                  │
   issues ◄───────┴── task_links (taskId, integrationId, identifier)
   (userId, integrationId, identifier)
```

## Why not user-scope the new tables?

Consistency with `repo_paths` / `terminal_sessions`: a worktree is a fact about *this machine*, and
acorn is single-user per machine (the migration premise in [`../electron.md`](../electron.md)). If
acorn ever returns to multi-user, machine-scoped tables get a `user_id` at that point — the same
decision the existing desktop tables defer.

## Appendix — original design (as written)

The single-tier design as proposed, kept for the record. Apply the renames
(`workspaces` → `tasks`, `workspace_links` → `task_links`, `workspaceId` → `taskId`) and the
`integrationId` re-key (drift notes at the top) to map it onto `schema.ts`.

### New entity: `workspaces` (shipped as `tasks`)

```ts
// Machine-scoped like repo_paths / terminal_sessions — owns a local worktree, so no user_id.
export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),                 // opaque uuid
  title: text('title').notNull(),              // editable label; seeded from origin (PR title, ticket, …)
  origin: text('origin').notNull(),            // 'github-pr' | 'linear' | 'rollbar' | 'local'
  repoOwner: text('repo_owner').notNull(),     // a workspace always belongs to a repo
  repoName: text('repo_name').notNull(),
  branch: text('branch').notNull(),            // the branch this workspace works on
  worktreePath: text('worktree_path'),         // null until a terminal is first opened (Flow C)
  pullNumber: integer('pull_number'),          // null for local-first until a PR is inherited (Flow B)
  status: text('status').notNull(),            // 'active' | 'archived'
  sort: integer('sort').notNull().default(0),  // rail ordering, like pinned_repos.sort
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  archivedAt: integer('archived_at'),          // set on archive; row kept for history/teardown audit
})
```

### New entity: `workspace_links` (shipped as `task_links`, re-keyed by `integrationId`)

```ts
export const workspaceLinks = sqliteTable(
  'workspace_links',
  {
    workspaceId: text('workspace_id').notNull(), // → workspaces.id
    provider: text('provider').notNull(),        // 'linear' | 'rollbar'
    identifier: text('identifier').notNull(),    // 'ENG-42' | rollbar item id
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.provider, t.identifier] })],
)
```

`(provider, identifier)` was chosen to match the then-PK tail of `issues`; after the
`integrations` re-key the shared tail became `(integrationId, identifier)` — see the drift notes.

### Change to `terminal_sessions` (shipped with `taskId`)

```ts
// terminalSessions, on the clean baseline:
workspaceId: text('workspace_id').notNull(),   // → workspaces.id
// repo_owner / repo_name / pull_number are REMOVED — derived via the workspace join.
```

