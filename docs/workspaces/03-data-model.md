# 03 — Data model: entities & schema

> **⚠️ Superseded terminology** — see the two-tier note in [`README.md`](./README.md). The
> `workspaces` table described below is now the **`tasks`** table; `workspace_links` is **`task_links`**;
> `terminal_sessions.workspace_id` is **`task_id`**. The name **`workspaces`** now belongs to a new
> top-level group table. The current shape is:
>
> ```ts
> // Named group of repos — the top-level unit (machine-scoped).
> workspaces            { id, name, isDefault, sort, createdAt, updatedAt }
> // Repo → Workspace membership. PK (repoOwner, repoName) = one workspace per repo (partition).
> workspace_repos       { workspaceId, repoOwner, repoName, sort, createdAt }
> // Linear projects linked to a workspace → one project spans the workspace's repos.
> workspace_linear_projects { workspaceId, linearProjectId, createdAt }
> // Repos hidden from the UI (onboarding eye-toggle). Keeps its workspace_repos membership; this
> // flag just excludes it from the selector / rail / scoping, and bootstrap skips it.
> ignored_repos         { owner, repo, createdAt }
> // The single-repo unit of work (formerly `workspaces`). Parent workspace is derived via
> // workspace_repos on (repoOwner, repoName).
> tasks                 { id, title, origin, repoOwner, repoName, branch, worktreePath,
>                         pullNumber, status, sort, createdAt, updatedAt, archivedAt }
> task_links            { taskId, provider, identifier, createdAt }
> terminal_sessions     { …, taskId, … }   // was workspaceId
> ```
>
> The rest of this doc reflects the original single-tier design — read "workspace" as "task".

This proposes the minimum schema to make a Workspace a first-class entity. It follows the existing
conventions in `apps/web/src/server/db/schema.ts` exactly. These tables are added to `schema.ts`
up front and ship in the single fresh baseline migration (P0,
[`06`](./06-implementation-phases.md)) — not as incremental ALTERs, so there's no migration
guesswork and no rebuild quirks.

## Convention recap (from the real schema)

- **Machine-scoped** desktop tables (`repo_paths`, `terminal_sessions`) have **no `user_id`** —
  they describe *this machine's* filesystem and are read by the terminal service in the Electron
  main process, outside any GitHub user context (`schema.ts:244`). Workspaces are the same: they own
  local worktrees, so they're machine-scoped.
- Timestamps are `integer('…_at')` epoch millis, set in app code (not DB defaults).
- Text PKs for opaque ids (`terminal_sessions.id = text('id').primaryKey()`).
- Composite PKs via `primaryKey({ columns: [...] })` for join/child tables.
- JSON blobs as `text` columns when a shape should evolve without migrations (`issues.data`,
  `integrations.meta`).

## New entity: `workspaces`

The owning entity. One row per "thing you're working on."

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

Notes:
- `(repoOwner, repoName)` are the join key into the GitHub mirror (`pull_requests`, etc.) and into
  `repo_paths` (to find the base checkout the worktree is added from).
- `pullNumber` + `(repoOwner, repoName)` is the FK-shaped link to `pull_requests`
  (PK `(userId, repoId, number)`). It's nullable — that nullability *is* the local-first state.
- No `agentProfileId` here; the agent lives on the terminal session, not the workspace (a workspace
  can have several terminals with different profiles).

## New entity: `workspace_links`

A workspace can reference zero-or-more external items (Linear tickets, Rollbar errors). This is the
join the current schema lacks — today Linear ids are only parsed out of PR bodies at render time.

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

`(provider, identifier)` deliberately matches the PK tail of the existing `issues` cache table
(`schema.ts:289`), so the Linear pane resolves a link straight into cached issue detail with no new
fetch path: `workspace_links` → `(provider, identifier)` → `issues.data`.

## Change to `terminal_sessions`: bind it to the workspace

Today a session is bound to a PR via three loose columns (`repo_owner`, `repo_name`, `pull_number`)
and made visible by filtering on the **current URL** (`TerminalPanel.tsx:36`) — the source of the
drift. On the fresh baseline (P0, [`06`](./06-implementation-phases.md)) a session belongs to a
workspace from row one, so we make the binding mandatory and drop the loose columns:

