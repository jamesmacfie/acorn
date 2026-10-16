import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { PluginRequestContext, StoredConnection } from '@acorn/plugin-api/node'
import { dataSourcePageSchema } from '@acorn/protocol/dataSources.ts'
import { FAKE_AUTH, makeFakeBitbucket, makePullRequest } from '../fakeBitbucket.helper'
import { createPullRequestSourceHandler, createStepSourceHandler } from './sources'

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
