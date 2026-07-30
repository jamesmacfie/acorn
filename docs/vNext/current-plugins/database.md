# Database plugin migration

Status: **Normative**<br>
Coordinate: `acorn/database`<br>
Requirement prefix: `CUR-DB`

## 1. Current behavior and authoritative state

V1 connects a Task to a PostgreSQL development database; lists schemas/tables/columns, pages rows,
edits/inserts/deletes by primary key, runs arbitrary SQL, saves repo-scoped named SQL and asks a
configured model provider to generate SQL from live schema/notes/examples. PostgreSQL is
authoritative for database content. Acorn owns saved queries; pools are ephemeral per Task; database
URLs are resolved on connect and not persisted.

- **CUR-DB-001:** V2 MUST preserve arbitrary owner-authored SQL as intentional database code
  execution. It MUST never claim SQL is read-only based on parsing.
- **CUR-DB-002:** Connection secrets remain Node-side opaque references and MUST NOT enter plugin
  UI, context snapshots, events or plugin durable storage.

## 2. Current UI, routes, events, contributions and dependencies

V1 contributes desktop pane `database` (order 70, `meta+shift+j`, minimum 320 px) and agent context
source “Saved database queries.” It directly imports Editor's Monaco setup. Internal Task routes
connect/disconnect; list tables/columns/rows; query/update/insert/delete; saved-query CRUD; schema;
and generate. `/api/v1/plugins/database` exposes connection, table/column/row operations and
arbitrary query.

V1 uses a four-connection `pg` pool per Task, 8-second connection timeout, 500-row pages, exact
`count(*)`, string/null normalized cells, validated/quoted live identifiers for generated edits and
parameterized values. Arbitrary editor SQL runs verbatim. URL resolution is trusted repo
`database.url_script` → worktree `.env DATABASE_URL` → process environment. The repo-authored script
requires config-trust acknowledgement. No product events exist.

## 3. Target classification

- **CUR-DB-003:** Database is bundled **Acorn Verified**, using a WASI policy component plus
  declarative client UI. Node core supplies a brokered PostgreSQL connection/query capability; the
  plugin does not receive sockets or plaintext URLs.
- **CUR-DB-004:** V2 core ships the PostgreSQL broker on macOS arm64/x86_64,
  Linux arm64/x86_64 and Windows x86_64. The Database plugin selects one
  platform-neutral WASI policy artifact on those targets. Another platform or
  a Node build without `acorn.database.postgres/2` fails activation as
  `platform_capability_unavailable`; there is no native fallback artifact,
  direct socket path or raw-credential branch in V2.

## 4. Node, Electron, native-host and renderer split

Node core resolves task/repository paths, executes trusted URL scripts through its command broker,
creates opaque DB leases, enforces destination/timeout/pool limits and performs parameterized
operations. Database owns schema browsing, saved-query policy, SQL generation prompt and contracts.
Electron owns pane state and invokes standard code-editor/table/form renderers. No Electron-native
adapter is required.

- **CUR-DB-005:** Monaco is replaced by `acorn.code-editor/2`; results use
  `acorn.collection/2` with the `acorn.data-grid/2` leaf. Database MUST NOT import Editor implementation.
- **CUR-DB-006:** A lease is bound to `(installation,device,Task,destination,purpose)`, expires after
  30 idle minutes, is non-exportable and is closed on disconnect, Task archive, plugin disable or
  Node shutdown.

## 5. Manifest, capabilities, permissions and dependencies

Required: `acorn.task.read/1`, `acorn.repo.config.read/1`, `acorn.repo.config.execute-trusted/1`,
`acorn.database.postgres.connect/1`, `query/1`, `introspect/1`, `acorn.storage.plugin/1`.
Arbitrary query and row edits require `acorn.database.postgres.mutate/1`. SQL generation optionally
depends on `acorn/model-providers >=2 <3` exported generation capability. Renderer requirements are
`acorn.code-editor/2`, `acorn.collection/2` (`acorn.data-grid/2` leaf), `acorn.form/2` and
`acorn.content/2`; confirmation is host-owned action chrome.

Capabilities are Task/repository scoped. Destination constraints come from approved configuration;
the plugin cannot widen host/port/database or use the DB lease for network traffic.

## 6. Queries, commands, capabilities, events and streams

Queries: `connection.status`, `tables.list`, `columns.list`, `rows.list`, `saved.list`, `schema.get`.
Commands: `connection.open|close`, `sql.execute`, `row.insert|update|delete`,
`saved.upsert|delete`, and `sql.generate`, all namespaced `dev.acorn.database.*.v1`.

