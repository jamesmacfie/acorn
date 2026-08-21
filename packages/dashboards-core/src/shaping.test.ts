import { describe, expect, it } from 'vitest'
import type { PluginCollectionRow, PluginCollectionSchema } from '@acorn/protocol/collections.ts'
import {
  aggregateRows,
  boardColumns,
  fieldWithRole,
  groupableFields,
  groupField,
  shapeRows,
  titleField,
  UNGROUPED_COLUMN_ID,
  visibleFields,
} from './shaping'

const schema: PluginCollectionSchema = {
  fields: [
    { id: 'title', name: 'Title', type: 'text', role: 'title' },
    { id: 'size', name: 'Size', type: 'number', unit: 'MB' },
    { id: 'status', name: 'Status', type: 'enum', role: 'status', values: [
      { id: 'draft', label: 'Draft', tone: 'muted' },
      { id: 'open', label: 'Open', tone: 'accent' },
      { id: 'ready', label: 'Ready', tone: 'ok' },
    ] },
    { id: 'updated', name: 'Updated', type: 'datetime', role: 'updated' },
    { id: 'flagged', name: 'Flagged', type: 'boolean' },
  ],
}

const row = (id: string, values: PluginCollectionRow['values']): PluginCollectionRow =>
  ({ id, values, pluginId: 'github', collectionId: 'pulls-mine' })

const rows: PluginCollectionRow[] = [
  row('a', { title: 'Alpha', size: 12, status: 'ready', updated: 300, flagged: true }),
  row('b', { title: 'Bravo', size: 3, status: 'draft', updated: 100, flagged: false }),
  row('c', { title: 'Charlie', size: null, status: 'open', updated: 200, flagged: true }),
]

const ids = (result: readonly PluginCollectionRow[]) => result.map((entry) => entry.id)

describe('shapeRows: filtering', () => {
  it('narrows on equality against the enum id, not its label', () => {
    expect(ids(shapeRows(rows, schema, { filters: [{ field: 'status', op: 'eq', value: 'ready' }] }))).toEqual(['a'])
    expect(ids(shapeRows(rows, schema, { filters: [{ field: 'status', op: 'eq', value: 'Ready' }] }))).toEqual([])
  })

  it('ANDs every filter', () => {
    const result = shapeRows(rows, schema, {
      filters: [{ field: 'flagged', op: 'eq', value: true }, { field: 'status', op: 'eq', value: 'open' }],
    })
    expect(ids(result)).toEqual(['c'])
  })

  it('treats null and the empty string as empty, and does not let either fall into `lt`', () => {
    expect(ids(shapeRows(rows, schema, { filters: [{ field: 'size', op: 'is-empty' }] }))).toEqual(['c'])
    expect(ids(shapeRows(rows, schema, { filters: [{ field: 'size', op: 'is-not-empty' }] }))).toEqual(['a', 'b'])
    expect(ids(shapeRows(rows, schema, { filters: [{ field: 'size', op: 'lt', value: 100 }] }))).toEqual(['a', 'b'])
  })

  it('matches `contains` case-insensitively', () => {
    expect(ids(shapeRows(rows, schema, { filters: [{ field: 'title', op: 'contains', value: 'RAV' }] }))).toEqual(['b'])
  })

  it('compares numbers numerically rather than as text', () => {
    expect(ids(shapeRows(rows, schema, { filters: [{ field: 'size', op: 'gt', value: 4 }] }))).toEqual(['a'])
  })
})

