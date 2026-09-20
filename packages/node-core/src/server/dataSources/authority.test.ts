import { afterEach, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { schema } from '../db'
import { memoryIdentityStore } from '../activeIdentity'
import { createCoreServices, SecretService } from '../core'
import { makeTestDb, testEnv } from '../../testkit/db'
import { publicConnectionProvider, defaultBudgets } from '../integrations/providerShared'
import { CapabilityRegistry } from '../pluginHost/capabilities'
import { clearRegistrations, initPlugins } from '../pluginHost/host'
import { invokeDataSource } from './runtime'
import { dataSourceRequestSchema } from '@acorn/protocol/dataSources.ts'

const pluginId = 'source-provider-test'
afterEach(() => clearRegistrations(pluginId))

it('binds provider callbacks to exactly one owned connection and refuses deletion, revocation and foreign ownership', async () => {
  const db = makeTestDb()
  const secrets = new SecretService('c'.repeat(64))
  const identity = memoryIdentityStore('owner')
  const env = testEnv({ DB: db.db, ACTIVE_IDENTITY: identity, SECRETS: secrets })
  const visited: string[] = []
  const provider = publicConnectionProvider({
    id: 'source-tracker', label: 'Tracker', glyph: 'T', kind: 'generic', capabilities: {}, budgets: defaultBudgets,
    connection: {
      authKind: 'api-key', fields: [], connectable: true, disconnectable: true,
      async validate() { return 'secret' },
      normalize(_credentials, secret) { return { secret, label: 'Tracker', account: null, scopes: [], config: {}, capabilities: {} } },
      async test() { return { ok: true as const } },
    },
  })
  try {
    await initPlugins([{
      name: pluginId,
      init(ctx) {
        ctx.providers.connection(provider)
        ctx.dataSources.register({ sourceId: 'records', name: 'Records', singular: 'Record', plural: 'Records', identityScope: 'Connection and ID', handler: `/v2/p/${pluginId}/source`, providerId: provider.id })
        ctx.routes.fetch(async (request, context) => {
          const input = dataSourceRequestSchema.parse(await request.json())
          if (input.operation === 'describe') return Response.json({ schema: { type: 'string' }, fields: [], parameters: { type: 'object' }, parameterFields: [], operations: { query: true, options: false, details: false, incremental: false, groups: [] }, revision: '1', consistency: 'Live' })
          expect((await context.providers.connections(provider.id)).map(connection => connection.id)).toEqual(['selected'])
          await context.providers.withConnections(provider.id, async (connection, secret) => { visited.push(connection.id); expect(secret).toBe('selected-token'); return true })
          await expect(context.providers.connections('foreign-provider')).rejects.toThrow()
          return Response.json({ records: [{ recordId: '1', data: 'ok' }], revision: '1', readTime: 1, completeness: { kind: 'complete' } })
        }, { prefix: '/source' })
      },
    }], { env, dataDir: '', capabilities: new CapabilityRegistry(), core: createCoreServices({ db: db.db, secrets, activeIdentity: identity }) })
    for (const [id, userId, providerId] of [['selected', 'owner', provider.id], ['other', 'owner', provider.id], ['foreign-user', 'stranger', provider.id], ['foreign-provider', 'owner', 'another']]) {
      await db.db.insert(schema.integrations).values({ id: id!, userId: userId!, provider: providerId!, label: 'Tracker', authRef: await secrets.seal(`${id}-token`), authKind: 'api-key', status: 'connected', createdAt: 1, updatedAt: 1 })
    }
    const request = (connectionId?: string) => ({ operation: 'query' as const, query: { source: { pluginId, sourceId: 'records' }, scope: { parameters: {}, connectionId }, sort: [] }, mode: 'execution' as const, pageSize: 25, evaluationTime: 1 })
    const invocation = { principal: { kind: 'internal' as const, scope: 'service' as const, userId: 'owner' }, signal: new AbortController().signal }
    expect((await invokeDataSource(env, request('selected'), invocation)).records[0]?.ref.connectionId).toBe('selected')
    expect(visited).toEqual(['selected'])
    await expect(invokeDataSource(env, request(), invocation)).rejects.toMatchObject({ code: 'connection-required' })
    for (const id of ['foreign-user', 'foreign-provider']) await expect(invokeDataSource(env, request(id), invocation)).rejects.toMatchObject({ code: 'forbidden' })
    await db.db.update(schema.integrations).set({ status: 'disabled' }).where(eq(schema.integrations.id, 'selected'))
    await expect(invokeDataSource(env, request('selected'), invocation)).rejects.toMatchObject({ code: 'forbidden' })
    await db.db.delete(schema.integrations).where(eq(schema.integrations.id, 'selected'))
    await expect(invokeDataSource(env, request('selected'), invocation)).rejects.toMatchObject({ code: 'forbidden' })
  } finally { db.cleanup() }
})
