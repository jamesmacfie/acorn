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

- **IPC, not Hono** — mirrors `acorn.editor` / `acorn.local` (request/response via
  `ipcRenderer.invoke`), how every worktree-backed pane already talks to main. No streaming.
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

### IPC surface (`db:*`, all keyed by `taskId`)

| Channel | Returns |
| --- | --- |
| `db:connect` | resolve URL → Pool → `SELECT current_database()` → `{ ok, database }` or `{ error }` |
| `db:tables` | non-system tables → `{ schema, name }[]` |
| `db:columns` | columns + PK columns for a table (drives editing) |
| `db:rows` | `SELECT * FROM "s"."t" ORDER BY <pk> LIMIT $1 OFFSET $2` → `{ columns, rows, total }` |
| `db:query` | arbitrary SQL → `{ columns, rows, rowCount, command }` or `{ error }` |
| `db:update` / `db:insert` / `db:delete` | parameterized DML, identifiers validated |
| `db:disconnect` | `pool.end()`, drop from map |

Cell values are normalized in main (objects → JSON, dates → ISO) so the grid renders uniformly;
`null` stays distinct for `NULL` styling.

## Where the code lives

Main process: `apps/desktop/src/plugins/database/main/database.ts` (IPC + pool cache + `resolveDbUrl`), registered
from `main/terminal.ts`, exposed via `main/preload.ts`. Wire types: `shared/database.ts`.
Client: `apps/desktop/src/client/features/database/{databaseClient.ts,DatabasePane.tsx,ResultGrid.tsx,database.css}`,
wired into the pane system in `client/features/tasks/{layout.ts,TaskView.tsx,paneShortcuts.ts}`.
The `workspaces.dbUrlScript` column lives in `server/db/schema.ts`, edited via
`client/features/settings/WorkspaceSettings.tsx` → `server/routes/workspaces.ts`.

## Smoke test

Open a task with a reachable Postgres, open the Database pane: auto-detect connects; table list
filters; click table → grid; click row → detail; edit/+Row/delete; SQL editor runs SELECT (grid)
and DML (rowcount); set a workspace `dbUrlScript` → reconnect uses it. Toggle theme → editor +
grid follow tokens.