describe('shapeRows: sorting', () => {
  it('sorts an enum by DECLARATION order, which is the order the thing moves', () => {
    const sorted = shapeRows(rows, schema, { sort: [{ field: 'status', direction: 'asc' }] })
    expect(ids(sorted)).toEqual(['b', 'c', 'a'])
  })

  it('sorts datetimes numerically and honours direction', () => {
    expect(ids(shapeRows(rows, schema, { sort: [{ field: 'updated', direction: 'desc' }] }))).toEqual(['a', 'c', 'b'])
  })

  it('puts blanks last in BOTH directions', () => {
    expect(ids(shapeRows(rows, schema, { sort: [{ field: 'size', direction: 'asc' }] }))).toEqual(['b', 'a', 'c'])
    expect(ids(shapeRows(rows, schema, { sort: [{ field: 'size', direction: 'desc' }] }))).toEqual(['a', 'b', 'c'])
  })

  it('breaks ties on the next key', () => {
    const sorted = shapeRows(rows, schema, {
      sort: [{ field: 'flagged', direction: 'desc' }, { field: 'title', direction: 'asc' }],
    })
    expect(ids(sorted)).toEqual(['a', 'c', 'b'])
  })

  it('ignores a sort key the schema does not declare', () => {
    expect(ids(shapeRows(rows, schema, { sort: [{ field: 'nope', direction: 'asc' }] }))).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate the rows it was handed', () => {
    const original = [...rows]
    shapeRows(rows, schema, { sort: [{ field: 'updated', direction: 'desc' }] })
    expect(rows).toEqual(original)
  })
})

describe('shapeRows: limiting', () => {
  it('limits AFTER sorting, so the limit is the top N rather than a sample', () => {
    const result = shapeRows(rows, schema, { sort: [{ field: 'updated', direction: 'desc' }], limit: 2 })
    expect(ids(result)).toEqual(['a', 'c'])
  })

  it('accepts zero and ignores nonsense', () => {
    expect(shapeRows(rows, schema, { limit: 0 })).toEqual([])
    expect(ids(shapeRows(rows, schema, { limit: Number.NaN }))).toEqual(['a', 'b', 'c'])
  })
})

describe('projection', () => {
  it('returns every field when nothing is projected', () => {
    expect(visibleFields(schema, {}).map((field) => field.id)).toEqual(['title', 'size', 'status', 'updated', 'flagged'])
  })

  it('honours the projected ORDER and drops ids the schema does not declare', () => {
    expect(visibleFields(schema, { fields: ['status', 'gone', 'title'] }).map((field) => field.id)).toEqual(['status', 'title'])
  })

  it('finds the lead field by role, then by type', () => {
    expect(titleField(schema)?.id).toBe('title')
    expect(titleField({ fields: [{ id: 'n', name: 'N', type: 'number' }] })?.id).toBe('n')
    expect(titleField({ fields: [] })).toBeUndefined()
    expect(fieldWithRole(schema, 'status')?.id).toBe('status')
    expect(fieldWithRole(schema, 'assignee')).toBeUndefined()
  })
})

describe('aggregateRows', () => {
  const shaped = shapeRows(rows, schema, {})

  it('counts by default', () => {
    expect(aggregateRows(shaped, schema, { kind: 'stat' })).toBe(3)
  })

  it('skips blank cells rather than reading them as zero', () => {
    expect(aggregateRows(shaped, schema, { kind: 'stat', aggregate: 'sum', field: 'size' })).toBe(15)
    expect(aggregateRows(shaped, schema, { kind: 'stat', aggregate: 'avg', field: 'size' })).toBe(7.5)
    expect(aggregateRows(shaped, schema, { kind: 'stat', aggregate: 'min', field: 'size' })).toBe(3)
    expect(aggregateRows(shaped, schema, { kind: 'stat', aggregate: 'max', field: 'size' })).toBe(12)
  })

  it('answers null rather than 0 when there is nothing to aggregate', () => {
    expect(aggregateRows(shaped, schema, { kind: 'stat', aggregate: 'sum', field: 'missing' })).toBeNull()
    expect(aggregateRows([], schema, { kind: 'stat', aggregate: 'sum', field: 'size' })).toBeNull()
    expect(aggregateRows([], schema, { kind: 'stat' })).toBe(0)
  })
})