`DbCell` is `string|null`; result is columns, row matrix, affected/returned row count, command,
duration and optional next cursor. Rows are 500/page and 5 MiB/result by default; larger results use
object transfer/export rather than unbounded JSON. Identifiers for host-generated SQL must appear in
the same lease's live introspection result and are quoted; values are parameters.

Events are `connection.opened|closed|failed`, `saved.created|updated|deleted`,
`query.completed|failed` and `schema.changed`. They contain Task/lease/query IDs, duration, command
class and row counts only—not SQL, rows, URL or errors containing secrets.

- **CUR-DB-007:** `sql.execute` is always a mutation-risk command, even for text beginning `SELECT`.
  The result records PostgreSQL transaction outcome but is not idempotently retried after an
  uncertain network failure.
- **CUR-DB-008:** Row update/delete includes expected primary-key values and optional xmin/version
  predicate. Zero affected rows is a revision-style conflict; tables without primary keys disable
  row edit/delete.
- **CUR-DB-009:** SQL generate captures exact schema digest, selected saved-query revisions,
  provider/model and user prompt; generated SQL is a draft and MUST require an explicit execute.
- **CUR-DB-010:** No live stream is required for V2 interactive queries. Future COPY/export uses a
  core bounded object stream.

## 7. UI contributions and renderer requirements

Preserve connect/status, schema/table tree, table grid paging, cell detail/edit, insert/delete,
Monaco-equivalent SQL editor, Run, timing/row footer, saved-query load/save/delete, and Generate SQL
modal with provider/model and up to ten examples. Destructive SQL and row delete use host
confirmation. Connection and query errors are safe, copyable summaries with request IDs.

Mobile fallback is schema/saved-query browse and read-only bounded results; arbitrary editor and
row mutation may report unsupported.

## 8. Storage, migration, backup, uninstall and reinstall

Plugin database table `p_saved_queries` owns UUIDv7 ID, Repository URI, name (unique per repository),
notes ≤2,000, SQL ≤20,000, timestamps, revision and tombstone. It is internal/sensitive and included
in encrypted backup. Connection leases/pools/schema cache/results are ephemeral and excluded.

- **CUR-DB-011:** V2 clean-start imports no `db_saved_queries` rows or DATABASE_URL. V1 remains
  unchanged.
- **CUR-DB-012:** Uninstall revokes leases and retains saved-query data 30 days. Reinstall can adopt
  only same-coordinate data and compatible schema.

## 9. Setup, settings, health, update and failure

No global credential wizard is required. Per-repository setup shows connection source and requires
config trust before executing a repo script; it tests a brokered lease without displaying the URL.
Settings cover row cap (maximum host policy), statement timeout and schema notes. Health separates
plugin health, driver health and per-Task database reachability. Pool/Node restart changes connection
to disconnected and preserves drafts/saved queries.

## 10. Security and credential treatment

- **CUR-DB-013:** URL scripts run only after exact config digest acknowledgement, in the Task root,
  with bounded environment/output/time and no shell interpolation by the plugin.
- **CUR-DB-014:** Secret resolution and connection occur in the broker. The plugin receives
  database display name and opaque lease only.
- **CUR-DB-015:** Arbitrary SQL can read/modify everything granted to the database role; UI MUST say
  so. Node must not expose Acorn's own SQLite through this plugin.
- **CUR-DB-016:** Logs/events/context exclude SQL, cells, URL, credentials and raw driver messages.
  Safe errors are bounded; detailed diagnostics require owner-only protected logs.
- **CUR-DB-017:** Host-generated identifiers are live-validated and values parameterized; pasted
  arbitrary SQL is executed exactly as owner code and never attributed to that protection.

## 11. Coupling that must be removed

Move `db_saved_queries` out of core; remove Database → Editor Monaco import, direct core model
provider runtime call, direct `repo_paths`/Task DB reads and application bridge wiring. Replace with
renderer capability, plugin database, task/repo capabilities, brokered DB lease, model-provider
dependency and declared lifecycle hooks.

## 12. Fresh-install parity scenarios

- **CUR-DB-018:** A configured Task connects, displays the same database/tables/columns, pages 500
  normalized rows, and edits primary-key rows with equivalent feedback.
- **CUR-DB-019:** Arbitrary multi-statement SQL returns the final result/timing; database errors do
  not expose URL credentials.
- **CUR-DB-020:** Saved queries remain repository-scoped across Tasks, upsert by name, feed selected
  examples into generation, and appear as redacted-safe agent context.
- **CUR-DB-021:** Missing config trust blocks only script resolution; missing provider blocks only
  Generate; remote Electron works because database execution remains on the owning Node.
