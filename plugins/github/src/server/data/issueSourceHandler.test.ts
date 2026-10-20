import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginRequestContext } from '@acorn/plugin-api/node'
import { dataSourcePageSchema, type DataSourceRequest } from '@acorn/protocol/dataSources.ts'
import type { DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { createIssueSourceHandler } from './issueSourceHandler'
import { ghGraphQL } from '../githubApi'

vi.mock('../githubApi', async (original) => ({
  ...(await original<typeof import('../githubApi')>()),
  ghGraphQL: vi.fn(),
}))
const issue = (id: string, overrides = {}) => ({
  __typename: 'Issue',
  id,
  number: 7,
  title: 'Crash on save',
  url: 'https://github.com/org/repo/issues/7',
  state: 'OPEN',
  stateReason: null,
  author: { login: 'alice' },
  repository: { nameWithOwner: 'org/repo' },
  milestone: { title: 'v2' },
  comments: { totalCount: 3 },
  assignees: { nodes: [{ login: 'bob' }], pageInfo: { hasNextPage: false, endCursor: null } },
  labels: { nodes: [{ name: 'bug' }], pageInfo: { hasNextPage: false, endCursor: null } },
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-02T00:00:00Z',
  closedAt: null,
  ...overrides,
})
const upstream = (nodes: object[], next: string | null = null, count = nodes.length) =>
  Response.json({
    data: { search: { nodes, issueCount: count, pageInfo: { hasNextPage: next !== null, endCursor: next } } },
  })
const scope = { connectionId: 'selected', parameters: { repositories: ['org/repo'] } }
const source = { pluginId: 'github', sourceId: 'issues' }
const query = (predicate?: DataPredicate): Extract<DataSourceRequest, { operation: 'query' }> => ({
  operation: 'query',
  query: { source, scope, sort: [{ pointer: '/updatedAt', direction: 'desc' }], ...(predicate ? { predicate } : {}) },
  mode: 'execution',
  evaluationTime: 100,
  pageSize: 25,
})
const filter = (
  pointer: string,
  value: string | number,
  operator: 'eq' | 'contains' | 'gte' = 'eq',
): DataPredicate => ({
  kind: 'comparison',
  left: { address: { from: 'item', pointer } },
  operator,
  right: { address: { from: 'literal', value } },
})
const context: PluginRequestContext = {
  userId: 'owner',
  principal: { kind: 'device', userId: 'owner' },
  providers: {
    connections: async () => [
      { id: 'selected', status: 'connected' } as Awaited<
        ReturnType<PluginRequestContext['providers']['connections']>
      >[number],
    ],
    resource: vi.fn(),
    items: vi.fn(),
    withConnections: async (_provider, visit) => {
      const value = await visit({ id: 'selected', status: 'connected' } as Parameters<typeof visit>[0], 'secret')
      return value === undefined ? [] : [value]
    },
  },
}
const read = async (input: DataSourceRequest, handler = createIssueSourceHandler()) =>
  dataSourcePageSchema.parse(
    await (
      await handler(new Request('http://acorn.test/', { method: 'POST', body: JSON.stringify(input) }), context)
    ).json(),
  )
const searched = () => (vi.mocked(ghGraphQL).mock.calls[0]![2] as { q: string }).q

afterEach(() => vi.resetAllMocks())

describe('GitHub issues source', () => {
  it('reads one record per issue, without its body, and opens it on GitHub', async () => {
    vi.mocked(ghGraphQL).mockResolvedValueOnce(
      upstream([
        issue('open'),
        issue('done', { state: 'CLOSED', stateReason: 'NOT_PLANNED', closedAt: '2026-09-03T00:00:00Z' }),
        issue('reopened', { stateReason: 'REOPENED', author: null, milestone: null }),
      ]),
    )
    const page = await read(query())
    expect(page.completeness).toEqual({ kind: 'complete' })
    expect(page.records.find((record) => record.recordId === 'open')).toEqual({
      recordId: 'open',
      data: {
        id: 'open',
        number: 7,
        title: 'Crash on save',
        repository: 'org/repo',
        url: 'https://github.com/org/repo/issues/7',
        state: 'open',
        closeReason: null,
        author: 'alice',
        assignees: ['bob'],
        labels: ['bug'],
        milestone: 'v2',
        comments: 3,
        createdAt: Date.parse('2026-09-01T00:00:00Z'),
        updatedAt: Date.parse('2026-09-02T00:00:00Z'),
        closedAt: null,
      },
      display: { title: 'Crash on save', url: 'https://github.com/org/repo/issues/7' },
      action: { verb: 'openUrl', url: 'https://github.com/org/repo/issues/7' },
    })
    expect(page.records.find((record) => record.recordId === 'done')?.data).toMatchObject({
      state: 'closed',
      closeReason: 'not_planned',
      closedAt: Date.parse('2026-09-03T00:00:00Z'),
    })
    expect(page.records.find((record) => record.recordId === 'reopened')?.data).toMatchObject({
      state: 'open',
      closeReason: null,
      author: null,
      milestone: null,
    })
  })

  it('searches only issues in the chosen repositories and leaves out any pull request GitHub returns', async () => {
    vi.mocked(ghGraphQL).mockResolvedValueOnce(upstream([issue('a'), { __typename: 'PullRequest' }, issue('b')]))
    const page = await read(query())
    expect(page.records.map((record) => record.recordId)).toEqual(['a', 'b'])
    expect(searched()).toBe('is:issue repo:org/repo')
  })

  it('reads nothing when the scope chose no repositories', async () => {
    const input = query()
    input.query.scope = { ...scope, parameters: { repositories: [] } }
    expect(await read(input)).toMatchObject({ records: [], completeness: { kind: 'complete' } })
    expect(ghGraphQL).not.toHaveBeenCalled()
  })

  it('narrows the search by state, assignee, label, and close time, then checks each value exactly', async () => {
    vi.mocked(ghGraphQL).mockResolvedValueOnce(
      upstream([
        issue('match', { state: 'CLOSED', closedAt: '2026-09-10T00:00:00Z' }),
        issue('other-assignee', {
          state: 'CLOSED',
          closedAt: '2026-09-10T00:00:00Z',
          assignees: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
        }),
        issue('label-case', {
          state: 'CLOSED',
          closedAt: '2026-09-10T00:00:00Z',
          labels: { nodes: [{ name: 'Bug' }], pageInfo: { hasNextPage: false, endCursor: null } },
        }),
        issue('still-open'),
      ]),
    )
    const page = await read(
      query({
        kind: 'all',
        predicates: [
          filter('/state', 'closed'),
          filter('/assignees', 'bob', 'contains'),
          filter('/labels', 'bug', 'contains'),
          filter('/closedAt', Date.parse('2026-09-05T00:00:00.500Z'), 'gte'),
        ],
      }),
    )
    expect(page.records.map((record) => record.recordId)).toEqual(['match'])
    expect(searched()).toBe(
      'is:issue repo:org/repo is:closed assignee:bob label:"bug" closed:>=2026-09-05T00:00:00.000Z',
    )
  })

  it("filters a label with a quote in it after the read, since GitHub's search can't hold it", async () => {
    vi.mocked(ghGraphQL).mockResolvedValueOnce(
      upstream([
        issue('quoted', {
          labels: { nodes: [{ name: 'say "hi"' }], pageInfo: { hasNextPage: false, endCursor: null } },
        }),
        issue('plain'),
      ]),
    )
    const page = await read(query(filter('/labels', 'say "hi"', 'contains')))
    expect(page.records.map((record) => record.recordId)).toEqual(['quoted'])
    expect(searched()).toBe('is:issue repo:org/repo')
  })

  it('refuses a search qualifier smuggled into a login, an unsupported filter, or an unsortable field', async () => {
    for (const input of [
      query(filter('/assignees', 'bob is:open', 'contains')),
      query(filter('/milestone', 'v2')),
      { ...query(), query: { ...query().query, sort: [{ pointer: '/closedAt', direction: 'asc' as const }] } },
    ]) {
      const response = await createIssueSourceHandler()(
        new Request('http://acorn.test/', { method: 'POST', body: JSON.stringify(input) }),
        context,
      )
      expect(response.ok).toBe(false)
    }
    expect(ghGraphQL).not.toHaveBeenCalled()
  })

  it('reads every page, then pages through its own copy without asking GitHub again', async () => {
    vi.mocked(ghGraphQL)
      .mockResolvedValueOnce(upstream([issue('z')], 'next', 3))
      .mockResolvedValueOnce(upstream([issue('a'), issue('b')], null, 3))
    const handler = createIssueSourceHandler()
    const first = await read({ ...query(), pageSize: 2 }, handler)
    expect(first.records.map((record) => record.recordId)).toEqual(['a', 'b'])
    if (first.completeness.kind !== 'more') throw new Error('missing cursor')
    const second = await read({ ...query(), pageSize: 2, cursor: first.completeness.cursor }, handler)
    expect(second.records.map((record) => record.recordId)).toEqual(['z'])
    expect(second.completeness).toEqual({ kind: 'complete' })
    expect(vi.mocked(ghGraphQL).mock.calls[1]?.[2]).toMatchObject({ first: 100, after: 'next' })
    expect(ghGraphQL).toHaveBeenCalledTimes(2)
  })

  it('says it is incomplete, with no rows, past 1,000 matches or a capped label list', async () => {
    vi.mocked(ghGraphQL).mockResolvedValueOnce(upstream([issue('a')], 'next', 1001))
    expect(await read(query())).toMatchObject({
      records: [],
      completeness: { kind: 'incomplete', cause: 'upstream-cap' },
    })
    vi.mocked(ghGraphQL).mockResolvedValueOnce(
      upstream([issue('a', { labels: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'more' } } })]),
    )
    expect(await read(query())).toMatchObject({
      records: [],
      completeness: { kind: 'incomplete', cause: 'upstream-cap' },
    })
  })

  it('stops at the host budget when the matches outgrow it', async () => {
    const title = 'x'.repeat(200_000)
    for (let page = 0; page < 10; page++)
      vi.mocked(ghGraphQL).mockResolvedValueOnce(
        upstream(
          Array.from({ length: 10 }, (_, index) => issue(`${page}-${index}`, { title })),
          page < 9 ? `page-${page}` : null,
          100,
        ),
      )
    expect(await read(query())).toMatchObject({
      records: [],
      completeness: { kind: 'incomplete', cause: 'host-budget' },
    })
    // About 84 of these records fill the 16 MiB budget, so the ninth page is the last one read.
    expect(ghGraphQL).toHaveBeenCalledTimes(9)
  })

  it('rejects repeated provider cursors and duplicate IDs', async () => {
    vi.mocked(ghGraphQL)
      .mockResolvedValueOnce(upstream([issue('a')], 'loop', 3))
      .mockResolvedValueOnce(upstream([issue('b')], 'loop', 3))
    const handler = createIssueSourceHandler()
    const call = () =>
      handler(new Request('http://acorn.test/', { method: 'POST', body: JSON.stringify(query()) }), context)
    expect((await call()).ok).toBe(false)
    vi.mocked(ghGraphQL).mockResolvedValueOnce(upstream([issue('a'), issue('a')]))
    expect((await call()).ok).toBe(false)
  })
})
