import { capabilityId } from '@acorn/protocol/plugin/ids.ts'

// One read of a repo's database, capped and read-only (docs/database.md § Workflow steps).
//
// It exists as a capability rather than as a function inside the plugin because two callers need the
// same path: the `database:query` and `database:generate` workflow steps, and anything later that
// wants a repo's data without going through the pane. One path means one row cap and one read-only
// refusal, instead of each caller remembering both.

/** A cell, as the pane renders it: every value flattened to text, and NULL kept distinct. */
export type DatabaseQueryCell = string | null

export type DatabaseQueryResult = {
  columns: string[]
  rows: DatabaseQueryCell[][]
  rowCount: number
  /** The query returned more rows than the cap allowed, and these are the first of them. */
  truncated: boolean
}

export type DatabaseQuery = {
  /**
   * Run one read against the task's database. Rejects when the statement is not a read, when the
   * task has no reachable database, or when the query itself errors.
   */
  query(taskId: string, sql: string, options?: { maxRows?: number }): Promise<DatabaseQueryResult>
}

export const DATABASE_QUERY = capabilityId<DatabaseQuery>('database.query')

/** The most rows this capability will ever hand back. A step's output is interpolated into a prompt,
 *  so the cap is about what a reader can use, not about what Postgres can return. */
export const MAX_QUERY_ROWS = 200

// Statements that only read. Everything else is refused, including a `WITH` whose body writes, which
// PostgreSQL allows and which is the one way a statement that starts like a read is not one.
const READ_ONLY_LEAD = new Set(['select', 'with', 'show', 'explain', 'table', 'values'])
const WRITES = /\b(insert|update|delete|merge|create|drop|alter|truncate|grant|revoke|copy|call|refresh|vacuum|lock|set)\b/i

/**
 * Why this statement is not a read, or `null` when it is one.
 *
 * A guard over authored SQL, not a sandbox. It reads the leading keyword of each statement, and for a
 * `WITH` it also refuses a write anywhere in the body. A function called from a `SELECT` can still
 * write, which no amount of text matching would catch; the refusal that would catch it is a
 * read-only transaction, and that is the seam `database:write` opens (docs/database.md).
 */
export function readOnlyRefusal(sql: string): string | null {
  const statements = sql
    // Line and block comments first: a leading comment would otherwise be read as the keyword.
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
  if (!statements.length) return 'there is nothing to run'
  for (const statement of statements) {
    const lead = statement.split(/\s+/)[0]?.toLowerCase() ?? ''
    if (!READ_ONLY_LEAD.has(lead)) return `'${lead.slice(0, 20)}' writes, and this step only reads`
    if (lead === 'with' && WRITES.test(statement)) return 'this WITH statement writes, and this step only reads'
  }
  return null
}
