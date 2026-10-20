import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginRequestContext, StoredConnection } from '@acorn/plugin-api/node'
import { dataSourcePageSchema } from '@acorn/protocol/dataSources.ts'
import type { DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { makeFakeGitlab, makeMergeRequest, type FakeDiscussion } from '../fakeGitlab.helper'
import { createJobSourceHandler, createMergeRequestSourceHandler, createReviewCommentSourceHandler } from './sources'

// GitLab's two read sources, over the fake: what a panel's query reads, and the job retry a row offers.
let fake: ReturnType<typeof makeFakeGitlab>
beforeEach(() => {
  fake = makeFakeGitlab([{ id: 42, path: 'group/sub/api', defaultBranch: 'main', mergeRequests: [makeMergeRequest()] }])
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
      visit: (c: StoredConnection, token: string) => Promise<T | undefined>,
    ) => {
      const value = await visit(connection, 'token')
      return value === undefined ? [] : [value]
    },
  },
} as unknown as PluginRequestContext
const scope = { connectionId: 'conn-1', parameters: { projects: ['group/sub/api'] } }
const query = (url: string, source: string) =>
  new Request(url, {
    method: 'POST',
    body: JSON.stringify({
      operation: 'query',
      query: { source: { pluginId: 'gitlab', sourceId: source }, scope, sort: [] },
      pageSize: 50,
      mode: 'execution',
      evaluationTime: Date.now(),
    }),
  })

it('reads the merge requests of the projects a panel names', async () => {
  const response = await createMergeRequestSourceHandler()(
    query('http://acorn.test/data/merge-requests', 'merge-requests'),
    context,
  )
  const page = dataSourcePageSchema.parse(await response.json())
  expect(page.records).toEqual([
    expect.objectContaining({
      recordId: 'gitlab.com/group/sub/api!12',
      data: expect.objectContaining({
        project: 'group/sub/api',
        remoteRepository: 'gitlab.com/group/sub/api',
        state: 'open',
        sourceBranch: 'fix-importer',
        gitlabConnectionId: 'conn-1',
      }),
    }),
  ])
})

it("offers Retry job on a finished job, and retries it through the record's own project", async () => {
  const handler = createJobSourceHandler()
  const page = dataSourcePageSchema.parse(
    await (await handler(query('http://acorn.test/data/jobs', 'pipeline-jobs'), context)).json(),
  )
  expect(page.records).toEqual([
    expect.objectContaining({ recordId: 'group/sub/api:501', actions: [expect.objectContaining({ id: 'retry-job' })] }),
  ])
  const retried = await handler(
    new Request('http://acorn.test/data/jobs/retry', {
      method: 'POST',
      body: JSON.stringify({
        ref: {
          pluginId: 'gitlab',
          sourceId: 'pipeline-jobs',
          connectionId: 'conn-1',
          recordId: 'group/sub/api:501',
          scope,
        },
        actionId: 'retry-job',
        idempotencyKey: crypto.randomUUID(),
      }),
    }),
    context,
  )
  expect(await retried.json()).toEqual({ outcome: 'done' })
  expect(fake.requests.at(-1)).toMatchObject({ method: 'POST', path: '/projects/group%2Fsub%2Fapi/jobs/501/retry' })
})

