import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginRequestContext } from '@acorn/plugin-api/node'
import { dataSourceDescriptionSchema, dataSourcePageSchema, type DataSourceRequest } from '@acorn/protocol/dataSources.ts'
import { validateDataValue } from '@acorn/protocol/dataSchemas.ts'
import { createErrorSourceHandler } from './errorSourceHandler'
import { errorDetailSchema } from '../../shared/errorSource'
import { rollbarFetch } from '../index'

vi.mock('../index', async original => ({ ...await original<typeof import('../index')>(), rollbarFetch: vi.fn() }))
const source = { pluginId: 'rollbar', sourceId: 'error-groups' }
const scope = { connectionId: 'selected', parameters: {} }
const input = (): Extract<DataSourceRequest, { operation: 'query' }> => ({ operation: 'query', query: { source, scope, sort: [{ pointer: '/firstOccurrenceAt', direction: 'desc' }] }, mode: 'execution', evaluationTime: 100, pageSize: 1 })
const resource = vi.fn()
const context: PluginRequestContext = { userId: 'owner', principal: { kind: 'device', userId: 'owner' }, providers: {
  connections: vi.fn(async () => [{ id: 'selected', status: 'connected' } as Awaited<ReturnType<PluginRequestContext['providers']['connections']>>[number]]),
  items: vi.fn(), resource, withConnections: async (_provider, visit) => {
    const value = await visit({ id: 'selected' } as Parameters<typeof visit>[0], 'selected-secret')
    return value === undefined ? [] : [value]
  },
} }
const call = (handler: ReturnType<typeof createErrorSourceHandler>, request: DataSourceRequest, ctx = context) => handler(new Request('http://acorn.test/', { method: 'POST', body: JSON.stringify(request) }), ctx)
const item = (id: number, first = 100, last = 200) => ({ id, counter: id, title: 'Error', environment: 'prod', status: 'active', level: 'error', total_occurrences: 3, first_occurrence_timestamp: first, last_occurrence_timestamp: last })
const response = (items: ReturnType<typeof item>[]) => Response.json({ err: 0, result: { items } })
const detail = (): DataSourceRequest => ({ operation: 'details', scope, ref: { ...source, connectionId: 'selected', recordId: '1:1' }, projection: [] })
const metadata = { itemId: '1', identifier: '1', title: 'Error', url: 'https://rollbar.com/item/1/', level: 'error', status: 'active', environment: 'prod', totalOccurrences: 2, firstOccurrenceAt: 100, lastOccurrenceAt: 200 }
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers() })

