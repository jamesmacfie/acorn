import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginRequestContext, StoredConnection } from '@acorn/plugin-api/node'
import { dataSourcePageSchema } from '@acorn/protocol/dataSources.ts'
import type { DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { FAKE_AUTH, makeFakeBitbucket, makePullRequest } from '../fakeBitbucket.helper'
import { createPullRequestSourceHandler, createReviewCommentSourceHandler, createStepSourceHandler } from './sources'

// Bitbucket's two read sources, over the fake: what a panel's query reads.
let fake: ReturnType<typeof makeFakeBitbucket>
beforeEach(() => {
  fake = makeFakeBitbucket([
    {
      path: 'acme/api',
      defaultBranch: 'main',
      pullRequests: [makePullRequest(), makePullRequest({ id: 13, state: 'MERGED', sourceRepository: 'alice/api' })],
      pipelines: [
        {
          uuid: '{p1}',
          buildNumber: 7,
          branch: 'main',
          steps: [
            { uuid: '{s1}', name: 'Test', state: 'COMPLETED', result: 'FAILED' },
            { uuid: '{s2}', name: 'Deploy', state: 'PENDING' },
          ],
        },
      ],
    },
  ])
  vi.stubGlobal('fetch', fake.fetch)
})
afterEach(() => vi.unstubAllGlobals())

const connection = { id: 'conn-1', status: 'connected' } as StoredConnection
const context = {
  userId: 'owner',
  principal: { kind: 'device', userId: 'owner' },
  providers: {
    withConnections: async <T>(
      _provider: string,
      visit: (c: StoredConnection, auth: string) => Promise<T | undefined>,
    ) => {
      const value = await visit(connection, FAKE_AUTH)
      return value === undefined ? [] : [value]
    },
  },
} as unknown as PluginRequestContext
const query = (url: string, source: string) =>
  new Request(url, {
    method: 'POST',
    body: JSON.stringify({
      operation: 'query',
      query: {
        source: { pluginId: 'bitbucket', sourceId: source },
        scope: { connectionId: 'conn-1', parameters: { repositories: ['Acme/API'] } },
        sort: [],
      },
      pageSize: 50,
      mode: 'execution',
      evaluationTime: Date.now(),
    }),
  })

it('reads every state of the pull requests in the repositories a panel names, with reviewers and forks', async () => {
  const response = await createPullRequestSourceHandler()(
    query('http://acorn.test/data/pull-requests', 'pull-requests'),
    context,
  )
  const page = dataSourcePageSchema.parse(await response.json())
  expect(page.records.map((record) => [record.recordId, record.data])).toEqual([
    [
      'acme/api#12',
      expect.objectContaining({ repository: 'acme/api', state: 'open', reviewers: ['grace'], sourceRepository: null }),
    ],
    ['acme/api#13', expect.objectContaining({ state: 'merged', sourceRepository: 'alice/api' })],
  ])
})

it("reads the newest pipelines' steps, with each step's result", async () => {
  const response = await createStepSourceHandler()(query('http://acorn.test/data/steps', 'pipeline-steps'), context)
  const page = dataSourcePageSchema.parse(await response.json())
  expect(page.records.map((record) => [record.data, record.actions])).toEqual([
    [expect.objectContaining({ name: 'Test', status: 'failed', pipelineNumber: 7, durationMs: 60_000 }), undefined],
    [expect.objectContaining({ name: 'Deploy', status: 'pending', finishedAt: null }), undefined],
  ])
  expect(page.records[0]!.data).toMatchObject({
    url: 'https://bitbucket.org/acme/api/pipelines/results/7/steps/%7Bs1%7D',
  })
})

describe('Bitbucket review comments', () => {
  const SECRET = 'the secret text of a comment'
  const day = (number: number) => `2026-10-${String(number).padStart(2, '0')}T00:00:00Z`
  const comment = (id: number, author: string, created: number, extra = {}) => ({
    id,
    body: SECRET,
    author,
    createdOn: day(created),
    ...extra,
  })
  const stubRepository = (pullRequests: ReturnType<typeof makePullRequest>[]) => {
    fake = makeFakeBitbucket([{ path: 'acme/api', defaultBranch: 'main', pullRequests }])
    const fetch = vi.fn(fake.fetch)
    vi.stubGlobal('fetch', fetch)
    return () => fetch.mock.calls.map(([input]) => new URL(String(input)))
  }
  const read = async (handler: ReturnType<typeof createReviewCommentSourceHandler>, body: object = {}) =>
    dataSourcePageSchema.parse(
      await (
        await handler(
          new Request('http://acorn.test/data/review-comments', {
            method: 'POST',
            body: JSON.stringify({
              ...(await query('http://acorn.test/data/review-comments', 'review-comments').json()),
              ...body,
            }),
          }),
          context,
        )
      ).json(),
    )

  it('reads one record per comment, leaves out drafts, and keeps no comment text', async () => {
    stubRepository([
      makePullRequest({
        comments: [
          comment(1, 'grace', 2, { inline: { path: 'src/app.ts', to: 1 }, resolved: true }),
          comment(2, 'ada', 3, { parentId: 1 }),
          comment(3, 'grace', 4),
          comment(4, 'grace', 5, { inline: { path: 'src/app.ts', to: 2 } }),
          comment(5, 'grace', 6, { pending: true }),
        ],
      }),
    ])
    const page = await read(createReviewCommentSourceHandler())
    expect(page.completeness).toEqual({ kind: 'complete' })
    const pullUrl = 'https://bitbucket.org/acme/api/pull-requests/12'
    expect(page.records[0]).toEqual({
      recordId: 'acme/api#12:1',
      data: {
        id: '1',
        title: 'acme/api#12: Fix the importer',
        repository: 'acme/api',
        number: 12,
        pullTitle: 'Fix the importer',
        pullUrl,
        author: 'grace',
        authorIsPullAuthor: false,
        kind: 'inline',
        reviewState: null,
        resolved: true,
        createdAt: Date.parse(day(2)),
        url: `${pullUrl}#comment-1`,
      },
      display: { title: 'acme/api#12: Fix the importer', url: `${pullUrl}#comment-1` },
      action: { verb: 'openUrl', url: pullUrl },
    })
    expect(page.records.map((record) => record.data)).toMatchObject([
      { kind: 'inline' },
      { kind: 'reply', author: 'ada', authorIsPullAuthor: true, resolved: true },
      { kind: 'conversation', resolved: null },
      { kind: 'inline', resolved: false },
    ])
    expect(JSON.stringify(page)).not.toContain(SECRET)
  })

  it('reads only pull requests updated in the window, then checks each comment exactly', async () => {
    const urls = stubRepository([
      makePullRequest({ id: 1, updatedOn: day(9), comments: [comment(1, 'grace', 9), comment(2, 'grace', 3)] }),
      makePullRequest({ id: 2, updatedOn: day(1) }),
    ])
    const since: DataPredicate = {
      kind: 'comparison',
      left: { address: { from: 'item', pointer: '/createdAt' } },
      operator: 'gte',
      right: { address: { from: 'literal', value: Date.parse(day(5)) } },
    }
    const page = await read(createReviewCommentSourceHandler(), {
      query: {
        source: { pluginId: 'bitbucket', sourceId: 'review-comments' },
        scope: { connectionId: 'conn-1', parameters: { repositories: ['acme/api'] } },
        sort: [],
        predicate: since,
      },
    })
    expect(page.records.map((record) => record.recordId)).toEqual([expect.stringMatching(/:1$/)])
    expect(urls()[0]!.searchParams.get('q')).toBe('updated_on >= 2026-10-05T00:00:00.000+00:00')
    expect(urls().map((url) => url.pathname)).not.toContain('/2.0/repositories/acme/api/pullrequests/2/comments')
  })

  it('reads 25 pull requests a repository, keeps their comments, and says incomplete only on the last page', async () => {
    const urls = stubRepository(
      Array.from({ length: 30 }, (_, index) =>
        makePullRequest({ id: index + 1, updatedOn: day(index + 1), comments: [comment(index + 1, 'grace', 1)] }),
      ),
    )
    const handler = createReviewCommentSourceHandler()
    const first = await read(handler, { pageSize: 20 })
    expect(first.records).toHaveLength(20)
    if (first.completeness.kind !== 'more') throw new Error('missing cursor')
    const last = await read(handler, { pageSize: 20, cursor: first.completeness.cursor })
    expect(last.records).toHaveLength(5)
    expect(last.completeness).toEqual({ kind: 'incomplete', cause: 'upstream-cap' })
    expect(urls().filter((url) => url.pathname.endsWith('/comments'))).toHaveLength(25)
  })
})
