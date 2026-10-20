import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginRequestContext } from '@acorn/plugin-api/node'
import { dataSourcePageSchema, type DataSourceRequest } from '@acorn/protocol/dataSources.ts'
import type { DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { cycleSourceDescription } from '../../shared/cycleSource'
import { projectSourceDescription } from '../../shared/projectSource'
import { readCycleOptions, readCycles } from './cycleRead'
import { readProjects } from './projectRead'
import { createLinearSourceHandler } from './sourceHandler'
import { linearFetch } from '../index'

vi.mock('../index', async (original) => ({ ...(await original<typeof import('../index')>()), linearFetch: vi.fn() }))
afterEach(() => vi.clearAllMocks())

const scope = { connectionId: 'selected', parameters: {} }
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
      const results = []
      for (const id of ['other', 'selected']) {
        const value = await visit({ id } as Parameters<typeof visit>[0], `${id}-secret`)
        if (value !== undefined) results.push(value)
      }
      return results
    },
  },
}
const cycles = () => createLinearSourceHandler(cycleSourceDescription, readCycles, readCycleOptions)
const projects = () => createLinearSourceHandler(projectSourceDescription, readProjects)
const call = async (handler: ReturnType<typeof cycles>, request: DataSourceRequest) => {
  const response = await handler(
    new Request('http://acorn.test/', { method: 'POST', body: JSON.stringify(request) }),
    context,
  )
  return { status: response.status, body: await response.json() }
}
const query = (sourceId: string, predicate?: DataPredicate, pageSize = 100) =>
  ({
    operation: 'query',
    query: { source: { pluginId: 'linear', sourceId }, scope, sort: [], ...(predicate ? { predicate } : {}) },
    mode: 'execution',
    evaluationTime: 100,
    pageSize,
  }) satisfies DataSourceRequest
const compare = (pointer: string, operator: 'eq' | 'gte', value: string | number): DataPredicate => ({
  kind: 'comparison',
  left: { address: { from: 'item', pointer } },
  operator,
  right: { address: { from: 'literal', value } },
})
const page = <T>(nodes: T[], next: string | null = null) => ({
  nodes,
  pageInfo: { hasNextPage: next !== null, endCursor: next },
})
const graphQl = (data: unknown) => Response.json({ data })
const cycle = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  number: 12,
  name: null,
  startsAt: '2026-10-05T00:00:00Z',
  endsAt: '2026-10-19T00:00:00Z',
  completedAt: '2026-10-19T00:00:00Z',
  progress: 0.6253,
  isActive: false,
  isFuture: false,
  issueCountHistory: [8, 9, 11],
  completedIssueCountHistory: [0, 2, 7],
  team: { id: 'team1', key: 'ENG', name: 'Engineering' },
  ...overrides,
})
const cyclePage = (nodes: unknown[], next: string | null = null) =>
  graphQl({ organization: { urlKey: 'acme' }, cycles: page(nodes, next) })
const project = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: 'Billing revamp',
  url: `https://linear.app/acme/project/${id}`,
  status: { name: 'Building', type: 'started' },
  lead: { name: 'Ada' },
  teams: { nodes: [{ name: 'Engineering' }, { name: 'Design' }] },
  progress: 0.4,
  targetDate: '2026-11-30',
  startedAt: '2026-09-01T00:00:00Z',
  completedAt: null,
  updatedAt: '2026-10-18T00:00:00Z',
  description: 'never read',
  ...overrides,
})

