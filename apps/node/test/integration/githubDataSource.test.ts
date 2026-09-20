import { afterEach, expect, it, vi } from 'vitest'
import { createPullSourceHandler, pullSource, githubProvider } from '@acorn/plugin-github/testkit'
import { memoryIdentityStore } from '@acorn/node-core/server/activeIdentity.ts'
import { createCoreServices } from '@acorn/node-core/server/core/index.ts'
import { schema } from '@acorn/node-core/server/db/index.ts'
import { CapabilityRegistry } from '@acorn/node-core/server/pluginHost/capabilities.ts'
import { clearRegistrations, initPlugins } from '@acorn/node-core/server/pluginHost/host.ts'
import { invokeDataSource } from '@acorn/node-core/server/dataSources/runtime.ts'
import { makeTestDb, testEnv } from '@acorn/node-core/testkit/db.ts'

afterEach(() => { clearRegistrations('github'); vi.unstubAllGlobals() })

it('executes the GitHub source with exact connection provenance and a stable bounded take', async () => {
  const db = makeTestDb()
  const identity = memoryIdentityStore('owner')
  const env = testEnv({ DB: db.db, ACTIVE_IDENTITY: identity, SECRETS: db.secrets })
  try {
    await initPlugins([{ name: 'github', init(ctx) {
      ctx.providers.integration(githubProvider)
      ctx.routes.fetch(createPullSourceHandler(), { prefix: '/data/pulls' })
      ctx.dataSources.register(pullSource)
    } }], { env, dataDir: '', capabilities: new CapabilityRegistry(), core: createCoreServices({ db: db.db, secrets: db.secrets, activeIdentity: identity }) })
    await db.db.insert(schema.integrations).values({ id: 'selected', userId: 'owner', provider: 'github', label: 'GitHub',
      authRef: await db.secrets.seal('selected-token'), authKind: 'oauth', status: 'connected', createdAt: 1, updatedAt: 1 })
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.headers).toMatchObject({ Authorization: 'Bearer selected-token' })
      return Response.json({ data: { search: { issueCount: 3, pageInfo: { hasNextPage: false, endCursor: null },
        nodes: ['z', 'b', 'a'].map(id => ({ id, number: 1, title: 'Change', url: 'https://github.com/org/repo/pull/1',
          state: 'OPEN', isDraft: true, author: { login: 'alice' }, repository: { nameWithOwner: 'org/repo' },
          createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z', closedAt: null, mergedAt: null,
          mergeable: 'UNKNOWN', mergeStateStatus: 'UNSTABLE', autoMergeRequest: null })),
      } } })
    })
    vi.stubGlobal('fetch', fetch)
    const result = await invokeDataSource(env, {
      operation: 'query', mode: 'execution', evaluationTime: 1, pageSize: 1,
      query: { source: { pluginId: 'github', sourceId: 'pull-requests' }, scope: { connectionId: 'selected', parameters: { repository: 'org/repo' } },
        sort: [{ pointer: '/updatedAt', direction: 'desc' }], take: 2 },
    }, { principal: { kind: 'internal', scope: 'service', userId: 'owner' }, signal: new AbortController().signal })
    expect(result.completeness).toEqual({ kind: 'bounded' })
    expect(result.records.map(record => record.ref)).toEqual(['a', 'b'].map(recordId => ({ pluginId: 'github', sourceId: 'pull-requests', connectionId: 'selected', recordId, scope: { connectionId: 'selected', parameters: { repository: 'org/repo' } } })))
    expect(fetch).toHaveBeenCalledTimes(1)
    const previewRequest = {
      operation: 'query' as const, mode: 'preview' as const, evaluationTime: 2, pageSize: 1,
      query: { source: { pluginId: 'github', sourceId: 'pull-requests' }, scope: { connectionId: 'selected', parameters: { repository: 'org/repo' } },
        sort: [{ pointer: '/updatedAt', direction: 'desc' as const }], take: 2 },
    }
    const invocation = { principal: { kind: 'internal' as const, scope: 'service' as const, userId: 'owner' }, signal: new AbortController().signal }
    const first = await invokeDataSource(env, previewRequest, invocation)
    if (first.completeness.kind !== 'more') throw new Error('missing cursor')
    const last = await invokeDataSource(env, { ...previewRequest, cursor: first.completeness.cursor }, invocation)
    expect(last.mode).toBe('preview')
    expect(last.records.map(record => record.ref.recordId)).toEqual(['b'])
    expect(last.completeness.kind).toBe('bounded')
  } finally { db.cleanup() }
})
