import { describe, expect, it } from 'vitest'
import { MAX_COMMAND_SEARCH_ITEMS } from '@acorn/protocol/commands.ts'
import type { DbSavedQuery } from '../shared/database'
import { savedQuerySearchItems, savedQuerySearchScore } from './paletteSearch'

// The ranking, as a pure function. The route beside it is scope and ownership; this is what a typed
// word means, and it is the half worth pinning row by row.

const query = (over: Partial<DbSavedQuery> = {}): DbSavedQuery => ({
  id: 'q1',
  name: 'Recent orders',
  notes: null,
  sql: 'select * from orders order by created_at desc limit 10',
  updatedAt: 0,
  ...over,
})

describe('scoring one saved query', () => {
  it('ranks an exact name over a prefix, a prefix over a substring, and a note over the SQL', () => {
    const rank = (over: Partial<DbSavedQuery>, text: string) => savedQuerySearchScore(query(over), text)
    expect(rank({ name: 'orders' }, 'orders')).toBe(4)
    expect(rank({ name: 'orders by month' }, 'orders')).toBe(3)
    expect(rank({ name: 'recent orders' }, 'orders')).toBe(2)
    expect(rank({ name: 'x', notes: 'the orders table' }, 'orders')).toBe(1)
    expect(rank({ name: 'x', notes: null, sql: 'select * from orders' }, 'orders')).toBe(0)
  })

  it('matches the SQL, which is where a table name lives and nowhere else', () => {
    expect(savedQuerySearchScore(query({ name: 'Signups', notes: 'weekly' }), 'accounts')).toBeNull()
    expect(savedQuerySearchScore(query({ name: 'Signups', sql: 'select * from accounts' }), 'accounts')).toBe(0)
  })

  it('keeps every row for an empty query, so the command opens on the list', () => {
    expect(savedQuerySearchScore(query(), '')).toBe(0)
    expect(savedQuerySearchScore(query(), '   ')).toBe(0)
  })

  it('answers null for a word the row does not carry', () => {
    expect(savedQuerySearchScore(query(), 'invoices')).toBeNull()
  })
})

describe('the rows a search answers with', () => {
  it('sorts by tier and keeps the incoming order inside one, which is the pane’s own order', () => {
    const items = savedQuerySearchItems([
      query({ id: 'a', name: 'Alpha orders' }),
      query({ id: 'b', name: 'orders' }),
      query({ id: 'c', name: 'Beta orders' }),
    ], 'orders')
    expect(items.map((item) => item.id)).toEqual(['b', 'a', 'c'])
  })

  it('shows the note when there is one and the SQL when there is not', () => {
    const [withNote, withoutNote] = savedQuerySearchItems([
      query({ id: 'a', notes: 'Everything since Monday' }),
      query({ id: 'b', notes: null, sql: 'select\n  1' }),
    ], '')
    expect(withNote.subtitle).toBe('Everything since Monday')
    // Collapsed, because a subtitle is one line and stored SQL is not.
    expect(withoutNote.subtitle).toBe('select 1')
  })

  it('carries no route, no verb and nothing executable — only what the host will render', () => {
    const [item] = savedQuerySearchItems([query()], '')
    expect(Object.keys(item).sort()).toEqual(['icon', 'id', 'subtitle', 'title'])
  })

  it('caps the answer at what the host would render anyway', () => {
    const many = Array.from({ length: MAX_COMMAND_SEARCH_ITEMS + 20 }, (_, at) => query({ id: `q${at}` }))
    expect(savedQuerySearchItems(many, '')).toHaveLength(MAX_COMMAND_SEARCH_ITEMS)
  })

  it('trims a title and a subtitle to the bounds a row is held to', () => {
    const [item] = savedQuerySearchItems([query({ name: 'n'.repeat(400), notes: 's'.repeat(400) })], '')
    expect(item.title).toHaveLength(300)
    expect(item.subtitle).toHaveLength(300)
  })
})
