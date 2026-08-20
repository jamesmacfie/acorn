import type { PluginCompletionItem } from '@acorn/protocol/documentSurface.ts'
import type { DbCatalogTable } from '../shared/database'

// Table and column completions for the query editor. See docs/third-party/monaco.md § Language smarts.
//
// The host never learns SQL. It POSTs `{ text, position }` to the route this file backs and maps the
// items straight onto its editor; every line below, what counts as a keyword, what `alias.` means, which
// clause wants tables, is this plugin's, because this is where the schema knowledge already lives. That
// boundary is the reason the same host provider serves a GraphQL console or a YAML config plugin with no
// host change at all.
//
// Worth recording, because it looks like the host is shirking: SQL is not one of Monaco's language-service
// workers. The 14.58 MiB of workers cover TypeScript, JSON, CSS and HTML; for SQL, Monaco ships
// tokenization only and completions are a provider someone has to write. So the host-owned document
// surface loses nothing here: every path, including the frame-bundled Monaco that was measured dead,
// would have had to write this exact function.
//
// Pure, and takes the catalog as an argument, because this is the part worth testing and a live Postgres
// is not.

// Enough to be useful in an editor whose author knows SQL, deliberately not a dialect reference. The
// long tail is what the reader types anyway, and a completion list that offers three hundred keywords
// is one people learn to dismiss.
const KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT JOIN', 'INNER JOIN', 'ON', 'GROUP BY', 'ORDER BY', 'HAVING',
  'LIMIT', 'OFFSET', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'RETURNING', 'DISTINCT',
  'AS', 'AND', 'OR', 'NOT', 'NULL', 'IS NULL', 'IS NOT NULL', 'IN', 'BETWEEN', 'LIKE', 'ILIKE',
  'COUNT(*)', 'WITH', 'UNION', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'ASC', 'DESC',
]

// The clauses after which a name is a table. `INTO` covers `INSERT INTO`, `UPDATE` its own target.
const TABLE_CLAUSES = /\b(from|join|into|update|table)\s+(?:[a-z_][\w$]*\.)?[\w$"]*$/i

// `alias.` or `schema.table.` immediately before the cursor. Captured without the trailing dot so the
// resolver below can treat it as either an alias or a real table name.
const QUALIFIER = /([a-z_][\w$]*)\.\s*$/i

/** The text on this line up to (and excluding) the cursor. Column is 1-based, as it is on the wire. */
export function textBeforeCursor(text: string, position: { line: number; column: number }): string {
  const lines = text.split('\n')
  // A position past the end of the document is not an error worth failing a popup over. It is what a race
  // between a keystroke and a fetch looks like. Clamp and answer.
  const index = Math.min(Math.max(position.line, 1), lines.length) - 1
  const line = lines[index] ?? ''
  return line.slice(0, Math.max(position.column - 1, 0))
}

/**
 * Which table an `alias.` refers to. Aliases are read out of the statement itself — `FROM orders o`,
 * `JOIN users AS u` — because that is the only place they exist.
 *
 * Falls back to matching the qualifier against real table names, so `public.` and `orders.` work
 * without an alias ever having been declared.
 */
export function resolveQualifier(text: string, qualifier: string, tables: readonly DbCatalogTable[]): DbCatalogTable | null {
  const lower = qualifier.toLowerCase()
  // `FROM <schema.>?<table> <alias>` or `JOIN <table> AS <alias>`. Bounded by the statement text the caller
  // already holds; no backtracking risk, because every quantifier is over a character class.
  const alias = new RegExp(`\\b(?:from|join|update|into)\\s+(?:([a-z_][\\w$]*)\\.)?([a-z_][\\w$]*)(?:\\s+as)?\\s+${lower}\\b`, 'i').exec(text)
  if (alias) {
    const [, schema, name] = alias
    const match = tables.find((t) => t.name.toLowerCase() === name.toLowerCase() && (!schema || t.schema.toLowerCase() === schema.toLowerCase()))
    if (match) return match
  }
  // Not an alias, then: a bare table name, or a schema the reader is drilling into. A schema qualifier has
  // no columns of its own, so it resolves to nothing and the caller falls through to tables.
  return tables.find((t) => t.name.toLowerCase() === lower) ?? null
}

const tableLabel = (table: DbCatalogTable): string => (table.schema === 'public' ? table.name : `${table.schema}.${table.name}`)

/**
 * What to offer at this position. Three cases, in the order they are tested:
 *
 *   `alias.`             → that table's columns, and nothing else. The reader has already said what.
 *   after FROM/JOIN/…    → tables, because a name in that slot is a relation.
 *   anything else        → columns of the tables this statement mentions, then tables, then keywords.
 *
 * The third case is the one that earns its keep: in `SELECT ` with `FROM orders` further along the
 * line, the useful list is orders' columns, and offering the whole database's is what makes a
 * completion popup something people switch off.
 */
export function completeSql(
  text: string,
  position: { line: number; column: number },
  tables: readonly DbCatalogTable[],
): PluginCompletionItem[] {
  const before = textBeforeCursor(text, position)
  const qualified = QUALIFIER.exec(before)
  if (qualified) {
    const table = resolveQualifier(text, qualified[1], tables)
    if (table) {
      return table.columns.map((column) => ({ label: column.name, kind: 'field', detail: `${column.dataType} · ${tableLabel(table)}` }))
    }
    // A schema qualifier: offer that schema's tables unqualified, since the reader already typed it.
    const schema = qualified[1].toLowerCase()
    const inSchema = tables.filter((t) => t.schema.toLowerCase() === schema)
    if (inSchema.length) return inSchema.map((t) => ({ label: t.name, kind: 'class', detail: t.schema }))
    return []
  }

  const tableItems = tables.map((table): PluginCompletionItem => ({
    label: tableLabel(table),
    kind: 'class',
    detail: `${table.columns.length} columns`,
  }))
  if (TABLE_CLAUSES.test(before)) return tableItems

  // Columns of whatever this statement already names, so `SELECT |` after `FROM orders` is useful.
  // Deduplicated by name: two tables with an `id` should offer one row, not one per table.
  const mentioned = tables.filter((table) => new RegExp(`\\b${table.name.replace(/[^\w$]/g, '')}\\b`, 'i').test(text))
  const seen = new Set<string>()
  const columnItems: PluginCompletionItem[] = []
  for (const table of mentioned) {
    for (const column of table.columns) {
      if (seen.has(column.name)) continue
      seen.add(column.name)
      columnItems.push({ label: column.name, kind: 'field', detail: `${column.dataType} · ${tableLabel(table)}` })
    }
  }
  return [...columnItems, ...tableItems, ...KEYWORDS.map((label): PluginCompletionItem => ({ label, kind: 'keyword' }))]
}
