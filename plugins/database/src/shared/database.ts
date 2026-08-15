// Wire types for the Database pane HTTP/bridge boundary (docs/pg.md), shared between the main-process
// handlers (main/database.ts) and the renderer client (client/features/database/databaseClient.ts).
// Cell values are normalized to string | null in main (numbers/booleans → string, objects → JSON,
// dates → ISO) so the grid renders uniformly and `null` stays distinct for NULL styling.
export type DbCell = string | null

export type DbColumn = { name: string; dataType: string; nullable: boolean; isPk: boolean }
export type DbTable = { schema: string; name: string }

export type DbResultSet = { columns: string[]; rows: DbCell[][]; rowCount: number | null; command: string }

export type DbConnectResult = { ok: true; database: string } | { ok: false; error: string }
export type DbTablesResult = { tables: DbTable[] } | { error: string }
export type DbColumnsResult = { columns: DbColumn[] } | { error: string }
export type DbRowsResult = (DbResultSet & { total: number | null }) | { error: string }
export type DbQueryResult = (DbResultSet & { ms: number }) | { error: string }
export type DbWriteResult = { ok: true; rowCount: number } | { ok: false; error: string }

// A primary-key locator for update/delete: column name → its current (string) value.
export type DbPk = Record<string, DbCell>

// The introspected catalog, structured rather than the CREATE-TABLE text `schema` returns. It backs
// table/column completions (docs/third-party/monaco.md § Language smarts), which need to look names up by
// table rather than read prose.
export type DbCatalogTable = { schema: string; name: string; columns: { name: string; dataType: string }[] }
export type DbCatalogResult = { tables: DbCatalogTable[] } | { error: string }

// AI query generation (docs/pg.md): where the schema text in the prompt came from, and the result
// of a generate call. Generate errors travel as HTTP error responses, not a union.
export type DbSchemaSource = 'auto' | 'script' | 'file'
// `notes` is the project's free-form schema notes (projects.db_schema_notes) — facts the schema text
// can't express (JSONB shapes, enum meanings), carried here so the route needs no repo lookup.
export type DbSchemaResult = { schema: string; source: DbSchemaSource; notes?: string } | { error: string }
export type DbGenerateResult = { sql: string; providerId: string; modelId: string }

// Shared so the modal's maxlength and the route's zod bound can't drift apart.
export const GENERATE_MAX_PROMPT_CHARS = 4000

// A named SQL snippet saved against a project (docs/pg.md): loaded back into the editor, and optionally
// fed to AI generation as a worked example (name + notes + SQL).
export type DbSavedQuery = { id: string; name: string; notes: string | null; sql: string; updatedAt: number }

// Database pane: per-task Postgres browse/edit over this plugin's own route namespace. Built here
// rather than spelled at each call site so the frame, the manifest's document region and the route
// table cannot drift apart — the manifest declares the scratch and completions paths as literals with
// `:taskId` in them, which is the one form these helpers cannot produce.
//
// The redundant `/database/` segment these carried before the move is gone. Nothing outside this plugin
// ever held one: the namespace prefix already says which plugin is answering.
export const DATABASE_ROUTE_PREFIX = '/v2/p/database'
const taskRoute = (taskId: string, rest: string) => `${DATABASE_ROUTE_PREFIX}/tasks/${encodeURIComponent(taskId)}${rest}`

export const databaseTablesRoute = (taskId: string) => taskRoute(taskId, '/tables')
export const databaseColumnsRoute = (taskId: string, schema: string, name: string) =>
  taskRoute(taskId, `/columns?schema=${encodeURIComponent(schema)}&name=${encodeURIComponent(name)}`)
export const databaseRowsRoute = (taskId: string, schema: string, name: string, offset?: number) =>
  taskRoute(taskId, `/rows?schema=${encodeURIComponent(schema)}&name=${encodeURIComponent(name)}${offset ? `&offset=${offset}` : ''}`)
export const databaseActionRoute = (taskId: string, action: 'connect' | 'disconnect' | 'query' | 'update' | 'insert' | 'delete' | 'generate') =>
  taskRoute(taskId, `/${action}`)
// Saved queries: project-scoped rows, addressed through the task (the project is resolved server-side).
export const databaseQueriesRoute = (taskId: string) => taskRoute(taskId, '/queries')
export const databaseQueryRoute = (taskId: string, queryId: string) => taskRoute(taskId, `/queries/${encodeURIComponent(queryId)}`)
// Which model connections this owner could generate with. A plugin route rather than a bridge call
// because `/v2/core/integrations` has no bridge scope, and the frame needs ids and labels, not keys.
export const databaseModelConnectionsRoute = (taskId: string) => taskRoute(taskId, '/model-connections')
