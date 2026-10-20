import { afterEach, describe, expect, it, vi } from 'vitest'
import { DATA_LIMITS, type PluginRequestContext } from '@acorn/plugin-api/node'
import type { DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { dataSourcePageSchema, type DataSourceRequest } from '@acorn/protocol/dataSources.ts'
import { validateDataValue } from '@acorn/protocol/dataSchemas.ts'
import { occurrenceCountSourceDescription } from '../../shared/occurrenceCountSource'
import { rollbarFetch } from '../index'
import { createOccurrenceCountSourceHandler } from './occurrenceCountSource'

vi.mock('../index', async (original) => ({ ...(await original<typeof import('../index')>()), rollbarFetch: vi.fn() }))

const DAY = 86_400_000
const OCT_1 = Date.UTC(2026, 9, 1)
const context: PluginRequestContext = {
  userId: 'owner',
  principal: { kind: 'device', userId: 'owner' },
  providers: {
    connections: vi.fn(async () => [
      { id: 'selected', status: 'connected' } as Awaited<
        ReturnType<PluginRequestContext['providers']['connections']>
      >[number],
    ]),
    items: vi.fn(),
    resource: vi.fn(),
    withConnections: async (_provider, visit) => {
      const value = await visit({ id: 'selected' } as Parameters<typeof visit>[0], 'selected-secret')
      return value === undefined ? [] : [value]
    },
  },
}
// Each test reads at its own evaluation time, so the handler's retained reads never cross tests.
let evaluationTime = 1_000
const query = (predicate?: DataPredicate): Extract<DataSourceRequest, { operation: 'query' }> => ({
  operation: 'query',
  query: {
    source: { pluginId: 'rollbar', sourceId: 'occurrence-counts' },
    scope: { connectionId: 'selected', parameters: {} },
    sort: [],
    ...(predicate ? { predicate } : {}),
  },
  mode: 'execution',
  evaluationTime: evaluationTime++,
  pageSize: 100,
})
const compare = (pointer: string, operator: string, value: string | number) =>
  ({
    kind: 'comparison',
    left: { address: { from: 'item', pointer } },
    operator,
    right: { address: { from: 'literal', value } },
  }) as DataPredicate
const call = async (request: DataSourceRequest, ctx = context) =>
  createOccurrenceCountSourceHandler()(
    new Request('http://acorn.test/', { method: 'POST', body: JSON.stringify(request) }),
    ctx,
  )
const row = (id: number, count: number, extra: Record<string, unknown> = {}) =>
  Object.entries({
    item_id: id,
    item_counter: id + 1000,
    item_title: `Error ${id}`,
    item_level: 40,
    environment: 'production',
    occurrence_count: count,
    person_email: 'private@example.com',
    ...extra,
  }).map(([field, value]) => ({ field, value }))
const metrics = (timepoints: { day: number; rows: ReturnType<typeof row>[] }[]) =>
  Response.json({
    err: 0,
    result: {
      timepoints: timepoints.map(({ day, rows }) => ({ timestamp: day / 1000, metrics_rows: rows })),
      query_execution: 0.01,
    },
  })
const sent = () => vi.mocked(rollbarFetch).mock.calls[0]![3] as Record<string, unknown>

afterEach(() => vi.clearAllMocks())

describe('Rollbar occurrence counts source', () => {
  it('pushes the day window and filters into one Metrics API query of whole UTC days', async () => {
    vi.mocked(rollbarFetch).mockResolvedValueOnce(
      metrics([
        { day: OCT_1, rows: [row(1, 4)] },
        { day: OCT_1 + DAY, rows: [row(1, 7), row(2, 1)] },
      ]),
    )
    const predicate: DataPredicate = {
      kind: 'all',
      predicates: [
        compare('/day', 'gte', OCT_1 + DAY / 2),
        compare('/day', 'lt', OCT_1 + 3 * DAY + 1),
        compare('/level', 'eq', 'error'),
        compare('/environment', 'eq', 'production'),
      ],
    }
    const page = dataSourcePageSchema.parse(await (await call(query(predicate))).json())
    expect(vi.mocked(rollbarFetch).mock.calls[0]?.[1]).toBe('/metrics/occurrences')
    expect(sent()).toMatchObject({
      start_time: OCT_1 / 1000,
      end_time: (OCT_1 + 4 * DAY) / 1000 - 1,
      granularity: 'day',
      timezone: 'UTC',
      group_by: ['item_id', 'item_counter', 'item_title', 'item_level', 'environment'],
      filters: [
        { field: 'item_level', operator: 'eq', values: ['error'] },
        { field: 'environment', operator: 'eq', values: ['production'] },
      ],
      limit: DATA_LIMITS.selectionRecords + 1,
    })
    // October 1's bucket starts before the window's lower bound, so it drops out whole.
    expect(page.records.map((record) => record.recordId)).toEqual([`1:${OCT_1 + DAY}`, `2:${OCT_1 + DAY}`])
    expect(page.completeness).toEqual({ kind: 'complete' })
  })

  it('returns only the group, its day, and its count', async () => {
    vi.mocked(rollbarFetch).mockResolvedValueOnce(
      metrics([{ day: OCT_1, rows: [row(9, 3, { item_level: 'warning' })] }]),
    )
    const page = await (await call(query(compare('/counter', 'eq', '1009')))).json()
    expect(sent().filters).toEqual([{ field: 'item_counter', operator: 'eq', values: [1009] }])
    expect(page.records[0]).toEqual({
      recordId: `9:${OCT_1}`,
      data: {
        id: '9',
        counter: '1009',
        title: 'Error 9',
        url: 'https://rollbar.com/item/9/',
        level: 'warning',
        environment: 'production',
        day: OCT_1,
        occurrences: 3,
      },
      action: { verb: 'openUrl', url: 'https://rollbar.com/item/9/' },
    })
    expect(validateDataValue(page.records[0].data, occurrenceCountSourceDescription.schema)).toEqual(
      page.records[0].data,
    )
  })

  it('pages one read with more until the last page, which reports the budget', async () => {
    const days = Array.from({ length: 51 }, (_, index) => ({
      day: OCT_1 - index * DAY,
      rows: Array.from({ length: 100 }, (_, id) => row(id + 1, 1)),
    }))
    vi.mocked(rollbarFetch).mockResolvedValueOnce(metrics(days))
    let request = query()
    const records: string[] = []
    for (;;) {
      const page = dataSourcePageSchema.parse(await (await call(request)).json())
      records.push(...page.records.map((record) => record.recordId))
      if (page.completeness.kind !== 'more') {
        expect(page.completeness).toEqual({ kind: 'incomplete', cause: 'host-budget' })
        expect(page.coveredRange?.start).toBe(OCT_1 - 48 * DAY)
        break
      }
      expect(page.records).toHaveLength(100)
      request = { ...request, cursor: page.completeness.cursor }
    }
    expect(records).toHaveLength(DATA_LIMITS.selectionRecords)
    // The budget keeps the newest days and drops the oldest.
    expect(records).toContain(`100:${OCT_1 - 49 * DAY}`)
    expect(records).not.toContain(`1:${OCT_1 - 50 * DAY}`)
    expect(rollbarFetch).toHaveBeenCalledOnce()
  })

  it("explains Rollbar's refusals and rejects bad rows and callers", async () => {
    vi.mocked(rollbarFetch).mockResolvedValueOnce(new Response('{}', { status: 403 }))
    const refused = await call(query())
    expect(refused.status).toBe(502)
    expect((await refused.json()).reason).toContain('Metrics API')
    vi.mocked(rollbarFetch).mockResolvedValueOnce(new Response('{}', { status: 429 }))
    expect((await call(query())).status).toBe(429)
    vi.mocked(rollbarFetch).mockResolvedValueOnce(Response.json({ err: 1, message: 'private secret' }))
    const failed = await call(query())
    expect(failed.status).toBe(502)
    expect(await failed.text()).not.toContain('private secret')
    vi.mocked(rollbarFetch).mockResolvedValueOnce(metrics([{ day: OCT_1, rows: [row(1, 1), row(1, 2)] }]))
    expect((await call(query())).status).toBe(502)
    vi.mocked(rollbarFetch).mockResolvedValueOnce(
      metrics([{ day: OCT_1, rows: [row(1, 1, { item_title: 'a'.repeat(9000) })] }]),
    )
    expect((await call(query())).status).toBe(502)
    expect((await call(query(compare('/counter', 'eq', 'nope')))).status).toBe(502)
    expect(
      (
        await call(query(), {
          ...context,
          principal: { kind: 'internal', userId: 'owner', scope: 'task', taskId: 't' },
        })
      ).status,
    ).toBe(403)
    expect(
      (await call(query(), { ...context, providers: { ...context.providers, connections: async () => [] } })).status,
    ).toBe(502)
    expect(rollbarFetch).toHaveBeenCalledTimes(5)
  })
})
