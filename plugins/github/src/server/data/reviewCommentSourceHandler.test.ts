import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginRequestContext } from '@acorn/plugin-api/node'
import { dataSourcePageSchema, type DataSourceRequest } from '@acorn/protocol/dataSources.ts'
import type { DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { createReviewCommentSourceHandler } from './reviewCommentSourceHandler'
import { ghGraphQL } from '../githubApi'

vi.mock('../githubApi', async (original) => ({
  ...(await original<typeof import('../githubApi')>()),
  ghGraphQL: vi.fn(),
}))
const SECRET = 'the secret text of a comment'
const done = { hasNextPage: false }
const pull = (id: string, overrides = {}) => ({
  id,
  number: 7,
  title: 'Fix the importer',
  url: 'https://github.com/org/repo/pull/7',
  author: { login: 'alice' },
  repository: { nameWithOwner: 'org/repo' },
  comments: { pageInfo: done, nodes: [] },
  reviews: { pageInfo: done, nodes: [] },
  reviewThreads: { pageInfo: done, nodes: [] },
  ...overrides,
})
const at = (day: number) => `2026-09-${String(day).padStart(2, '0')}T00:00:00Z`
const upstream = (nodes: object[], next: string | null = null) =>
  Response.json({
    data: { search: { nodes, issueCount: nodes.length, pageInfo: { hasNextPage: next !== null, endCursor: next } } },
  })
const scope = { connectionId: 'selected', parameters: { repositories: ['org/repo'] } }
const query = (predicate?: DataPredicate): Extract<DataSourceRequest, { operation: 'query' }> => ({
  operation: 'query',
  query: {
    source: { pluginId: 'github', sourceId: 'review-comments' },
    scope,
    sort: [{ pointer: '/createdAt', direction: 'asc' }],
    ...(predicate ? { predicate } : {}),
  },
  mode: 'execution',
  evaluationTime: 100,
  pageSize: 25,
})
const filter = (pointer: string, value: string | number | boolean, operator: 'eq' | 'gte' = 'eq'): DataPredicate => ({
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
const read = async (input: DataSourceRequest, handler = createReviewCommentSourceHandler()) =>
  dataSourcePageSchema.parse(
    await (
      await handler(new Request('http://acorn.test/', { method: 'POST', body: JSON.stringify(input) }), context)
    ).json(),
  )
const searched = () => (vi.mocked(ghGraphQL).mock.calls[0]![2] as { q: string }).q
const ids = (page: { records: { recordId: string }[] }) => page.records.map((record) => record.recordId)

afterEach(() => vi.resetAllMocks())

describe('GitHub review comments source', () => {
  it('reads one record per comment, review, and thread reply, with no comment text', async () => {
    const review = (id: string, state: string, body: string, day: number | null) => ({
      id,
      url: `https://github.com/org/repo/pull/7#pullrequestreview-${id}`,
      state,
      submittedAt: day === null ? null : at(day),
      author: { login: 'bob' },
      body,
    })
    const comment = (id: string, day: number, replyTo: string | null, state = 'COMMENTED') => ({
      id,
      url: `https://github.com/org/repo/pull/7#discussion_${id}`,
      createdAt: at(day),
      author: { login: replyTo ? 'alice' : 'bob' },
      replyTo: replyTo ? { id: replyTo } : null,
      pullRequestReview: { state },
    })
    vi.mocked(ghGraphQL).mockResolvedValueOnce(
      upstream([
        pull('pr', {
          comments: {
            pageInfo: done,
            nodes: [
              {
                id: 'talk',
                url: 'https://github.com/org/repo/pull/7#issuecomment-1',
                createdAt: at(1),
                author: { login: 'alice' },
              },
            ],
          },
          reviews: {
            pageInfo: done,
            nodes: [
              review('approve', 'APPROVED', SECRET, 4),
              // The wrapper GitHub makes for a batch of inline comments, and a draft only bob can see.
              review('wrapper', 'COMMENTED', '', 2),
              review('draft', 'PENDING', SECRET, null),
            ],
          },
          reviewThreads: {
            pageInfo: done,
            nodes: [
              {
                isResolved: true,
                comments: {
                  pageInfo: done,
                  nodes: [
                    comment('inline', 2, null),
                    comment('reply', 3, 'inline'),
                    comment('pending', 5, null, 'PENDING'),
                  ],
                },
              },
            ],
          },
        }),
      ]),
    )
    const page = await read(query())
    expect(page.completeness).toEqual({ kind: 'complete' })
    expect(ids(page)).toEqual(['talk', 'inline', 'reply', 'approve'])
    expect(page.records[1]).toEqual({
      recordId: 'inline',
      data: {
        id: 'inline',
        title: 'org/repo#7: Fix the importer',
        repository: 'org/repo',
        number: 7,
        pullTitle: 'Fix the importer',
        pullUrl: 'https://github.com/org/repo/pull/7',
        author: 'bob',
        authorIsPullAuthor: false,
        kind: 'inline',
        reviewState: 'commented',
        resolved: true,
        createdAt: Date.parse(at(2)),
        url: 'https://github.com/org/repo/pull/7#discussion_inline',
      },
      display: { title: 'org/repo#7: Fix the importer', url: 'https://github.com/org/repo/pull/7#discussion_inline' },
      action: { verb: 'openUrl', url: 'https://github.com/org/repo/pull/7' },
    })
    expect(page.records.map((record) => record.data)).toMatchObject([
      { kind: 'conversation', author: 'alice', authorIsPullAuthor: true, reviewState: null, resolved: null },
      { kind: 'inline' },
      { kind: 'reply', author: 'alice', resolved: true },
      { kind: 'summary', reviewState: 'approved', resolved: null, createdAt: Date.parse(at(4)) },
    ])
    expect(JSON.stringify(page)).not.toContain(SECRET)
  })

  it('reads only pull requests updated in the window, newest first, then checks each comment exactly', async () => {
    const talk = (id: string, day: number) => ({
      id,
      url: `https://github.com/org/repo/pull/7#issuecomment-${id}`,
      createdAt: at(day),
      author: { login: 'bob' },
    })
    vi.mocked(ghGraphQL).mockResolvedValueOnce(
      upstream([
        pull('pr', { comments: { pageInfo: done, nodes: [talk('old', 1), talk('new', 9), talk('alice', 10)] } }),
      ]),
    )
    const page = await read(
      query({
        kind: 'all',
        predicates: [
          filter('/createdAt', Date.parse('2026-09-05T00:00:00.500Z'), 'gte'),
          filter('/kind', 'conversation'),
        ],
      }),
    )
    expect(ids(page)).toEqual(['new', 'alice'])
    expect(searched()).toBe('is:pr repo:org/repo sort:updated-desc updated:>=2026-09-05T00:00:00.000Z')
  })

  it('reads nothing when the scope chose no repositories, and refuses a filter it does not offer', async () => {
    const input = query()
    input.query.scope = { ...scope, parameters: { repositories: [] } }
    expect(await read(input)).toMatchObject({ records: [], completeness: { kind: 'complete' } })
    const refused = await createReviewCommentSourceHandler()(
      new Request('http://acorn.test/', { method: 'POST', body: JSON.stringify(query(filter('/pullTitle', 'x'))) }),
      context,
    )
    expect(refused.ok).toBe(false)
    expect(ghGraphQL).not.toHaveBeenCalled()
  })

  it('stops at 100 pull requests, keeps their comments, and says incomplete only on the last page', async () => {
    for (let page = 0; page < 5; page++)
      vi.mocked(ghGraphQL).mockResolvedValueOnce(
        upstream(
          Array.from({ length: 20 }, (_, index) =>
            pull(`pr-${page}-${index}`, {
              comments: {
                pageInfo: done,
                nodes: [
                  {
                    id: `c-${page}-${index}`,
                    url: 'https://github.com/org/repo/pull/7',
                    createdAt: at(1),
                    author: null,
                  },
                ],
              },
            }),
          ),
          `page-${page}`,
        ),
      )
    const handler = createReviewCommentSourceHandler()
    const first = await read({ ...query(), pageSize: 60 }, handler)
    expect(first.records).toHaveLength(60)
    if (first.completeness.kind !== 'more') throw new Error('missing cursor')
    const last = await read({ ...query(), pageSize: 60, cursor: first.completeness.cursor }, handler)
    expect(last.records).toHaveLength(40)
    expect(last.completeness).toEqual({ kind: 'incomplete', cause: 'upstream-cap' })
    expect(ghGraphQL).toHaveBeenCalledTimes(5)
    expect(vi.mocked(ghGraphQL).mock.calls[4]?.[2]).toMatchObject({ first: 20, after: 'page-3' })
  })

  it('keeps a thread GitHub cut short and says the read is incomplete', async () => {
    vi.mocked(ghGraphQL).mockResolvedValueOnce(
      upstream([
        pull('pr', {
          reviewThreads: {
            pageInfo: done,
            nodes: [
              {
                isResolved: false,
                comments: {
                  pageInfo: { hasNextPage: true },
                  nodes: [
                    {
                      id: 'inline',
                      url: 'https://github.com/org/repo/pull/7#discussion_1',
                      createdAt: at(1),
                      author: { login: 'bob' },
                      replyTo: null,
                      pullRequestReview: null,
                    },
                  ],
                },
              },
            ],
          },
        }),
      ]),
    )
    const page = await read(query())
    expect(ids(page)).toEqual(['inline'])
    expect(page.records[0]?.data).toMatchObject({ resolved: false, reviewState: null })
    expect(page.completeness).toEqual({ kind: 'incomplete', cause: 'upstream-cap' })
  })
})
