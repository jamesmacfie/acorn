import { describe, expect, it } from 'vitest'
import type { DbCatalogTable } from '../shared/database'
import { completeSql, resolveQualifier, textBeforeCursor } from './completions'

// The whole point of the completions capability is that the host never learns SQL, so every judgement
// below is this plugin's, and this is where it gets tested. Pure over an injected catalog, because a
// live Postgres is not a unit test.

const TABLES: DbCatalogTable[] = [
  { schema: 'public', name: 'orders', columns: [{ name: 'id', dataType: 'uuid' }, { name: 'total', dataType: 'numeric' }] },
  { schema: 'public', name: 'users', columns: [{ name: 'id', dataType: 'uuid' }, { name: 'email', dataType: 'text' }] },
  { schema: 'billing', name: 'invoices', columns: [{ name: 'number', dataType: 'text' }] },
]

const labels = (text: string, column: number, line = 1) => completeSql(text, { line, column }, TABLES).map((item) => item.label)

describe('textBeforeCursor', () => {
  it('takes the current line up to the cursor, and clamps a position past the end', () => {
    expect(textBeforeCursor('SELECT *\nFROM orders', { line: 2, column: 6 })).toBe('FROM ')
    // A race between a keystroke and the fetch is not worth failing a popup over.
    expect(textBeforeCursor('SELECT', { line: 99, column: 99 })).toBe('SELECT')
  })
})

describe('resolveQualifier', () => {
  it('reads an alias out of the statement, with or without AS', () => {
    expect(resolveQualifier('SELECT o. FROM orders o', 'o', TABLES)?.name).toBe('orders')
    expect(resolveQualifier('SELECT u. FROM users AS u', 'u', TABLES)?.name).toBe('users')
  })

  it('falls back to a bare table name, so a qualifier that was never aliased still works', () => {
    expect(resolveQualifier('SELECT orders. FROM orders', 'orders', TABLES)?.name).toBe('orders')
  })

  it('answers nothing for a name that is neither', () => {
    expect(resolveQualifier('SELECT x. FROM orders o', 'x', TABLES)).toBeNull()
  })
})

describe('completeSql', () => {
  it('offers tables after a clause that takes a relation', () => {
    expect(labels('SELECT * FROM ', 15)).toEqual(['orders', 'users', 'billing.invoices'])
    expect(labels('SELECT * FROM orders JOIN ', 27)).toEqual(['orders', 'users', 'billing.invoices'])
    expect(labels('INSERT INTO ', 13)).toEqual(['orders', 'users', 'billing.invoices'])
  })

  it('offers exactly that table\'s columns after an alias, and nothing else', () => {
    const items = completeSql('SELECT o. FROM orders o', { line: 1, column: 10 }, TABLES)
    expect(items.map((i) => i.label)).toEqual(['id', 'total'])
    expect(items.every((i) => i.kind === 'field')).toBe(true)
    expect(items[1].detail).toBe('numeric · orders')
  })

  it('drills into a schema qualifier by offering its tables unqualified', () => {
    expect(labels('SELECT * FROM billing.', 23)).toEqual(['invoices'])
  })

  // The case that earns the feature its keep: in `SELECT |` with `FROM orders` further along, the
  // useful list is orders' columns. Offering the whole database's is what makes people turn completion
  // popups off.
  it('leads with the columns of the tables this statement already mentions', () => {
    const items = labels('SELECT  FROM orders', 8)
    expect(items.slice(0, 2)).toEqual(['id', 'total'])
    expect(items).toContain('SELECT')
  })

  it('deduplicates a column name shared by two mentioned tables', () => {
    const items = labels('SELECT  FROM orders JOIN users ON 1=1', 8)
    expect(items.filter((label) => label === 'id')).toHaveLength(1)
    expect(items.slice(0, 3)).toEqual(['id', 'total', 'email'])
  })

  it('answers keywords and tables when nothing in the statement narrows it', () => {
    const items = labels('', 1)
    expect(items).toContain('SELECT')
    expect(items).toContain('orders')
  })
})