describe('Linear cycles source', () => {
  it("reads the selected account's cycles into records that name their status, counts, and address", async () => {
    vi.mocked(linearFetch).mockResolvedValueOnce(
      cyclePage([
        cycle('past'),
        cycle('now', { number: 13, name: 'Polish', isActive: true, completedAt: null }),
        cycle('next', {
          number: 14,
          isFuture: true,
          completedAt: null,
          issueCountHistory: [],
          completedIssueCountHistory: [],
        }),
      ]),
    )
    const { body } = await call(cycles(), query('cycles'))
    const result = dataSourcePageSchema.parse(body)
    expect(result.completeness).toEqual({ kind: 'complete' })
    expect(result.records.map((record) => record.data)).toEqual([
      {
        id: 'next',
        number: 14,
        title: 'Cycle 14',
        url: 'https://linear.app/acme/team/ENG/cycle/14',
        team: { id: 'team1', key: 'ENG', name: 'Engineering' },
        status: 'upcoming',
        startsAt: Date.parse('2026-10-05T00:00:00Z'),
        endsAt: Date.parse('2026-10-19T00:00:00Z'),
        completedAt: null,
        progress: 62.5,
        issueCount: null,
        completedIssueCount: null,
        addedIssueCount: null,
      },
      expect.objectContaining({ id: 'now', title: 'Polish', status: 'active' }),
      expect.objectContaining({
        id: 'past',
        status: 'past',
        issueCount: 11,
        completedIssueCount: 7,
        addedIssueCount: 3,
      }),
    ])
    expect(result.records[0]?.action).toEqual({ verb: 'openUrl', url: 'https://linear.app/acme/team/ENG/cycle/14' })
    expect(vi.mocked(linearFetch).mock.calls.map((args) => args[0])).toEqual(['selected-secret'])
    expect(vi.mocked(linearFetch).mock.calls[0]?.[2]).toEqual({ filter: null, after: null })
  })

  it('sends team, status, and date filters to Linear and checks the answer against them', async () => {
    vi.mocked(linearFetch).mockResolvedValueOnce(cyclePage([cycle('past'), cycle('now', { isActive: true })]))
    const request = query('cycles', {
      kind: 'all',
      predicates: [
        compare('/team/id', 'eq', 'team1'),
        compare('/status', 'eq', 'past'),
        compare('/endsAt', 'gte', Date.parse('2026-10-01T00:00:00Z')),
      ],
    })
    const result = dataSourcePageSchema.parse((await call(cycles(), request)).body)
    expect(result.records.map((record) => record.recordId)).toEqual(['past'])
    expect(vi.mocked(linearFetch).mock.calls[0]?.[2]).toEqual({
      filter: {
        and: [
          { team: { id: { eq: 'team1' } } },
          { isActive: { eq: false }, isFuture: { eq: false } },
          { endsAt: { gte: '2026-10-01T00:00:00.000Z' } },
        ],
      },
      after: null,
    })
  })

  it('refuses a status it does not offer and a filter on a field it cannot send', async () => {
    expect((await call(cycles(), query('cycles', compare('/status', 'eq', 'someday')))).status).toBe(502)
    expect((await call(cycles(), query('cycles', compare('/progress', 'gte', 50)))).status).toBe(502)
    expect(linearFetch).not.toHaveBeenCalled()
  })

  it('offers team choices page by page', async () => {
    vi.mocked(linearFetch).mockResolvedValueOnce(
      graphQl({ teams: page([{ id: 'team1', name: 'Engineering' }], 'next') }),
    )
    const { body } = await call(cycles(), {
      operation: 'options',
      source: { pluginId: 'linear', sourceId: 'cycles' },
      scope,
      target: 'field',
      pointer: '/team/id',
      search: 'eng',
      pageSize: 1,
    })
    expect(body).toEqual({ options: [{ id: 'team1', label: 'Engineering' }], nextCursor: 'next', exhausted: false })
    expect(vi.mocked(linearFetch).mock.calls[0]?.[2]).toEqual({
      first: 1,
      after: null,
      filter: { name: { containsIgnoreCase: 'eng' } },
    })
  })
})

describe('Linear projects source', () => {
  it('reads projects without descriptions, and pages a full selection with a continuation', async () => {
    vi.mocked(linearFetch)
      .mockResolvedValueOnce(graphQl({ projects: page([project('p1')], 'next') }))
      .mockResolvedValueOnce(
        graphQl({ projects: page([project('p2', { lead: null, completedAt: '2026-10-10T00:00:00Z' })]) }),
      )
    const handler = projects()
    const first = dataSourcePageSchema.parse((await call(handler, query('projects', undefined, 1))).body)
    expect(first.records[0]?.data).toEqual({
      id: 'p1',
      name: 'Billing revamp',
      url: 'https://linear.app/acme/project/p1',
      status: { name: 'Building', type: 'started' },
      lead: 'Ada',
      teams: ['Engineering', 'Design'],
      progress: 40,
      targetDate: '2026-11-30',
      startedAt: Date.parse('2026-09-01T00:00:00Z'),
      completedAt: null,
      updatedAt: Date.parse('2026-10-18T00:00:00Z'),
    })
    if (first.completeness.kind !== 'more') throw new Error('missing continuation')
    const last = dataSourcePageSchema.parse(
      (await call(handler, { ...query('projects', undefined, 1), cursor: first.completeness.cursor })).body,
    )
    expect(last).toMatchObject({
      records: [{ recordId: 'p2', data: { lead: null } }],
      completeness: { kind: 'complete' },
    })
    expect(vi.mocked(linearFetch).mock.calls[1]?.[2]).toEqual({ filter: null, after: 'next' })
    expect(linearFetch).toHaveBeenCalledTimes(2)
  })

  it('sends the status type and dates to Linear', async () => {
    vi.mocked(linearFetch).mockResolvedValueOnce(graphQl({ projects: page([project('p1')]) }))
    await call(
      projects(),
      query('projects', {
        kind: 'all',
        predicates: [compare('/status/type', 'eq', 'started'), compare('/updatedAt', 'gte', 1000)],
      }),
    )
    expect(vi.mocked(linearFetch).mock.calls[0]?.[2]).toMatchObject({
      filter: { and: [{ status: { type: { eq: 'started' } } }, { updatedAt: { gte: '1970-01-01T00:00:01.000Z' } }] },
    })
    expect((await call(projects(), query('projects', compare('/status/type', 'eq', 'done')))).status).toBe(502)
  })

  it('reports a selection past the 5,000-record budget as incomplete, with no records to take from', async () => {
    let served = 0
    vi.mocked(linearFetch).mockImplementation(async () => {
      const nodes = Array.from({ length: 50 }, () => project(`p${served++}`))
      return graphQl({ projects: page(nodes, `after-${served}`) })
    })
    const { body } = await call(projects(), query('projects'))
    expect(body).toMatchObject({ records: [], completeness: { kind: 'incomplete', cause: 'upstream-cap' } })
    expect(linearFetch).toHaveBeenCalledTimes(100)
  })

  it('answers options as unsupported, since every filter it offers has fixed choices', async () => {
    const { status } = await call(projects(), {
      operation: 'options',
      source: { pluginId: 'linear', sourceId: 'projects' },
      scope,
      target: 'field',
      pointer: '/status/type',
      search: '',
      pageSize: 10,
    })
    expect(status).toBe(400)
  })
})
