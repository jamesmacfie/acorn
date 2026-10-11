import type { PluginHoverResponse } from '@acorn/protocol/documentSurface.ts'
import type { DbCatalogTable } from '../shared/database'
import { resolveQualifier } from './completions'

// What the query editor shows when a reader hovers a name: a table's columns, or a column's type
// (docs/editor/document-surface.md § Language smarts). Pure and catalog-in, like ./completions.ts, so
// the judgement is testable without a live Postgres.

// A table's hover lists this many columns, then says how many more. Enough to read, and far below the
// host's 64 KiB.
const MAX_LISTED_COLUMNS = 40

const label = (table: DbCatalogTable): string =>
  table.schema === 'public' ? table.name : `${table.schema}.${table.name}`

/** The hover for the name at a one-based position, or null when the position isn't on a known name. */
export function hoverSql(
  text: string,
  position: { line: number; column: number },
  tables: readonly DbCatalogTable[],
): Omit<PluginHoverResponse, 'revision'> | null {
  const line = text.split('\n')[position.line - 1]
  if (line === undefined) return null
  // The identifier under the position, widened both ways over word characters.
  let start = Math.min(position.column - 1, line.length)
  let end = start
  while (start > 0 && /[\w$]/.test(line[start - 1]!)) start--
  while (end < line.length && /[\w$]/.test(line[end]!)) end++
  if (start === end) return null
  const word = line.slice(start, end).toLowerCase()
  const range = { start: { line: position.line, column: start + 1 }, end: { line: position.line, column: end + 1 } }

  // `alias.column`: the qualifier says which table.
  const qualifier = /([a-z_][\w$]*)\.$/i.exec(line.slice(0, start))
  const qualified = qualifier ? resolveQualifier(text, qualifier[1]!, tables) : null
  const candidates = qualified ? [qualified] : tables
  const table = qualified ? null : tables.find((entry) => entry.name.toLowerCase() === word)
  if (table) {
    const listed = table.columns.slice(0, MAX_LISTED_COLUMNS).map((column) => `- \`${column.name}\` ${column.dataType}`)
    const more = table.columns.length - listed.length
    return {
      contents: {
        kind: 'markdown',
        value: [
          `**${label(table)}**, ${table.columns.length} columns`,
          '',
          ...listed,
          ...(more > 0 ? [`- and ${more} more`] : []),
        ].join('\n'),
      },
      range,
    }
  }
  for (const entry of candidates) {
    const column = entry.columns.find((candidate) => candidate.name.toLowerCase() === word)
    if (column)
      return {
        contents: { kind: 'markdown', value: `\`${column.name}\` ${column.dataType} · **${label(entry)}**` },
        range,
      }
  }
  return null
}
