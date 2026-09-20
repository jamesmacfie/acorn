import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginRequestContext } from '@acorn/plugin-api/node'
import { dataSourceDescriptionSchema, dataSourcePageSchema, type DataSourceRequest } from '@acorn/protocol/dataSources.ts'
import { createIssueSourceHandler } from './issueSourceHandler'
import { linearFetch } from '../index'

vi.mock('../index', async original => ({ ...await original<typeof import('../index')>(), linearFetch: vi.fn() }))
const source = { pluginId: 'linear', sourceId: 'issues' }
const scope = { connectionId: 'selected', parameters: { project: 'p1' } }
const input = (): Extract<DataSourceRequest, { operation: 'query' }> => ({ operation: 'query', query: { source, scope, sort: [{ pointer: '/updatedAt', direction: 'desc' }] }, mode: 'execution', evaluationTime: 100, pageSize: 1 })
const context: PluginRequestContext = { userId: 'owner', principal: { kind: 'device', userId: 'owner' }, providers: {
  connections: vi.fn(async () => [{ id: 'selected', status: 'connected' } as Awaited<ReturnType<PluginRequestContext['providers']['connections']>>[number]]),
  items: vi.fn(), resource: vi.fn(), withConnections: async (_provider, visit) => {
    const results = []
    for (const id of ['other', 'selected']) {
      const value = await visit({ id } as Parameters<typeof visit>[0], id === 'selected' ? 'selected-secret' : 'foreign-secret')
      if (value !== undefined) results.push(value)
    }
    return results
  },
} }
const call = (handler: ReturnType<typeof createIssueSourceHandler>, request: DataSourceRequest, ctx = context) => handler(new Request('http://acorn.test/', { method: 'POST', body: JSON.stringify(request) }), ctx)
const page = <T>(nodes: T[], next: string | null = null) => ({ nodes, pageInfo: { hasNextPage: next !== null, endCursor: next } })
const response = (data: unknown) => Response.json({ data })
const issue = (id: string, state = 'review') => ({ id, identifier: 'ENG-1', title: 'Issue', url: 'https://linear.app/issue/ENG-1', description: 'Full description',
  project: { id: 'p1' }, state: { id: state, name: state, type: 'started' }, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z' })
const teams = () => response({ project: { teams: page([{ id: 'team1', name: 'Engineering' }]) } })
afterEach(() => vi.clearAllMocks())

describe('Linear typed issue source', () => {
  it('stops an aborted read before spending credentials', async () => {
    const controller = new AbortController(); controller.abort()
    const result = await createIssueSourceHandler()(new Request('http://acorn.test/', { method: 'POST', body: JSON.stringify(input()), signal: controller.signal }), context)
    expect(result.status).toBe(502)
    expect(linearFetch).not.toHaveBeenCalled()
  })
  it('describes exact state IDs with a project dependency', async () => {
    const description = dataSourceDescriptionSchema.parse(await (await call(createIssueSourceHandler(), { operation: 'describe', source, scope })).json())
    expect(description.fields.find(field => field.pointer === '/state/id')?.choices).toEqual({ kind: 'dynamic', dependsOn: ['/project'] })
  })
  it('keeps distinct same-category states and paginates project-scoped options', async () => {
    vi.mocked(linearFetch).mockResolvedValueOnce(teams()).mockResolvedValueOnce(response({ workflowStates: page([{ id: 'review', name: 'Review' }, { id: 'working', name: 'Working' }], 'next') }))
    const options: DataSourceRequest = { operation: 'options', source, scope, target: 'field', pointer: '/state/id', search: '', pageSize: 2 }
    expect(await (await call(createIssueSourceHandler(), options)).json()).toEqual({ options: [{ id: 'review', label: 'Review' }, { id: 'working', label: 'Working' }], nextCursor: 'next', exhausted: false })
    expect(vi.mocked(linearFetch).mock.calls[1]?.[2]).toMatchObject({ filter: { team: { id: { in: ['team1'] } } } })
    vi.mocked(linearFetch).mockResolvedValueOnce(response({ projects: page([{ id: 'p2', name: 'Second' }]) }))
    await call(createIssueSourceHandler(), { ...options, target: 'parameter', pointer: '/project', cursor: 'project-next' })
    expect(vi.mocked(linearFetch).mock.calls[2]?.[2]).toMatchObject({ after: 'project-next' })
    expect(vi.mocked(linearFetch).mock.calls.every(call => call[0] === 'selected-secret')).toBe(true)
  })
  it('exhausts pages before exact state filtering and stable take, and rejects foreign continuations', async () => {
    vi.mocked(linearFetch).mockResolvedValueOnce(teams()).mockResolvedValueOnce(response({ workflowState: { team: { id: 'team1' } } }))
      .mockResolvedValueOnce(response({ issues: page([issue('z'), issue('other', 'working')], 'next') }))
      .mockResolvedValueOnce(response({ issues: page([issue('a')]) }))
    const request = input(); request.query.take = 2
    request.query.predicate = { kind: 'comparison', left: { address: { from: 'item', pointer: '/state/id' } }, operator: 'eq', right: { address: { from: 'literal', value: 'review' } } }
    const handler = createIssueSourceHandler()
    const first = dataSourcePageSchema.parse(await (await call(handler, request)).json())
    expect(first.records[0]).toMatchObject({ recordId: 'a', data: { state: { id: 'review', category: 'started' } } })
    if (first.completeness.kind !== 'more') throw new Error('missing continuation')
    const continued = { ...request, cursor: first.completeness.cursor }
    const last = dataSourcePageSchema.parse(await (await call(handler, continued)).json())
    expect(last).toMatchObject({ records: [{ recordId: 'z' }], completeness: { kind: 'bounded' } })
    expect((await call(handler, continued, { ...context, userId: 'foreign' })).status).toBe(502)
    expect((await call(handler, continued, { ...context, principal: { kind: 'internal', userId: 'owner', scope: 'task', taskId: 'task' } })).status).toBe(403)
    expect(linearFetch).toHaveBeenCalledTimes(4)
  })
  it('rejects a selected state after a project change instead of reporting an empty selection', async () => {
    vi.mocked(linearFetch).mockResolvedValueOnce(teams()).mockResolvedValueOnce(response({ workflowState: { team: { id: 'another-team' } } }))
    const request = input()
    request.query.predicate = { kind: 'comparison', left: { address: { from: 'item', pointer: '/state/id' } }, operator: 'eq', right: { address: { from: 'literal', value: 'review' } } }
    expect((await call(createIssueSourceHandler(), request)).status).toBe(502)
    expect(linearFetch).toHaveBeenCalledTimes(2)
  })
  it('distinguishes exhausted emptiness from API failure and translates dates', async () => {
    vi.mocked(linearFetch).mockResolvedValueOnce(teams()).mockResolvedValueOnce(response({ issues: page([]) }))
    const request = input()
    request.query.predicate = { kind: 'comparison', left: { address: { from: 'item', pointer: '/updatedAt' } }, operator: 'gte', right: { address: { from: 'literal', value: 1000 } } }
    expect(await (await call(createIssueSourceHandler(), request)).json()).toMatchObject({ records: [], completeness: { kind: 'complete' } })
    expect(vi.mocked(linearFetch).mock.calls[1]?.[2]).toMatchObject({ filter: { and: [{ project: { id: { eq: 'p1' } } }, { updatedAt: { gte: '1970-01-01T00:00:01.000Z' } }] } })
    vi.mocked(linearFetch).mockResolvedValueOnce(Response.json({ errors: [{ message: 'private secret' }] }))
    const failed = await call(createIssueSourceHandler(), input())
    expect(failed.status).toBe(502)
    expect(await failed.text()).not.toContain('private secret')
  })
})
