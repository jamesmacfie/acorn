import { describe, expect, it } from 'vitest'
import { filterSavedQueries, quoteIdentifier, savedQueryLabel } from './databaseModel'

const queries = [
  { id: '1', name: 'Recent orders', notes: 'paid orders', sql: 'select 1', updatedAt: 1 },
  { id: '2', name: 'Users', notes: '', sql: 'select 2', updatedAt: 2 },
] as const

describe('database client model helpers', () => {
  it('quotes identifiers and escapes embedded quotes', () => {
    expect(quoteIdentifier('public')).toBe('"public"')
    expect(quoteIdentifier('weird"name')).toBe('"weird""name"')
  })

  it('filters saved queries by name or notes and preserves unfiltered order', () => {
    expect(filterSavedQueries(queries, '')).toEqual([...queries])
    expect(filterSavedQueries(queries, 'PAID')).toEqual([queries[0]])
    expect(filterSavedQueries(queries, 'no match')).toEqual([])
  })

  it('labels a query with its first notes line when available', () => {
    expect(savedQueryLabel({ ...queries[0], notes: 'paid orders\nused by finance' })).toBe('Recent orders — paid orders')
    expect(savedQueryLabel(queries[1])).toBe('Users')
  })
})