describe('GitLab review comments', () => {
  const SECRET = 'the secret text of a comment'
  const note = (id: number, author: string, day: number, extra = {}) => ({
    id,
    body: SECRET,
    author,
    createdAt: `2026-10-${String(day).padStart(2, '0')}T00:00:00Z`,
    ...extra,
  })
  const position = { path: 'src/app.ts', newLine: 1, headSha: 'a'.repeat(40) }
  const stubProject = (mergeRequests: ReturnType<typeof makeMergeRequest>[]) => {
    fake = makeFakeGitlab([{ id: 42, path: 'group/sub/api', defaultBranch: 'main', mergeRequests }])
    const fetch = vi.fn(fake.fetch)
    vi.stubGlobal('fetch', fetch)
    return () => fetch.mock.calls.map(([input]) => new URL(String(input)))
  }
  const read = async (handler: ReturnType<typeof createReviewCommentSourceHandler>, body: object) =>
    dataSourcePageSchema.parse(
      await (
        await handler(
          new Request('http://acorn.test/data/review-comments', {
            method: 'POST',
            body: JSON.stringify({
              operation: 'query',
              query: { source: { pluginId: 'gitlab', sourceId: 'review-comments' }, scope, sort: [] },
              pageSize: 50,
              mode: 'execution',
              evaluationTime: Date.now(),
              ...body,
            }),
          }),
          context,
        )
      ).json(),
    )

  it('reads one record per note, leaves out system notes, and keeps no comment text', async () => {
    const discussions: FakeDiscussion[] = [
      { id: 'd1', resolved: true, notes: [note(1, 'grace', 2, { position }), note(2, 'ada', 3, { position })] },
      { id: 'd2', resolved: false, notes: [note(3, 'grace', 4)] },
      { id: 'd3', resolved: false, notes: [note(4, 'ada', 5, { system: true })] },
    ]
    stubProject([makeMergeRequest({ discussions })])
    const page = await read(createReviewCommentSourceHandler(), {})
    expect(page.completeness).toEqual({ kind: 'complete' })
    const pullUrl = 'https://gitlab.com/group/sub/api/-/merge_requests/12'
    expect(page.records[0]).toEqual({
      recordId: 'gitlab.com/group/sub/api!12:1',
      data: {
        id: '1',
        title: 'group/sub/api!12: Fix the importer',
        repository: 'group/sub/api',
        number: 12,
        pullTitle: 'Fix the importer',
        pullUrl,
        author: 'grace',
        authorIsPullAuthor: false,
        kind: 'inline',
        reviewState: null,
        resolved: true,
        createdAt: Date.parse('2026-10-02T00:00:00Z'),
        url: `${pullUrl}#note_1`,
      },
      display: { title: 'group/sub/api!12: Fix the importer', url: `${pullUrl}#note_1` },
      action: { verb: 'openUrl', url: pullUrl },
    })
    expect(page.records.map((record) => record.data)).toMatchObject([
      { kind: 'inline' },
      { kind: 'reply', author: 'ada', authorIsPullAuthor: true, resolved: true },
      { kind: 'conversation', resolved: null },
    ])
    expect(JSON.stringify(page)).not.toContain(SECRET)
  })

  it('reads only merge requests updated in the window, then checks each note exactly', async () => {
    const urls = stubProject([
      makeMergeRequest({
        iid: 1,
        updatedAt: '2026-10-09T00:00:00Z',
        discussions: [{ id: 'd', resolved: false, notes: [note(1, 'grace', 9), note(2, 'grace', 3)] }],
      }),
      makeMergeRequest({ iid: 2, updatedAt: '2026-10-01T00:00:00Z' }),
    ])
    const since: DataPredicate = {
      kind: 'comparison',
      left: { address: { from: 'item', pointer: '/createdAt' } },
      operator: 'gte',
      right: { address: { from: 'literal', value: Date.parse('2026-10-05T00:00:00Z') } },
    }
    const page = await read(createReviewCommentSourceHandler(), {
      query: { source: { pluginId: 'gitlab', sourceId: 'review-comments' }, scope, sort: [], predicate: since },
    })
    expect(page.records.map((record) => record.recordId)).toEqual([expect.stringMatching(/:1$/)])
    expect(urls()[0]!.searchParams.get('updated_after')).toBe('2026-10-05T00:00:00.000Z')
    expect(urls().map((url) => url.pathname)).not.toContain(
      '/api/v4/projects/group%2Fsub%2Fapi/merge_requests/2/discussions',
    )
  })

  it('reads 25 merge requests a project, keeps their notes, and says incomplete only on the last page', async () => {
    const urls = stubProject(
      Array.from({ length: 30 }, (_, index) =>
        makeMergeRequest({
          iid: index + 1,
          updatedAt: `2026-10-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
          discussions: [{ id: 'd', resolved: false, notes: [note(index + 1, 'grace', 1)] }],
        }),
      ),
    )
    const handler = createReviewCommentSourceHandler()
    const first = await read(handler, { pageSize: 20 })
    expect(first.records).toHaveLength(20)
    if (first.completeness.kind !== 'more') throw new Error('missing cursor')
    const last = await read(handler, { pageSize: 20, cursor: first.completeness.cursor })
    expect(last.records).toHaveLength(5)
    expect(last.completeness).toEqual({ kind: 'incomplete', cause: 'upstream-cap' })
    expect(urls().filter((url) => url.pathname.endsWith('/discussions'))).toHaveLength(25)
  })
})
