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
- **AI query generation** — describe a query in prose, get PostgreSQL back in the editor.
- **Saved queries** — name + notes + SQL, kept per repo, loaded back from the editor bar and
  optionally fed to generation as worked examples.

Out of scope for now: query history, Structure/DDL tabs, in-grid cell editing, functions/views
browser, CSV export, cross-task connection pooling. Marked with `// ponytail:` where they'd land.

## Connection resolution (no stored secret)

The URL embeds a password, so it is **resolved on demand at connect time and never persisted**.
Order (in `database.ts` `resolveDbUrl`):

1. Repo has a `dbUrlScript` → run it in the task's worktree (`bash -lc`), use trimmed stdout. Resolved
   via `loadRepoConfig`, so a committed `.acorn/config.toml` `[database].url_script` wins over the
   `repo_paths.dbUrlScript` fallback.
2. Else auto-detect: `DATABASE_URL=` in `<worktree>/.env`, then `process.env.DATABASE_URL`.
3. Else → the pane prompts to set a connection script in the repo's settings.

The optional script is **repo-level** (repo-level-settings): the `repo_paths.dbUrlScript` column (or a
committed `[database].url_script`), edited per-repo under the workspace page alongside the dev/setup
scripts. It handles setups auto-detect can't read — Rails `database.yml`, direnv, etc. (e.g. `bin/rails
runner 'puts ActiveRecord::Base.connection_db_config.url'`).

## Architecture

- **Task-scoped HTTP** — renderer requests hit `/api/tasks/:id/database/*`; route handlers delegate
  through an injected utility-service bridge. No streaming.
- **`pg` (node-postgres)** — not a native module (no better-sqlite3-style ABI dance). One `pg.Pool`
  per task, cached `Map<taskId, { pool, url }>`; `pool.end()` on disconnect/reconnect.
- **Pane is registry-owned client presentation** — panes are not DB rows; the database plugin
  contributes the `database` descriptor while connection configuration stays in `repo_paths`.
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
| `POST /generate` | `{ connectionId, modelId?, prompt, queryIds? }` → `{ sql, providerId, modelId }` |
| `GET /queries` | this repo's saved queries → `{ id, name, notes, sql, updatedAt }[]` |
| `POST /queries` | `{ name, notes, sql }` → upsert on (repo, name) → the stored query |
| `DELETE /queries/:queryId` | drop it (scoped to the task's repo) |

Cell values are normalized in main (objects → JSON, dates → ISO) so the grid renders uniformly;
`null` stays distinct for `NULL` styling.

The saved-query routes are the only ones that **don't** go through the bridge — they're plain app
state in the server DB (`db_saved_queries`), like `review_notes`. None of `/generate`, `/queries` are
exposed on the public `/api/v1` surface; they're renderer-only.

## AI query generation

`Generate` in the editor bar (visible only when a model-provider connection is configured — see
[integrations.md](./integrations.md)) collects a prose description and a model, and the route
builds the system prompt from up to three pieces (`server/generateSql.ts` `buildSystemPrompt`):

1. **The schema** — per-repo source, `repo_paths.dbSchemaMode` / `dbSchemaValue`: `auto` (live
   introspection via `formatSchema`, the default), `script` (a command's stdout), or `file` (a
   worktree-relative path). Capped at `SCHEMA_CHAR_CAP` 80k.
2. **Schema notes** — `repo_paths.dbSchemaNotes`, free-form prose for facts the schema can't express:
   what a `jsonb` column actually holds, what a status column's values mean, which of two similar
   tables is live. Edited per repo in the same settings block as the schema source.
3. **Example queries** — the saved queries picked in the modal's multi-select, each rendered as its
   name and notes as `--` comments above its SQL.

Notes + examples share one `GENERATE_MAX_CONTEXT_CHARS` (16k) budget, truncated as a block so the
schema is never the thing that gets cut; 80k + 16k stays under the model runtime's 100k system-prompt
limit. The reply is expected to be the query itself — `stripSqlFences` unwraps a fenced reply
defensively, and the result replaces the editor contents rather than executing.

## Saved queries

`db_saved_queries` is keyed by `(repo_owner, repo_name)`, **not** by task: a query written against a
repo's schema outlives any one worktree. The renderer still addresses the routes by task id (that's
what a pane has) and the route resolves the repo from `tasks`; an id belonging to another repo won't
resolve, so it can't be smuggled into a prompt.

`(owner, repo, name)` is unique and `POST /queries` upserts, so **saving under an existing name
overwrites it** — that is also the edit and rename path. There is deliberately no PATCH route and no
edit form. Notes are worth writing even for a query you only ever load by hand, because they're what
travels into the prompt when it's used as an example.

## Where the code lives

Utility service (historical `main` path):
`plugins/database/src/main/database.ts` (pool cache + `resolveDbUrl` +
`schema()`, which resolves the schema source and carries the repo's notes back with it). HTTP routes:
`plugins/database/src/server/routes/database.ts`; prompt assembly:
`server/generateSql.ts`; wire types: `shared/database.ts`. Client:
`plugins/database/src/client/` — `DatabasePane.tsx` plus `GenerateSqlModal.tsx` and
`SaveQueryModal.tsx`. Both the saved-query dropdown and the example multi-select are the shared
`@acorn/client-core/ui/Picker.tsx` (the latter with its `keepOpen` prop, which is what makes one Picker do
multi-select).

The `repo_paths` columns (`dbUrlScript`, `dbSchemaMode`, `dbSchemaValue`, `dbSchemaNotes`) and
`db_saved_queries` live in `packages/node-core/src/server/db/schema.ts`. The repo columns are edited via
the per-repo section of `@acorn/client-core/settings/WorkspaceSettings.tsx` → `PUT
/api/terminal/repo-path/config` (`@acorn/node-core/main/repoPaths.ts` `setRepoConfig`); the schema-source, notes,
and generation UI are all gated on `availableModelConnections(...)` being non-empty.

## Smoke test

Open a task with a reachable Postgres, open the Database pane: auto-detect connects; table list
filters; click table → grid; click row → detail; edit/+Row/delete; SQL editor runs SELECT (grid)
and DML (rowcount); set a repo `dbUrlScript` → reconnect uses it. Toggle theme → editor +
grid follow tokens.

With a model provider connected: type SQL → `Save` with a name + notes → `Queries ▾` lists it →
selecting it loads the SQL back → saving again under the same name overwrites rather than duplicating
→ the row `✕` deletes it. Then write schema notes in the repo settings, pick a saved query as an
example in `Generate`, and ask for something only the notes could tell it (e.g. a key inside a `jsonb`
column) — the generated SQL should use it.
