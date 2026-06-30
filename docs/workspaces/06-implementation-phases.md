# 06 — Implementation phases

A path from today's three-axis system to the Workspace model, in the incremental style of
[`../vNext.md`](../vNext.md). Each phase is independently shippable and leaves the app working. The
ordering front-loads a **clean schema baseline** (P0) and the **entity + drift fix** (the
highest-value wins) and defers the bigger UI surgery.

There is **no production data worth preserving**: the GitHub mirror re-syncs from GitHub on launch,
and a single user re-creates their workspaces by hand. So we skip incremental schema surgery
entirely — P0 wipes the data model and migrations and lands the *whole* schema (mirror + app-state +
workspaces) as one fresh baseline. Every later phase then builds against a clean schema, with no
backward-compat, no nullable hedges, and no migration of old state.

---

## P0 — Reset the schema baseline
**Goal:** one fresh migration that already contains the Workspace tables; no legacy data to tend.

- Fold the new tables into `schema.ts` up front: `workspaces`, `workspace_links`, and
  `workspaceId` **`NOT NULL`** on `terminal_sessions` ([`03`](./03-data-model.md)). A clean slate
  means every session belongs to a workspace from row one — no nullable hedge, no rebuild migration.
- **Drop** the now-redundant `repo_owner` / `repo_name` / `pull_number` columns from
  `terminal_sessions`: repo / branch / PR are derived through the `workspaceId` → `workspaces` join.
  The main process fills the `TerminalSession` wire type's `repo` / `pull` fields from that join.
- Delete `apps/web/migrations/*` (all 16 files + `meta/`), then
  `pnpm --filter @acorn/web db:generate` → emits a **single `0000` baseline** for the entire schema.
- Delete `apps/web/.acorn/acorn.sqlite` (and `blobs/`). Next launch auto-migrates the baseline
  (`openDb()` → `migrate()` in `apps/web/src/main/bindings.ts`), re-syncs the GitHub mirror, and
  starts with zero workspaces.
- **better-sqlite3 ABI dance** still applies: `node:rebuild` for `db:migrate`, `electron:rebuild`
  for `pnpm dev` — see [`../local-development.md`](./../local-development.md) and CLAUDE.md.
- **Done when:** a fresh DB is created from one migration; the schema has `workspaces`,
  `workspace_links`, and `terminal_sessions.workspaceId`; the app launches and re-mirrors GitHub.

## P1 — The `workspaces` entity + rail backed by it
**Goal:** a real owning entity exists; the rail reads from it.

The tables already exist (P0), so this phase is pure feature code — no migration.

- Server routes: CRUD for workspaces (create / list-active / rename / archive). New router under
  `apps/web/src/server/routes/`, bindings already provide the DB.
- Client: the **Workspaces** zone of `TabRail.tsx` renders rows from a `workspacesOptions` query.
  The rail is wired to workspace entities from the start (the path-bookmark tab mechanism in
  `features/tabs/model.ts` / `tabs.ts` is never built — see [`03`](./03-data-model.md)). Keep the
  `workingCountFor()` agent indicator.
- **Done when:** you can create/rename/archive a workspace and it persists across restart; the rail
  shows workspace rows.

## P2 — Bind terminals to `workspaceId` (kill the drift)
**Goal:** the disconnect from [`README.md`](./README.md) is gone.

The `workspaceId` column landed in P0, so this is wiring only — no schema step.

- Add `workspaceId` (and the derived `repo` / `pull`) to the wire types `TerminalSession` /
  `CreateOpts` (`apps/web/src/shared/terminal.ts`).
- `TerminalPanel` visibility filter changes from `params.owner/repo` (`TerminalPanel.tsx:36`) to
  `s.workspaceId === activeWorkspace.id`. The global `sessions` store stays; only the filter changes.
- Session creation passes the active workspace's id.
- **Done when:** switching workspaces swaps the visible terminals; a terminal opened in workspace A
  never shows under workspace B, regardless of the URL.

## P3 — Promotion flow + persisted worktree lifecycle
**Goal:** Source items become workspaces; worktrees are owned and torn down cleanly.

