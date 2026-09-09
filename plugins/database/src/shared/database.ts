// Wire types for the Database pane HTTP/bridge boundary, shared between the node handlers
// (main/database.ts) and the frame client (frame/databaseClient.ts). Cell values are normalized to
// string | null in main (numbers/booleans to string, objects to JSON, dates to ISO) so the grid renders
// uniformly and `null` stays distinct for NULL styling.
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
// table/column completions (docs/editor.md § Language smarts), which need to look names up by
// table rather than read prose.
export type DbCatalogTable = { schema: string; name: string; columns: { name: string; dataType: string }[] }
export type DbCatalogResult = { tables: DbCatalogTable[] } | { error: string }

// AI query generation (docs/data-layer.md § Database plugin: the Postgres pane): where the schema text
// in the prompt came from, and the result of a generate call. Generate errors travel as HTTP error
// responses, not a union.
export type DbSchemaSource = 'auto' | 'script' | 'file'
// `notes` is the project's free-form schema notes (projects.db_schema_notes), facts the schema text
// can't express, carried here so the route needs no repo lookup.
export type DbSchemaResult = { schema: string; source: DbSchemaSource; notes?: string } | { error: string }
export type DbGenerateResult = { sql: string; providerId: string; modelId: string }

// Shared so the modal's maxlength and the route's zod bound can't drift apart.
export const GENERATE_MAX_PROMPT_CHARS = 4000

// The one selection id that is not a saved query's. The palette's `Generate SQL` writes the scratch
// document on the node and then opens the pane; the pane may already be open, in which case its editor
// loaded the old text and nothing would tell it otherwise. So the success row carries this instead of a
// row id, and the panel reads it as "re-read the scratch document" (server/routes/database.ts,
// tree/DatabasePanel.tsx). A `#` prefix so it can never collide with the UUIDs saved queries carry.
export const SCRATCH_SELECT_ID = '#scratch'

// A named SQL snippet saved against a project (docs/data-layer.md § Database plugin: the Postgres
// pane): loaded back into the editor, and optionally fed to AI generation as a worked example.
export type DbSavedQuery = { id: string; name: string; notes: string | null; sql: string; updatedAt: number }

// Database pane: per-task Postgres browse and edit over this plugin's own route namespace. Built here
// rather than spelled at each call site so the frame, the manifest's document region, and the route
// table cannot drift apart. The manifest declares the scratch and completions paths as literals with
// `:taskId` in them, the one form these helpers cannot produce.
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
// The task's scratch document, as this plugin's own route rather than the host's document handle: the
// panel reads it back after the palette's `Generate SQL` wrote it, which is a question about the stored
// row and not about what is in the editor right now.
export const databaseScratchRoute = (taskId: string) => taskRoute(taskId, '/scratch')
export const databaseQueryRoute = (taskId: string, queryId: string) => taskRoute(taskId, `/queries/${encodeURIComponent(queryId)}`)
// Which backends this owner could generate with — a stored key, or an agent CLI installed on this
// machine. A plugin route rather than a bridge call because `/v2/core/integrations` has no bridge
// scope, and the frame needs ids and labels, not keys.
//
// The path still says `model-connections` after the rename. Only code that ships with this plugin
// reads it — this client and the `optionsRoute` on the `database:generate` step field — so a rename
// would be churn with nothing on the other side of it.
export const databaseModelBackendsRoute = (taskId: string) => taskRoute(taskId, '/model-connections')
