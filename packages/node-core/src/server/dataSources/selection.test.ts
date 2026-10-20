import { afterEach, describe, expect, it, vi } from 'vitest'
import { and } from 'drizzle-orm'
import { integer, SQLiteSyncDialect, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { DataPredicate } from '@acorn/protocol/dataBindings.ts'
import type { DataSourcePage, DataSourceRequest } from '@acorn/protocol/dataSources.ts'
import { createDataSelectionPager, pageDataRecords } from './selection'
import { DATA_READ_LIMIT, sqlDataFilters, withinDataBudget } from './sourceRead'

const request: Extract<DataSourceRequest, { operation: 'query' }> = {
  operation: 'query',
  query: { source: { pluginId: 'test', sourceId: 'items' }, scope: { parameters: {} }, sort: [] },
  evaluationTime: 100,
  mode: 'execution',
  pageSize: 1,
}
const selected: DataSourcePage = {
  records: [
    { recordId: 'a', data: {} },
    { recordId: 'b', data: {} },
  ],
  revision: '1',
  readTime: 100,
  completeness: { kind: 'bounded' },
}
afterEach(() => vi.useRealTimers())
it('binds retained pages to the owner, query and expiry while retaining final completeness', async () => {
  vi.useFakeTimers()
  const page = createDataSelectionPager(),
    read = vi.fn(async () => selected)
  const first = await page('owner', request, read)
  if (first.completeness.kind !== 'more') throw new Error('missing cursor')
  const next = { ...request, cursor: first.completeness.cursor }
  await expect(page('foreign', next, read)).rejects.toThrow('invalid_cursor')
  await expect(
    page('owner', { ...next, query: { ...next.query, scope: { connectionId: 'foreign', parameters: {} } } }, read),
  ).rejects.toThrow('invalid_cursor')
  expect(await page('owner', next, read)).toMatchObject({
    records: [{ recordId: 'b' }],
    completeness: { kind: 'bounded' },
  })
  expect(read).toHaveBeenCalledOnce()
  vi.advanceTimersByTime(60_001)
  await expect(page('owner', next, read)).rejects.toThrow('invalid_cursor')
})
it('pages a cut read through every record it kept, and reports it incomplete on the last page', async () => {
  const page = createDataSelectionPager()
  const cut: DataSourcePage = {
    ...selected,
    completeness: { kind: 'incomplete', cause: 'host-budget' },
    coveredRange: { start: 1, end: 2 },
  }
  const first = await page('owner', request, async () => cut)
  expect(first).toMatchObject({ records: [{ recordId: 'a' }], completeness: { kind: 'more' } })
  if (first.completeness.kind !== 'more') throw new Error('missing cursor')
  expect(await page('owner', { ...request, cursor: first.completeness.cursor }, async () => cut)).toMatchObject({
    records: [{ recordId: 'b' }],
    completeness: { kind: 'incomplete', cause: 'host-budget' },
    coveredRange: { start: 1, end: 2 },
  })
})
it('returns honest incompleteness when retention slots are exhausted', async () => {
  const page = createDataSelectionPager()
  for (let i = 0; i < 16; i++)
    expect((await page('owner', { ...request, evaluationTime: i }, async () => selected)).completeness.kind).toBe(
      'more',
    )
  expect(await page('owner', request, async () => selected)).toMatchObject({
    records: [],
    completeness: { kind: 'incomplete', cause: 'host-budget' },
  })
})
it('refuses retention above the shared byte budget', async () => {
  const page = createDataSelectionPager()
  const large = {
    ...selected,
    records: Array.from({ length: 100 }, (_, index) => ({ recordId: String(index), data: 'x'.repeat(180_000) })),
  }
  expect(await page('owner', request, async () => large)).toMatchObject({
    records: [],
    completeness: { kind: 'incomplete', cause: 'host-budget' },
  })
})

describe('a source read again for every page', () => {
  const items = sqliteTable('items', {
    completedAt: integer('completed_at'),
    taskId: text('task_id'),
    model: text('model'),
  })
  const fields = {
    time: { pointer: '/completedAt', column: items.completedAt },
    equals: { '/taskId': items.taskId, '/model': items.model },
  }
  const compare = (pointer: string, operator: string, value: unknown): DataPredicate =>
    ({
      kind: 'comparison',
      left: { address: { from: 'item', pointer } },
      operator,
      right: { address: { from: 'literal', value } },
    }) as DataPredicate
  const rendered = (predicate: DataPredicate) => {
    const { time, equals } = sqlDataFilters(predicate, fields)
    const where = and(...time, ...equals)
    if (!where) return null
    const { sql, params } = new SQLiteSyncDialect().sqlToQuery(where)
    return { sql, params }
  }
  const query = (predicate?: DataPredicate, extra: Partial<typeof request> = {}): typeof request => ({
    ...request,
    pageSize: 100,
    query: { ...request.query, ...(predicate ? { predicate } : {}) },
    ...extra,
  })
  const record = (id: string, completedAt: number, status = 'completed') => ({
    recordId: id,
    data: { completedAt, status },
  })
  const newestFirst = { timePointer: '/completedAt', readOrder: true }

  it.each([
    ['gt', '>'],
    ['gte', '>='],
    ['lt', '<'],
    ['lte', '<='],
  ])('answers %s on the time field in SQL', (operator, symbol) => {
    expect(rendered(compare('/completedAt', operator, 100))).toEqual({
      sql: `"items"."completed_at" ${symbol} ?`,
      params: [100],
    })
  })

  it('answers eq on a declared field, and joins the parts of an all group', () => {
    expect(
      rendered({
        kind: 'all',
        predicates: [compare('/model', 'eq', 'gpt-6-sol'), compare('/completedAt', 'gte', 5)],
      }),
    ).toEqual({
      sql: '("items"."completed_at" >= ? and "items"."model" = ?)',
      params: [5, 'gpt-6-sol'],
    })
  })

  it('leaves what SQL cannot answer to memory', () => {
    // A field SQL doesn't hold, an operator it isn't given, and an any group.
    const anyGroup: DataPredicate = {
      kind: 'any',
      predicates: [compare('/status', 'eq', 'failed'), compare('/completedAt', 'gt', 2)],
    }
    for (const predicate of [compare('/status', 'eq', 'failed'), compare('/model', 'ne', 'x'), anyGroup])
      expect(rendered(predicate)).toBeNull()
    const page = pageDataRecords(
      query(anyGroup),
      { records: [record('c', 3), record('b', 2, 'failed'), record('a', 1)], truncated: false },
      newestFirst,
    )
    expect(page.records.map((item) => item.recordId)).toEqual(['c', 'b'])
  })

  it('keeps the newest-first read order when the query sorts by nothing, and on ties', () => {
    const records = [record('c', 3), record('b', 2), record('a', 2)]
    expect(
      pageDataRecords(query(), { records, truncated: false }, newestFirst).records.map((item) => item.recordId),
    ).toEqual(['c', 'b', 'a'])
    expect(
      pageDataRecords(
        query(undefined, {
          query: { ...query().query, sort: [{ pointer: '/completedAt', direction: 'asc' }] },
        }),
        { records, truncated: false },
        newestFirst,
      ).records.map((item) => item.recordId),
    ).toEqual(['b', 'a', 'c'])
  })

  it('pages a read the budget cut, and reports it incomplete on its last page, covered from its oldest kept row', () => {
    const read = withinDataBudget(
      Array.from({ length: DATA_READ_LIMIT }, (_, index) => record(`r${index}`, DATA_READ_LIMIT - index)),
    )
    expect(read.truncated).toBe(true)
    const cut = { records: read.rows, truncated: read.truncated }
    // The host stops at the first page that isn't `more`, so an early `incomplete` would cut it to one page.
    expect(pageDataRecords(query(), cut, newestFirst).completeness).toEqual({ kind: 'more', cursor: '100' })
    const last = pageDataRecords(query(undefined, { cursor: '4900' }), cut, newestFirst)
    expect(last.records).toHaveLength(100)
    expect(last.completeness).toEqual({ kind: 'incomplete', cause: 'host-budget' })
    expect(last.coveredRange?.start).toBe(2)

    const whole = withinDataBudget(read.rows.slice(1))
    expect(whole.truncated).toBe(false)
    const complete = pageDataRecords(
      query(undefined, { pageSize: 10_000 }),
      { records: whole.rows, truncated: false },
      newestFirst,
    )
    expect(complete.completeness).toEqual({ kind: 'complete' })
    expect(complete).not.toHaveProperty('coveredRange')
  })
})
