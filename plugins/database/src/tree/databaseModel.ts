import type { DbSavedQuery } from '../shared/database'

// SQL identifiers are quoted because table and schema names come from the database, not from a
// trusted hardcoded list. This is display/query construction only; the server still validates writes.
export const quoteIdentifier = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`

export const savedQueryLabel = (query: DbSavedQuery): string =>
  query.notes?.trim() ? `${query.name} — ${query.notes.trim().split('\n')[0]}` : query.name
