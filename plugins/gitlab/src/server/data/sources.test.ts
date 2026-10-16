import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { PluginRequestContext, StoredConnection } from '@acorn/plugin-api/node'
import { dataSourcePageSchema } from '@acorn/protocol/dataSources.ts'
import { makeFakeGitlab, makeMergeRequest } from '../fakeGitlab.helper'
import { createJobSourceHandler, createMergeRequestSourceHandler } from './sources'

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
      recordId: 'group/sub/api!12',
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
