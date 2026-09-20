import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginRequestContext } from '@acorn/plugin-api/node'
import { dataSourceDescriptionSchema, dataSourcePageSchema, type DataSourceRequest } from '@acorn/protocol/dataSources.ts'
import type { DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { createPullSourceHandler } from './pullSourceHandler'
import { ghGraphQL } from '../githubApi'

vi.mock('../githubApi', async original => ({ ...await original<typeof import('../githubApi')>(), ghGraphQL: vi.fn() }))
const node = (id: string, overrides = {}) => ({ id, number: 1, title: 'A change', url: 'https://github.com/org/repo/pull/1',
  state: 'OPEN', isDraft: false, author: { login: 'alice' }, repository: { nameWithOwner: 'org/repo' },
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z', closedAt: null, mergedAt: null,
  mergeable: 'UNKNOWN', mergeStateStatus: 'UNSTABLE', autoMergeRequest: null, ...overrides })
const upstream = (nodes: ReturnType<typeof node>[], next: string | null = null, count = nodes.length) =>
  Response.json({ data: { search: { nodes, issueCount: count, pageInfo: { hasNextPage: next !== null, endCursor: next } } } })
const scope = { connectionId: 'selected', parameters: { repository: 'org/repo' } }
const source = { pluginId: 'github', sourceId: 'pull-requests' }
const query = (): Extract<DataSourceRequest, { operation: 'query' }> => ({ operation: 'query',
  query: { source, scope, sort: [{ pointer: '/updatedAt', direction: 'desc' }] }, mode: 'execution', evaluationTime: 100, pageSize: 1 })
const filter = (pointer: string, value: string | number | boolean, operator: 'eq' | 'gte' = 'eq'): DataPredicate => ({
  kind: 'comparison', left: { address: { from: 'item', pointer } }, operator, right: { address: { from: 'literal', value } },
})
const context: PluginRequestContext = {
  userId: 'owner', principal: { kind: 'device', userId: 'owner' }, providers: {
    connections: async () => [{ id: 'selected', status: 'connected' } as Awaited<ReturnType<PluginRequestContext['providers']['connections']>>[number]], resource: vi.fn(), items: vi.fn(),
    withConnections: async (_provider, visit) => {
      const value = await visit({ id: 'selected' } as Parameters<typeof visit>[0], 'secret')
      return value === undefined ? [] : [value]
    },
  },
}
const call = (handler: ReturnType<typeof createPullSourceHandler>, input: DataSourceRequest, ctx = context) => handler(
  new Request('http://acorn.test/', { method: 'POST', body: JSON.stringify(input) }), ctx)

afterEach(() => { vi.clearAllMocks(); vi.useRealTimers() })

describe('GitHub typed pull source', () => {
  it('describes independent state/readiness and does not advertise details or incremental reads', async () => {
    const res = await call(createPullSourceHandler(), { operation: 'describe', source, scope })
    const description = dataSourceDescriptionSchema.parse(await res.json())
    expect(description.operations).toMatchObject({ details: false, incremental: false })
    expect(description.fields.find(field => field.pointer === '/state')?.choices).toMatchObject({ kind: 'static' })
    expect(ghGraphQL).not.toHaveBeenCalled()
  })

  it('selects open drafts and failing checks by arbitrary author, excluding closed and merged PRs', async () => {
    vi.mocked(ghGraphQL).mockResolvedValueOnce(upstream([
      node('closed', { state: 'CLOSED' }), node('merged', { state: 'MERGED' }), node('other', { author: { login: 'bob' } }),
      node('open', { isDraft: true }),
    ]))
    const input = query()
    input.query.predicate = { kind: 'all', predicates: [filter('/state', 'open'), filter('/author', 'alice')] }
    const response = await call(createPullSourceHandler(), input)
    const page = dataSourcePageSchema.parse(await response.json())
    expect(page.completeness).toEqual({ kind: 'complete' })
    expect(page.records).toHaveLength(1)
    expect(page.records[0]).toMatchObject({ recordId: 'open', data: { state: 'open', draft: true, mergeStateStatus: 'UNSTABLE', author: 'alice' }, action: { verb: 'openUrl' } })
    expect(vi.mocked(ghGraphQL).mock.calls[0]?.[2]).toMatchObject({ q: 'is:pr repo:org/repo is:open author:alice' })
  })

  it('exhausts upstream pages, orders ties by stable ID, and continues without more provider reads', async () => {
    vi.mocked(ghGraphQL).mockResolvedValueOnce(upstream([node('z')], 'next', 3))
      .mockResolvedValueOnce(upstream([node('a'), node('b')], null, 3))
    const handler = createPullSourceHandler()
    const first = dataSourcePageSchema.parse(await (await call(handler, query())).json())
    expect(first.records[0]?.recordId).toBe('a')
    expect(first.completeness.kind).toBe('more')
    if (first.completeness.kind !== 'more') throw new Error('missing cursor')
    const second = dataSourcePageSchema.parse(await (await call(handler, { ...query(), cursor: first.completeness.cursor, pageSize: 2 })).json())
    expect(second.records.map(row => row.recordId)).toEqual(['b', 'z'])
    expect(second.completeness.kind).toBe('complete')
    expect(ghGraphQL).toHaveBeenCalledTimes(2)
  })

  it('does not accept a sorted take through an upstream ceiling', async () => {
    vi.mocked(ghGraphQL).mockResolvedValueOnce(upstream([node('one')], null, 1001))
    const input = query(); input.query.take = 1
    const page = dataSourcePageSchema.parse(await (await call(createPullSourceHandler(), input)).json())
    expect(page).toMatchObject({ records: [], completeness: { kind: 'incomplete', cause: 'upstream-cap' } })
  })

  it('returns exactly the stable first N and bounded completeness across pages', async () => {
    vi.mocked(ghGraphQL).mockResolvedValueOnce(upstream([node('z'), node('b'), node('a')]))
    const handler = createPullSourceHandler()
    const input = query(); input.query.take = 2
    const first = dataSourcePageSchema.parse(await (await call(handler, input)).json())
    expect(first.records.map(row => row.recordId)).toEqual(['a'])
    if (first.completeness.kind !== 'more') throw new Error('missing cursor')
    const last = dataSourcePageSchema.parse(await (await call(handler, { ...input, cursor: first.completeness.cursor })).json())
    expect(last.records.map(row => row.recordId)).toEqual(['b'])
    expect(last.completeness).toEqual({ kind: 'bounded' })
  })

  it('compares millisecond date boundaries exactly after conservative provider filtering', async () => {
    vi.mocked(ghGraphQL).mockResolvedValueOnce(upstream([node('old'), node('new', { updatedAt: '2026-09-02T00:00:01Z' })]))
    const input = query(); input.query.predicate = filter('/updatedAt', Date.parse('2026-09-02T00:00:00.500Z'), 'gte')
    const page = dataSourcePageSchema.parse(await (await call(createPullSourceHandler(), input)).json())
    expect(page.records.map(row => row.recordId)).toEqual(['new'])
  })

  it.each(['org/repo is:closed', '', 'org'])('rejects invalid repository %j before a network call', async repository => {
    const input = query(); input.query.scope = { ...scope, parameters: { repository } }
    expect((await call(createPullSourceHandler(), input)).ok).toBe(false)
    expect(ghGraphQL).not.toHaveBeenCalled()
  })

  it('rejects qualifier injection, unsupported groups, and unknown sort fields', async () => {
    const handler = createPullSourceHandler()
    for (const predicate of [filter('/author', 'alice is:closed'), { kind: 'any', predicates: [filter('/draft', true)] } as DataPredicate]) {
      const input = query(); input.query.predicate = predicate
      expect((await call(handler, input)).ok).toBe(false)
    }
    const input = query(); input.query.sort = [{ pointer: '/title', direction: 'asc' }]
    expect((await call(handler, input)).ok).toBe(false)
    expect(ghGraphQL).not.toHaveBeenCalled()
  })

  it.each([
    () => Response.json({ errors: [{ message: 'secret provider body' }] }),
    () => new Response('secret', { status: 429, headers: { 'retry-after': '60' } }),
    () => Response.json({ data: null }),
  ])('fails closed on provider errors without leaking bodies', async response => {
    vi.mocked(ghGraphQL).mockResolvedValueOnce(response())
    const res = await call(createPullSourceHandler(), query())
    expect(res.status).toBe(502)
    expect(await res.text()).not.toContain('secret')
  })

  it('rejects duplicate IDs and repeated provider cursors', async () => {
    vi.mocked(ghGraphQL).mockResolvedValueOnce(upstream([node('a')], 'loop', 3))
      .mockResolvedValueOnce(upstream([node('b')], 'loop', 3))
    expect((await call(createPullSourceHandler(), query())).ok).toBe(false)
    vi.mocked(ghGraphQL).mockResolvedValueOnce(upstream([node('a'), node('a')]))
    expect((await call(createPullSourceHandler(), query())).ok).toBe(false)
  })

  it('binds continuation to owner, scope, and evaluation time, and expires it', async () => {
    vi.useFakeTimers()
    vi.mocked(ghGraphQL).mockResolvedValueOnce(upstream([node('a'), node('b')]))
    const handler = createPullSourceHandler()
    const page = dataSourcePageSchema.parse(await (await call(handler, query())).json())
    if (page.completeness.kind !== 'more') throw new Error('missing cursor')
    const input = { ...query(), cursor: page.completeness.cursor }
    expect((await call(handler, input, { ...context, principal: { kind: 'internal', scope: 'task', userId: 'owner', taskId: 'task' } })).status).toBe(403)
    expect((await call(handler, { ...input, evaluationTime: 101 })).ok).toBe(false)
    expect((await call(handler, input, { ...context, userId: 'other' })).ok).toBe(false)
    expect((await call(handler, { ...input, query: { ...input.query, scope: { ...scope, connectionId: 'other' } } })).ok).toBe(false)
    vi.advanceTimersByTime(60_001)
    expect((await call(handler, input)).ok).toBe(false)
    expect(ghGraphQL).toHaveBeenCalledTimes(1)
  })

  it('uses only the explicit connection and keeps repository option pagination', async () => {
    const handler = createPullSourceHandler()
    expect((await call(handler, { ...query(), query: { ...query().query, scope: { ...scope, connectionId: 'other' } } })).ok).toBe(false)
    expect(ghGraphQL).not.toHaveBeenCalled()
    vi.mocked(ghGraphQL).mockResolvedValueOnce(Response.json({ data: { viewer: { repositories: {
      nodes: [{ nameWithOwner: 'org/repo' }], pageInfo: { hasNextPage: true, endCursor: 'repo-next' },
    } } } }))
    const res = await call(handler, { operation: 'options', source, scope, target: 'parameter', pointer: '/repository', search: 'repo', pageSize: 25 })
    expect(await res.json()).toEqual({ options: [{ id: 'org/repo', label: 'org/repo' }], exhausted: false, nextCursor: 'repo-next' })
  })
})