```ts
// terminalSessions, on the clean baseline:
workspaceId: text('workspace_id').notNull(),   // → workspaces.id
// repo_owner / repo_name / pull_number are REMOVED — derived via the workspace join.
```

- `NOT NULL`, not nullable: there are no legacy sessions to accommodate. (A clean baseline also means
  no Drizzle table-rebuild — see the risk note in [`06`](./06-implementation-phases.md).)
- Repo / branch / PR context comes from `workspaceId → workspaces`. The main process fills the wire
  type's `repo` / `pull` fields from that join; the columns don't need to be denormalized onto the
  session row.
- Visibility becomes `sessions.filter(s => s.workspaceId === activeWorkspace.id)` — no router
  coupling. The shared wire type `TerminalSession` (`apps/web/src/shared/terminal.ts:4`) gains
  `workspaceId: string`, and `CreateOpts` gains `workspaceId`.
- `isWorktree` (the transient boolean, `terminal.ts:12`) becomes derivable: a session is in a
  worktree iff its `cwd === workspace.worktreePath`. The boolean can stay as a convenience flag but
  the **truth** now lives on the workspace's `worktreePath`.

## Promoting the worktree from "transient path" to "tracked relationship"

vNext Phase 4 creates worktrees at inline paths (`.acorn/worktrees/<owner>-<repo>-pr-<n>`) with no
record. After this change the path lives on `workspaces.worktreePath`, which gives us:
- **Ownership** — exactly one workspace owns a worktree path (the gap cmux flagged).
- **Reuse** — opening a second terminal in the workspace reuses the path instead of re-deriving it.
- **Teardown** — archiving a workspace has a definite path to `git worktree remove`.

Lifecycle detail (dirty detection, recovery, teardown) is in
[`05-lifecycle-and-isolation.md`](./05-lifecycle-and-isolation.md).

## What replaces `Tab` and `workspace:tabs`

Today the rail is client-only state: a `Tab = { id, icon, path }` list serialized into the `prefs`
table under the key `workspace:tabs` (`features/tabs/model.ts:2`, `tabs.ts`). On the clean baseline
this mechanism is **never built** — there is nothing to retire or migrate. The rail renders
workspace entities from the start:

| Old path-bookmark concept | What the rail does instead |
| --- | --- |
| `Tab.path` (a router URL) | derived from the workspace (`/owner/repo` + active pane), not stored as the unit of truth |
| `Tab.icon` (cycled glyph) | a per-workspace icon column *or* derived from `origin`; cosmetic |
| `workspace:tabs` prefs blob | the `workspaces` table (server-owned, queryable, joinable) |
| `seedFromPrefs()` / `recordLocation()` / `persist()` debounce | normal table reads/writes via TanStack Query |

The `prefs` table itself **stays** on the baseline (theme, diff mode, keybindings) — it simply never
gets a `workspace:tabs` key. The existing `TabRail.tsx` UI is reused; only its data source changes
from the tabs signal to a `workspacesOptions` query (P1, [`06`](./06-implementation-phases.md)).
`features/tabs/model.ts` and the persistence in `tabs.ts` are not carried forward.

## Entity-relationship sketch

```
            repo_paths (owner, repo) ── base checkout on disk
                  ▲
                  │ (repoOwner, repoName)
   pull_requests ─┤
   (…, number) ◄──┼── workspaces ──────┐
                  │   id               │ workspaceId
                  │   branch ──────────┼─────────────► terminal_sessions
                  │   worktreePath     │               (panes: shell / agent / dev)
                  │   pullNumber ──────┘
                  │
   issues ◄───────┴── workspace_links (workspaceId, provider, identifier)
   (provider, identifier)
```

## Why not user-scope the new tables?
Consistency with `repo_paths` / `terminal_sessions`: a worktree is a fact about *this machine*, and
acorn is single-user per machine (the migration premise in [`../electron.md`](../electron.md)). If
acorn ever returns to multi-user, machine-scoped tables get a `user_id` at that point — the same
decision the existing desktop tables defer.