- "Open as workspace" on GitHub PR rows (Flow A, [`02`](./02-ui-design.md)) → creates a workspace
  with `origin: 'github-pr'`, `branch = headRef`, `pullNumber`, and Linear-id links parsed from the
  PR body.
- Local-first: "New workspace" → repo + new branch (`origin: 'local'`).
- Lazy worktree on first terminal (Flow C): persist `worktreePath`; reuse on subsequent terminals.
  Reuse existing `api.worktree.ensure()` / `.remove()` (vNext §9); re-key the path by branch.
- Archive guard: refuse teardown when sessions are running or the worktree is dirty
  ([`05`](./05-lifecycle-and-isolation.md)).
- PR inheritance (Flow B): on PR sync, match a no-`pullNumber` workspace's `branch` against
  `pull_requests.headRef` and set `pullNumber`.
- **Done when:** you can promote a PR, open a terminal (worktree appears, owned by the workspace),
  archive it (worktree removed only when clean + idle), and a local-first workspace gains a PR
  automatically after one is opened.

## P4 — Pane switcher + PR review as a pane + Sources split out
**Goal:** the cohesive single-window view.

- Pane switcher (the small view icons) drives the active pane per workspace.
- `PullDetail` + `DiffView` become the **PR review pane** (likely dropping the list column).
- `LinearIssuePanel` becomes the **Linear pane**, resolving via `workspace_links`.
- Rail gains the **Sources** zone; `PullList` becomes the **GitHub Source** browse view.
- Linear Source browse view (thin list over existing `linearIssuesOptions`).
- **Done when:** a workspace shows PR review / Linear / terminal panes via the switcher; the GitHub
  Source view lists PRs cross-repo and promotes them; Linear appears as a Source when connected.

## P5 — Dev-server pane + Rollbar + browser preview (seam)
**Goal:** local-run support and the remaining integrations.

- Per-repo run command + per-workspace port ([`05`](./05-lifecycle-and-isolation.md)); **dev-server
  pane** runs it in the worktree.
- **Browser-preview pane**: a `<webview>` onto `localhost:<port>`. Electron `<webview>` only;
  respect the existing hardened-window posture in [`../electron.md`](../electron.md).
- **Rollbar Source**: `integrations` row + `IntegrationsModal` field + a browse view caching into
  `issues` ([`04`](./04-sources-and-integrations.md)).
- **Done when:** a workspace can run its dev server and preview it; Rollbar errors can be promoted to
  workspaces.

---

## Sequencing rationale
- **P0 is a one-time reset**: collapsing the migrations and landing the full schema once is far
  cheaper than threading `workspaceId` through a populated table with incremental ALTERs — and
  there's no data to lose.
- **P1+P2 are the cheap, high-value core**: they fix the actual disconnect and create the entity,
  with almost no UI surgery. If the project stops after P2, acorn is already meaningfully better.
- **P3 is the behavioural heart** (promotion + owned worktrees) — the part that needs the most care
  (the lifecycle guards in [`05`](./05-lifecycle-and-isolation.md)).
- **P4 is presentation** — reorganizing components that already exist into panes.
- **P5 is additive** — new panes/sources that don't change the core model.

## Risks & gotchas
- **better-sqlite3 ABI** (P0 / any `db:migrate`): the recurring footgun — see the CLAUDE.md note and
  [`../local-development.md`](../local-development.md).
- **The Drizzle `NOT NULL` table-rebuild quirk does not bite here**: because P0 generates the schema
  from scratch (empty table), `terminal_sessions.workspaceId` can be `NOT NULL` with no hand-trimmed
  `INSERT … SELECT` rebuild — the exact pain the clean baseline avoids.
- **`Env` type** (`apps/web/src/env.d.ts`): only needs updating if a phase changes the bindings
  shape; the new tables don't.
- **Confirm the wipe is intended**: P0 deletes the local DB and all migrations. That's the agreed
  premise (no data worth keeping), but it is the one irreversible-feeling step — the GitHub mirror
  re-syncs, yet local-only state (e.g. viewed-file checkmarks) is gone.

## Out of scope (named, not built)
Container/devcontainer runtime isolation; crash-time content snapshots; cross-source dedup;
bi-directional integration sync. See the deferred sections of [`04`](./04-sources-and-integrations.md)
and [`05`](./05-lifecycle-and-isolation.md).
