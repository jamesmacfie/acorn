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

// AI query generation (docs/pg.md): where the schema text in the prompt came from, and the result
// of a generate call. Generate errors travel as HTTP error responses, not a union.
export type DbSchemaSource = 'auto' | 'script' | 'file'
// `notes` is the repo's free-form schema notes (repo_paths.db_schema_notes) — facts the schema text
// can't express (JSONB shapes, enum meanings), carried here so the route needs no repo lookup.
export type DbSchemaResult = { schema: string; source: DbSchemaSource; notes?: string } | { error: string }
export type DbGenerateResult = { sql: string; providerId: string; modelId: string }

// Shared so the modal's maxlength and the route's zod bound can't drift apart.
export const GENERATE_MAX_PROMPT_CHARS = 4000

// A named SQL snippet saved against a repo (docs/pg.md): loaded back into the editor, and optionally
// fed to AI generation as a worked example (name + notes + SQL).
export type DbSavedQuery = { id: string; name: string; notes: string | null; sql: string; updatedAt: number }
