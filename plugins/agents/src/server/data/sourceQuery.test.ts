import { describe, expect, it } from 'vitest'
import { and } from 'drizzle-orm'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import type { DataPredicate } from '@acorn/protocol/dataBindings.ts'
import * as schema from '../../node/schema'
import { READ_LIMIT, sourcePage, sqlFilters, withinBudget, type QueryInput } from './sourceQuery'

const facts = schema.agentTurnFacts
const fields = {
  time: { pointer: '/completedAt', column: facts.completedAt },
  equals: { '/taskId': facts.taskId, '/model': facts.model },
}
const compare = (pointer: string, operator: string, value: unknown): DataPredicate =>
  ({
    kind: 'comparison',
    left: { address: { from: 'item', pointer } },
    operator,
    right: { address: { from: 'literal', value } },
  }) as DataPredicate
const rendered = (predicate: DataPredicate) => {
  const { time, equals } = sqlFilters(predicate, fields)
  const where = and(...time, ...equals)
  if (!where) return null
  const { sql, params } = new SQLiteSyncDialect().sqlToQuery(where)
  return { sql, params }
}
const query = (predicate?: DataPredicate, extra: Partial<QueryInput> = {}): QueryInput => ({
  operation: 'query',
  mode: 'execution',
  evaluationTime: 0,
  pageSize: 100,
  query: {
    source: { pluginId: 'agents', sourceId: 'turns' },
    scope: { parameters: {} },
    sort: [],
    ...(predicate ? { predicate } : {}),
  },
  ...extra,
})
const record = (id: string, completedAt: number, status = 'completed') => ({
  recordId: id,
  data: { completedAt, status },
})

describe('agents source query', () => {
  it.each([
    ['gt', '>'],
    ['gte', '>='],
    ['lt', '<'],
    ['lte', '<='],
  ])('answers %s on the time field in SQL', (operator, symbol) => {
    expect(rendered(compare('/completedAt', operator, 100))).toEqual({
      sql: `"agent_turn_facts"."completed_at" ${symbol} ?`,
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
      sql: '("agent_turn_facts"."completed_at" >= ? and "agent_turn_facts"."model" = ?)',
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
    const page = sourcePage(
      query(anyGroup),
      { records: [record('c', 3), record('b', 2, 'failed'), record('a', 1)], truncated: false },
      '/completedAt',
    )
    expect(page.records.map((item) => item.recordId)).toEqual(['c', 'b'])
  })

  it('keeps the newest-first read order when the query sorts by nothing, and on ties', () => {
    const records = [record('c', 3), record('b', 2), record('a', 2)]
    expect(
      sourcePage(query(), { records, truncated: false }, '/completedAt').records.map((item) => item.recordId),
    ).toEqual(['c', 'b', 'a'])
    expect(
      sourcePage(
        query(undefined, {
          query: { ...query().query, sort: [{ pointer: '/completedAt', direction: 'asc' }] },
        }),
        { records, truncated: false },
        '/completedAt',
      ).records.map((item) => item.recordId),
    ).toEqual(['b', 'a', 'c'])
  })

  it('reports a read the budget cut as incomplete, covered from its oldest kept row', () => {
    const read = withinBudget(Array.from({ length: READ_LIMIT }, (_, index) => record(`r${index}`, READ_LIMIT - index)))
    expect(read.truncated).toBe(true)
    const page = sourcePage(query(), { records: read.rows, truncated: read.truncated }, '/completedAt')
    expect(page.completeness).toEqual({ kind: 'incomplete', cause: 'host-budget' })
    expect(page.coveredRange?.start).toBe(2)

    const whole = withinBudget(read.rows.slice(1))
    expect(whole.truncated).toBe(false)
    const complete = sourcePage(
      query(undefined, { pageSize: 10_000 }),
      { records: whole.rows, truncated: false },
      '/completedAt',
    )
    expect(complete.completeness).toEqual({ kind: 'complete' })
    expect(complete).not.toHaveProperty('coveredRange')
  })
})
