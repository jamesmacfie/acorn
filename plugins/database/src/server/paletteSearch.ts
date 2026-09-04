import { MAX_COMMAND_SEARCH_ITEMS, type CommandSearchItem } from '@acorn/protocol/commands.ts'
import type { DbSavedQuery } from '../shared/database'

// Ranking the palette's saved-query rows, as a pure function over the list the pane already has.
//
// Separate from the route because this is the only part worth reading twice: the route is scope and
// ownership, and this is what a typed word means. It runs on the node, so the shell's `fuzzyScore` is
// not available to it (that lives in client-core's kit); the ordering below is the same idea spelled
// for a short, stable list — a name beats a note, a note beats the SQL, and equal matches keep the
// order they arrived in, which is the saved-query order the pane's own picker shows
// (docs/database.md § From the command palette).
//
// Three fields, and they are the three a person types: the name they gave it, the note they wrote
// beside it, and a table or a column they remember appearing in the query itself.

// The bounds @acorn/protocol/commands.ts holds a row to. Trimmed here rather than left to the host,
// because the host drops an oversized row outright and a saved query's SQL runs to 20k.
const TITLE = 300
const SUBTITLE = 300

const contains = (haystack: string | null | undefined, needle: string): boolean =>
  !!haystack && haystack.toLowerCase().includes(needle)

/**
 * How well one saved query answers `query`, or `null` for a row that does not answer it at all.
 *
 * Higher is better. The tiers are deliberately coarse: within a tier the incoming order decides, and
 * the incoming order is the one the route already sorts by, so a reader who types nothing useful still
 * gets the project's queries in the order the pane lists them rather than an arbitrary shuffle.
 */
export function savedQuerySearchScore(query: DbSavedQuery, text: string): number | null {
  const needle = text.trim().toLowerCase()
  if (!needle) return 0
  const name = query.name.toLowerCase()
  if (name === needle) return 4
  if (name.startsWith(needle)) return 3
  if (name.includes(needle)) return 2
  if (contains(query.notes, needle)) return 1
  // The SQL last, and it is the reason this tier exists at all: the query somebody wants is often the
  // one that touches a table, and the table name is nowhere but in the statement.
  if (contains(query.sql, needle)) return 0
  return null
}

/** One row, as the palette draws it: display facts and the saved query's own id, which is the id the
 *  pane's editor path loads by. The same summary the agent composer's option list shows
 *  (../server/agentContext.ts), so a person sees one description of a saved query rather than two. */
export const savedQuerySearchItem = (query: DbSavedQuery): CommandSearchItem => ({
  id: query.id,
  title: query.name.slice(0, TITLE),
  subtitle: (query.notes?.trim() || query.sql.replace(/\s+/g, ' ').trim()).slice(0, SUBTITLE) || 'No notes',
  icon: 'database',
})

/** The matching rows, best first, capped at what the host will render anyway. */
export function savedQuerySearchItems(queries: readonly DbSavedQuery[], text: string): CommandSearchItem[] {
  return queries
    .map((query, at) => ({ query, at, score: savedQuerySearchScore(query, text) }))
    .filter((row): row is { query: DbSavedQuery; at: number; score: number } => row.score !== null)
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .slice(0, MAX_COMMAND_SEARCH_ITEMS)
    .map((row) => savedQuerySearchItem(row.query))
}
