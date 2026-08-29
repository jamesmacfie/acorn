import type { DbSavedQuery } from '../shared/database'

// `filterSavedQueries` used to live here, because the frame's Picker took a `results(query)` callback
// and this plugin owned the search. The kit's Picker filters its own items now, by substring over the
// label and the note, which is exactly what this did — so the plugin stopped owning it.

// SQL identifiers are quoted because table and schema names come from the database, not from a
// trusted hardcoded list. This is display/query construction only; the server still validates writes.
export const quoteIdentifier = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`

export const savedQueryLabel = (query: DbSavedQuery): string =>
  query.notes?.trim() ? `${query.name} — ${query.notes.trim().split('\n')[0]}` : query.name
