// Wire types for the Database pane IPC surface (docs/pg.md), shared between the main-process
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
