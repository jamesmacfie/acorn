# Database pane (Postgres)

A native Postgres viewer/editor pane, Postico-shaped, in acorn's own design language. Tasks run
against per-worktree dev Postgres databases (e.g. Runn's `runn_development`); this pane lets you
inspect and edit them without leaving for Postico/psql, and without embedding a foreign web app in
the hardened window (a cross-origin iframe can't be restyled, so it would never match the theme).

## Scope (v1, shipped)

- **Table list** sidebar — searchable, virtualized (the PullList recipe).
- **Row viewer/editor** — click a table → grid of rows; click a row → a detail panel that also
  edits/inserts/deletes (the write surface; the grid itself stays display-only in v1).
- **SQL editor** — Monaco (`language: 'sql'`), Execute → results grid below.

Out of scope for now: query history, Structure/DDL tabs, in-grid cell editing, functions/views
browser, CSV export, cross-task connection pooling. Marked with `// ponytail:` where they'd land.

## Connection resolution (no stored secret)

The URL embeds a password, so it is **resolved on demand at connect time and never persisted**.
Order (in `database.ts` `resolveDbUrl`):

1. Workspace has a `dbUrlScript` → run it in the task's worktree (`bash -lc`), use trimmed stdout.
2. Else auto-detect: `DATABASE_URL=` in `<worktree>/.env`, then `process.env.DATABASE_URL`.
3. Else → the pane prompts to set a connection script in Workspace Settings.

The optional script is a per-workspace column (`workspaces.dbUrlScript`), edited in Workspace
Settings alongside the dev/setup scripts. It handles setups auto-detect can't read — Rails
`database.yml`, direnv, etc. (e.g. `bin/rails runner 'puts ActiveRecord::Base.connection_db_config.url'`).

## Architecture

- **Task-scoped HTTP** — renderer requests hit `/api/tasks/:id/database/*`; route handlers delegate
  through an injected main-process bridge. No streaming.
- **`pg` (node-postgres)** — not a native module (no better-sqlite3-style ABI dance). One `pg.Pool`
  per task, cached `Map<taskId, { pool, url }>`; `pool.end()` on disconnect/reconnect.
- **Pane is client-only** — panes aren't DB rows, so this is just a new `PaneId`. The only migration
  is `workspaces.dbUrlScript`.
- **Editing via the row-detail panel**, not editable virtualized cells — a form covers
  view/edit/insert/delete far more simply.
- **SQL-injection posture** — values are always parameterized (`$1…`); identifiers (table/column
  names) can't be, so every identifier in generated SQL is validated against the introspected
  schema and double-quoted. Arbitrary SQL from the editor runs verbatim (it's the user's own DB;
  writes are wanted).

### HTTP surface (all keyed by `taskId`)

| Route suffix | Returns |
| --- | --- |
| `POST /connect` | resolve URL → Pool → `SELECT current_database()` → `{ ok, database }` or `{ error }` |
| `GET /tables` | non-system tables → `{ schema, name }[]` |
| `GET /columns` | columns + PK columns for a table (drives editing) |
| `GET /rows` | `SELECT * FROM "s"."t" ORDER BY <pk> LIMIT $1 OFFSET $2` → `{ columns, rows, total }` |
| `POST /query` | arbitrary SQL → `{ columns, rows, rowCount, command }` or `{ error }` |
| `POST /update`, `/insert`, `/delete` | parameterized DML, identifiers validated |
| `POST /disconnect` | `pool.end()`, drop from map |

Cell values are normalized in main (objects → JSON, dates → ISO) so the grid renders uniformly;
`null` stays distinct for `NULL` styling.

## Where the code lives

Main process: `apps/desktop/src/plugins/database/main/database.ts` (pool cache + `resolveDbUrl`).
HTTP routes: `apps/desktop/src/plugins/database/server/routes/database.ts`; wire types:
`apps/desktop/src/plugins/database/shared/database.ts`. Client:
`apps/desktop/src/plugins/database/client/`. The `workspaces.dbUrlScript` column lives in
`apps/desktop/src/core/server/db/schema.ts`, edited via
`core/client/settings/WorkspaceSettings.tsx` → `core/server/routes/workspaces.ts`.

## Smoke test

Open a task with a reachable Postgres, open the Database pane: auto-detect connects; table list
filters; click table → grid; click row → detail; edit/+Row/delete; SQL editor runs SELECT (grid)
and DML (rowcount); set a workspace `dbUrlScript` → reconnect uses it. Toggle theme → editor +
grid follow tokens.