describe('grouping: a board is group-by, not a component', () => {
  const status = schema.fields[2]

  it('offers only the fields with finite values as a grouping', () => {
    expect(groupableFields(schema).map((field) => field.id)).toEqual(['status'])
    expect(groupableFields({ fields: [{ id: 't', name: 'T', type: 'text' }] })).toEqual([])
  })

  it("falls back to the status role, then to the first enum, when the panel's choice is gone", () => {
    expect(groupField(schema, { groupBy: 'status' })?.id).toBe('status')
    // A field the plugin renamed since the panel was composed. One giant column would read as
    // broken data rather than a broken definition.
    expect(groupField(schema, { groupBy: 'was-renamed' })?.id).toBe('status')
    expect(groupField(schema, {})?.id).toBe('status')
    expect(groupField({ fields: [] }, {})).toBeUndefined()
  })

  it('draws one column per DECLARED value, in declaration order, empty ones included', () => {
    const columns = boardColumns(shapeRows(rows, schema, {}), status)
    expect(columns.map((column) => column.id)).toEqual(['draft', 'open', 'ready'])
    expect(columns.map((column) => column.rows.map((row) => row.id))).toEqual([['b'], ['c'], ['a']])
    expect(columns.map((column) => column.tone)).toEqual(['muted', 'accent', 'ok'])
    expect(columns.every((column) => column.declared)).toBe(true)

    // The empty column survives, which is the point: a kanban whose column disappears when its last
    // card leaves is disorienting, and it is also where the card goes back.
    const filtered = shapeRows(rows, schema, { filters: [{ field: 'status', op: 'eq', value: 'ready' }] })
    const narrowed = boardColumns(filtered, status)
    expect(narrowed.map((column) => column.id)).toEqual(['draft', 'open', 'ready'])
    expect(narrowed.map((column) => column.rows.length)).toEqual([0, 0, 1])
  })

  it('keeps the order the shaping produced INSIDE each column, so per-column sort is free', () => {
    const many = [
      row('x1', { title: 'X1', status: 'open', updated: 100 }),
      row('x2', { title: 'X2', status: 'open', updated: 300 }),
      row('x3', { title: 'X3', status: 'open', updated: 200 }),
    ]
    const sorted = shapeRows(many, schema, { sort: [{ field: 'updated', direction: 'desc' }] })
    const open = boardColumns(sorted, status).find((column) => column.id === 'open')
    expect(open?.rows.map((entry) => entry.id)).toEqual(['x2', 'x3', 'x1'])
  })

  it('gives an UNDECLARED value its own column rather than dropping the row', () => {
    const drifted = [...rows, row('d', { title: 'Delta', status: 'archived' })]
    const columns = boardColumns(drifted, status)
    expect(columns.map((column) => column.id)).toEqual(['draft', 'open', 'ready', 'archived'])
    const extra = columns[3]
    // Not pre-toned and not pre-ordered, since the schema never promised it, but it is on the board.
    expect(extra.declared).toBe(false)
    expect(extra.tone).toBe('muted')
    expect(extra.label).toBe('archived')
    expect(extra.rows.map((entry) => entry.id)).toEqual(['d'])
  })

  it('builds every column from the data when the schema declares no values', () => {
    const open: PluginCollectionSchema['fields'][number] = { id: 'status', name: 'Status', type: 'enum' }
    const columns = boardColumns(rows, open)
    // First-appearance order, which over already-sorted rows is deterministic.
    expect(columns.map((column) => column.id)).toEqual(['ready', 'draft', 'open'])
    expect(columns.every((column) => column.declared)).toBe(false)
  })

  it('sends a row with NO value to one catch-all column that exists only when it is needed', () => {
    expect(boardColumns(rows, status).some((column) => column.id === UNGROUPED_COLUMN_ID)).toBe(false)

    const withGaps = [
      ...rows,
      row('n1', { title: 'Null', status: null }),
      row('n2', { title: 'Empty', status: '' }),
      row('n3', { title: 'Absent' }),
    ]
    const columns = boardColumns(withGaps, status)
    expect(columns.map((column) => column.id)).toEqual(['draft', 'open', 'ready', UNGROUPED_COLUMN_ID])
    const catchAll = columns[3]
    expect(catchAll.label).toBe('Uncategorised')
    expect(catchAll.rows.map((entry) => entry.id)).toEqual(['n1', 'n2', 'n3'])
    // Every row lands somewhere. That is the rule: an unmapped value is never silently dropped.
    expect(columns.reduce((total, column) => total + column.rows.length, 0)).toBe(withGaps.length)
  })
})