describe('Rollbar error group source', () => {
  it('describes groups and separate optional details without incremental guarantees', async () => {
    const description = dataSourceDescriptionSchema.parse(await (await call(createErrorSourceHandler(), { operation: 'describe', scope, source })).json())
    expect(description.operations).toMatchObject({ details: true, incremental: false })
    expect(description.fields.find(field => field.pointer === '/firstOccurrenceAt')?.label).toBe('First seen')
  })
  it('excludes old groups with new occurrences, reads pages, and freezes stable take', async () => {
    vi.mocked(rollbarFetch).mockResolvedValueOnce(response(Array.from({ length: 100 }, (_, index) => item(index + 1, 100, 500))))
      .mockResolvedValueOnce(response([item(101, 400), item(102, 400)]))
    const request = input(); request.query.take = 2
    request.query.predicate = { kind: 'comparison', left: { address: { from: 'item', pointer: '/firstOccurrenceAt' } }, operator: 'gte', right: { address: { from: 'literal', value: 300_000 } } }
    const handler = createErrorSourceHandler()
    const first = dataSourcePageSchema.parse(await (await call(handler, request)).json())
    expect(first.records[0]).toMatchObject({ recordId: '101:101', data: { firstOccurrenceAt: 400_000 } })
    if (first.completeness.kind !== 'more') throw new Error('missing cursor')
    const next = { ...request, cursor: first.completeness.cursor }
    expect(await (await call(handler, next)).json()).toMatchObject({ records: [{ recordId: '102:102' }], completeness: { kind: 'bounded' } })
    expect(rollbarFetch).toHaveBeenCalledTimes(2)
    expect(vi.mocked(rollbarFetch).mock.calls[1]?.[1]).toBe('/items?page=2')
    expect((await call(handler, next, { ...context, principal: { kind: 'internal', userId: 'owner', scope: 'task', taskId: 'task' } })).status).toBe(403)
    expect((await call(handler, next, { ...context, providers: { ...context.providers, connections: async () => [] } })).status).toBe(502)
  })
  it('does not report a locally empty selection complete through the candidate cap', async () => {
    vi.mocked(rollbarFetch).mockImplementation(async (_token, path) => {
      const page = Number(new URL(path, 'https://rollbar.test').searchParams.get('page'))
      return response(Array.from({ length: 100 }, (_, index) => item((page - 1) * 100 + index + 1)))
    })
    const request = input()
    request.query.predicate = { kind: 'comparison', left: { address: { from: 'item', pointer: '/firstOccurrenceAt' } }, operator: 'gt', right: { address: { from: 'literal', value: 999999 } } }
    expect(await (await call(createErrorSourceHandler(), request)).json()).toMatchObject({ records: [], completeness: { kind: 'incomplete', cause: 'upstream-cap' } })
  })
  it('distinguishes empty and failed reads, rejects oversize fields and duplicate identities', async () => {
    vi.mocked(rollbarFetch).mockResolvedValueOnce(response([]))
    expect(await (await call(createErrorSourceHandler(), input())).json()).toMatchObject({ records: [], completeness: { kind: 'complete' } })
    vi.mocked(rollbarFetch).mockResolvedValueOnce(Response.json({ err: 1, message: 'private secret' }))
    const failed = await call(createErrorSourceHandler(), input())
    expect(failed.status).toBe(502); expect(await failed.text()).not.toContain('private secret')
    vi.mocked(rollbarFetch).mockResolvedValueOnce(response([{ ...item(1), title: 'a'.repeat(9000) }]))
    expect((await call(createErrorSourceHandler(), input())).status).toBe(502)
    vi.mocked(rollbarFetch).mockResolvedValueOnce(response([item(1), item(1)]))
    expect((await call(createErrorSourceHandler(), input())).status).toBe(502)
  })
  it('uses strict provider resources and returns only safe detail fields', async () => {
    resource.mockResolvedValueOnce({ ok: true, value: metadata }).mockResolvedValueOnce({ ok: true, value: { occurrences: [{ id: 'occ1' }], capped: false } })
      .mockResolvedValueOnce({ ok: true, value: { id: 'occ1', occurredAt: 200, message: 'Error', exceptionClass: 'TypeError', frames: [], truncated: false, request: { headers: { authorization: 'private' } }, person: { email: 'private@example.com' } } })
    const result = await (await call(createErrorSourceHandler(), detail())).json()
    expect(result).toMatchObject({ kind: 'found', data: { latestOccurrence: { id: 'occ1', frames: [] } } })
    expect(validateDataValue(result.data, errorDetailSchema)).toEqual(result.data)
    expect(JSON.stringify(result)).not.toContain('private')
    expect(resource.mock.calls.every(call => call[0].requireFresh && call[0].connectionId === 'selected')).toBe(true)
  })
  it('fails detail reads on provider error or truncated projections and rejects forged scope', async () => {
    resource.mockResolvedValueOnce({ ok: true, value: metadata }).mockResolvedValueOnce({ ok: false, failure: { status: 502 } })
    expect((await call(createErrorSourceHandler(), detail())).status).toBe(502)
    resource.mockResolvedValueOnce({ ok: true, value: metadata }).mockResolvedValueOnce({ ok: true, value: { occurrences: [{ id: 'occ1' }] } })
      .mockResolvedValueOnce({ ok: true, value: { truncated: true } })
    expect((await call(createErrorSourceHandler(), detail())).status).toBe(502)
    const forged = detail()
    if (forged.operation !== 'details') throw new Error('wrong request')
    forged.ref.connectionId = 'other'
    expect((await call(createErrorSourceHandler(), forged)).status).toBe(502)
    resource.mockResolvedValueOnce({ ok: false, failure: { status: 404 } })
    expect(await (await call(createErrorSourceHandler(), detail())).json()).toEqual({ kind: 'not-found' })
  })
})
