import type { DbSavedQuery } from '../shared/database'

// SQL identifiers are quoted because table and schema names come from the database, not from a
// trusted hardcoded list. This is display/query construction only; the server still validates writes.
export const quoteIdentifier = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`

export const filterSavedQueries = (queries: readonly DbSavedQuery[], query: string): DbSavedQuery[] => {
  const needle = query.trim().toLowerCase()
  return needle
    ? queries.filter((saved) => `${saved.name} ${saved.notes ?? ''}`.toLowerCase().includes(needle))
    : [...queries]
}

export const savedQueryLabel = (query: DbSavedQuery): string =>
  query.notes?.trim() ? `${query.name} — ${query.notes.trim().split('\n')[0]}` : query.name
