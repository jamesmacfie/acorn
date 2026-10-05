import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { dataSourceRequestSchema, type DataSourceRegistration, type DataSourceScope } from '@acorn/protocol/dataSources.ts'
import { schema } from '../db'
import { memoryIdentityStore } from '../activeIdentity'
import { createCoreServices, SecretService } from '../core'
import { makeTestDb, testEnv } from '../../testkit/db'
import { publicConnectionProvider, defaultBudgets } from '../integrations/providerShared'
import { CapabilityRegistry } from '../pluginHost/capabilities'
import { clearRegistrations, initPlugins } from '../pluginHost/host'
import type { NodePlugin, NodePluginContext, PluginFetchHandler } from '../pluginHost/types'
import { pluginManifestSchema } from '../plugins/manifest'
import { inputGrantsStore } from '../plugins/inputGrants'
import { invokeDataSource } from './runtime'

// A derived source end to end: an upstream provider source, a derived source that reads it through
// its request context's `inputs`, and a loaded copy that needs the person's grant.
const fixture = pluginManifestSchema.parse(JSON.parse(readFileSync(fileURLToPath(
  new URL('../../../../../apps/node/test/__fixtures__/typed-source/acorn-plugin.json', import.meta.url)), 'utf8')))
const plugins = ['upstream-test', 'derived-test', 'derived-loaded', 'chain-test']
const cleanups: (() => void)[] = []
afterEach(() => { for (const id of plugins) clearRegistrations(id); for (const cleanup of cleanups.splice(0)) cleanup() })

const description = (revision: string) => ({
  schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
  fields: [], parameters: { type: 'object' }, parameterFields: [], revision, consistency: 'Live',
  operations: { query: true, options: false, details: false, incremental: false, groups: [] },
})
const page = (records: { recordId: string; data: unknown }[], revision: string, completeness: unknown = { kind: 'complete' }) =>
  Response.json({ records, revision, readTime: 1, completeness })
const derivedSource = (pluginId: string, inputs: DataSourceRegistration['inputs']): DataSourceRegistration => ({
  sourceId: 'derived', name: 'Derived', singular: 'Row', plural: 'Rows', identityScope: 'Upstream ID',
  handler: `/v1/p/${pluginId}/derived`, inputs,
})

/** Reads its one input and copies the records, optionally adding one that breaks its schema. */
const copyInput = (options: { bad?: boolean; seen?: string[][] } = {}): PluginFetchHandler => async (request, context) => {
  const input = dataSourceRequestSchema.parse(await request.json())
  if (input.operation === 'describe') return Response.json(description('own-1'))
  options.seen?.push(Object.keys(context.inputs ?? {}))
  const upstream = await context.inputs!.records!.query()
  return page([...upstream.records.map(record => ({ recordId: record.ref.recordId, data: record.data })),
    ...(options.bad ? [{ recordId: 'bad', data: { nope: 1 } }] : [])], 'own-1')
}

async function world(options: { derived?: PluginFetchHandler; loaded?: PluginFetchHandler; chain?: PluginFetchHandler; chainSources?: DataSourceRegistration[] } = {}) {
  const db = makeTestDb()
  const dataDir = mkdtempSync(join(tmpdir(), 'acorn-inputs-'))
  cleanups.push(() => { db.cleanup(); rmSync(dataDir, { recursive: true, force: true }) })
  const secrets = new SecretService('c'.repeat(64))
  const identity = memoryIdentityStore('owner')
  const env = testEnv({ DB: db.db, ACTIVE_IDENTITY: identity, SECRETS: secrets, DATA_DIR: dataDir })
  const upstream = { revision: 'up-1', completeness: { kind: 'complete' } as unknown }
  const provider = publicConnectionProvider({
    id: 'source-tracker', label: 'Tracker', glyph: 'T', kind: 'generic', capabilities: {}, budgets: defaultBudgets,
    connection: {
      authKind: 'api-key', fields: [], connectable: true, disconnectable: true,
      async validate() { return 'secret' },
      normalize(_credentials, secret) { return { secret, label: 'Tracker', account: null, scopes: [], config: {}, capabilities: {} } },
      async test() { return { ok: true as const } },
    },
  })
  let loadedContext: NodePluginContext | undefined
  const list: NodePlugin[] = [
    { name: 'upstream-test', init(ctx) {
      ctx.providers.connection(provider)
      ctx.dataSources.register({ sourceId: 'records', name: 'Records', singular: 'Record', plural: 'Records',
        identityScope: 'Connection and ID', handler: '/v1/p/upstream-test/records', providerId: provider.id })
      ctx.routes.fetch(async (request) => {
        const input = dataSourceRequestSchema.parse(await request.json())
        if (input.operation === 'describe') return Response.json(description(upstream.revision))
        return page([{ recordId: '1', data: { id: '1' } }, { recordId: '2', data: { id: '2' } }], upstream.revision, upstream.completeness)
      }, { prefix: '/records' })
    } },
    { name: 'derived-test', init(ctx) {
      ctx.dataSources.register(derivedSource('derived-test', {
        records: { source: 'upstream-test:records', label: 'Records' },
        extra: { source: 'upstream-test:records', label: 'More records', optional: true },
      }))
      ctx.routes.fetch(options.derived ?? copyInput(), { prefix: '/derived' })
    } },
    { name: 'derived-loaded', init(ctx) {
      loadedContext = ctx
      ctx.routes.fetch(options.loaded ?? copyInput(), { prefix: '/derived' })
    } },
    { name: 'chain-test', init(ctx) {
      for (const source of options.chainSources ?? []) ctx.dataSources.register(source)
      if (options.chain) ctx.routes.fetch(options.chain, { prefix: '' })
    } },
  ]
  const loadedBinding = { permissions: fixture.permissions.node, storage: { open: () => { throw new Error('No database') } },
    dataSources: [derivedSource('derived-loaded', { records: { source: 'upstream-test:records', label: 'Records' } })] }
  await initPlugins(list, { env, dataDir: '', capabilities: new CapabilityRegistry(),
    core: createCoreServices({ db: db.db, secrets, activeIdentity: identity }),
    loaded: new Map([['derived-loaded', loadedBinding]]) })
  for (const [id, providerId, status] of [['selected', provider.id, 'connected'], ['off', provider.id, 'disabled'], ['foreign', 'another', 'connected']] as const) {
    await db.db.insert(schema.integrations).values({ id, userId: 'owner', provider: providerId, label: 'Tracker',
      encryptedCredentials: await secrets.seal(`${id}-token`), authKind: 'api-key', status, createdAt: 1, updatedAt: 1 })
  }
  return { env, upstream, loadedContext: () => loadedContext! }
}

const invocation = () => ({ principal: { kind: 'internal' as const, scope: 'service' as const, userId: 'owner' }, signal: new AbortController().signal })
const bound = (connectionId?: string): DataSourceScope => ({ parameters: {}, inputs: { records: { ...(connectionId ? { connectionId } : {}), parameters: {} } } })
const query = (pluginId: string, scope: DataSourceScope, sourceId = 'derived') => ({ operation: 'query' as const,
  query: { source: { pluginId, sourceId }, scope, sort: [] }, mode: 'execution' as const, pageSize: 25, evaluationTime: 1 })
const describeSource = (pluginId: string, scope: DataSourceScope) => ({ operation: 'describe' as const, source: { pluginId, sourceId: 'derived' }, scope })

it('checks each binding as a direct call would, and describes without any', async () => {
  const { env } = await world()
  const refused = (scope: DataSourceScope) => invokeDataSource(env, query('derived-test', scope), invocation())
  await expect(refused({ parameters: {} })).rejects.toMatchObject({ code: 'input-required', detail: { input: 'records' } })
  await expect(refused(bound())).rejects.toMatchObject({ code: 'input-required', detail: { input: 'records' } })
  for (const id of ['foreign', 'off', 'missing']) await expect(refused(bound(id))).rejects.toMatchObject({ code: 'input-unavailable', detail: { input: 'records' } })
  await expect(refused({ ...bound('selected'), inputs: { ...bound('selected').inputs, stray: { parameters: {} } } })).rejects.toMatchObject({ code: 'invalid-request', detail: { input: 'stray' } })
  await expect(refused({ ...bound('selected'), connectionId: 'selected' })).rejects.toMatchObject({ code: 'invalid-request' })
  // A source without inputs takes no bindings either.
  await expect(invokeDataSource(env, query('upstream-test', { connectionId: 'selected', ...bound('selected') }, 'records'), invocation()))
    .rejects.toMatchObject({ code: 'invalid-request' })
  expect((await invokeDataSource(env, describeSource('derived-test', { parameters: {} }), invocation())).revision).toMatch(/^derived\./)
})

it('reads bound inputs through the request context and composes the revision', async () => {
  const seen: string[][] = []
  const { env, upstream } = await world({ derived: copyInput({ seen }) })
  const result = await invokeDataSource(env, query('derived-test', bound('selected')), invocation())
  expect(result.records.map(record => record.ref.recordId)).toEqual(['1', '2'])
  expect(result.completeness).toEqual({ kind: 'complete' })
  // The optional input wasn't bound, so it has no handle.
  expect(seen).toEqual([['records']])
  const before = (await invokeDataSource(env, describeSource('derived-test', bound('selected')), invocation())).revision
  expect(result.revision).toBe(before)
  upstream.revision = 'up-2'
  expect((await invokeDataSource(env, describeSource('derived-test', bound('selected')), invocation())).revision).not.toBe(before)
})

it('marks the page incomplete for an incomplete input, and drops invalid records with a count', async () => {
  const incomplete = await world()
  incomplete.upstream.completeness = { kind: 'incomplete', cause: 'upstream-cap' }
  expect((await invokeDataSource(incomplete.env, query('derived-test', bound('selected')), invocation())).completeness)
    .toEqual({ kind: 'incomplete', cause: 'upstream-cap' })
  for (const id of plugins) clearRegistrations(id)

  const { env } = await world({ derived: copyInput({ bad: true }) })
  const result = await invokeDataSource(env, query('derived-test', bound('selected')), invocation())
  expect(result.records.map(record => record.ref.recordId)).toEqual(['1', '2'])
  expect(result.completeness).toEqual({ kind: 'incomplete', cause: 'invalid-records', count: 1 })
})

it('refuses inputs that loop or nest more than two derived sources deep', async () => {
  const chained = (sourceId: string, next: string): DataSourceRegistration => ({ sourceId, name: sourceId, singular: 'Row', plural: 'Rows',
    identityScope: 'ID', handler: `/v1/p/chain-test/${sourceId}`, inputs: { next: { source: next, label: 'Next' } } })
  // One scope binds the whole chain: a's input, and through it b's.
  const scope: DataSourceScope = { parameters: {}, inputs: { next: { parameters: {}, inputs: { next: { parameters: {} } } } } }
  const chain: PluginFetchHandler = async (request, context) => {
    const input = dataSourceRequestSchema.parse(await request.json())
    if (input.operation === 'describe') return Response.json(description('own-1'))
    const upstream = await context.inputs!.next!.query()
    return page(upstream.records.map(record => ({ recordId: record.ref.recordId, data: record.data })), 'own-1')
  }
  const loop = await world({ chain, chainSources: [chained('a', 'chain-test:b'), chained('b', 'chain-test:a')] })
  await expect(invokeDataSource(loop.env, query('chain-test', scope, 'a'), invocation()))
    .rejects.toMatchObject({ code: 'invalid-request', detail: { reason: 'Inputs form a loop' } })
  for (const id of plugins) clearRegistrations(id)

  const deep = await world({ chain, chainSources: [chained('a', 'chain-test:b'), chained('b', 'chain-test:c'), chained('c', 'derived-test:derived')] })
  await expect(invokeDataSource(deep.env, query('chain-test', scope, 'a'), invocation()))
    .rejects.toMatchObject({ code: 'invalid-request', detail: { reason: 'Inputs nest more than 2 derived sources deep' } })
})

it('lets a loaded plugin read only the inputs its grant covers, and never invoke another plugin directly', async () => {
  const { env, loadedContext } = await world()
  await expect(invokeDataSource(env, query('derived-loaded', bound('selected')), invocation()))
    .rejects.toMatchObject({ code: 'input-unavailable', detail: { input: 'records', reason: 'Not approved' } })
  const grant = { pluginId: 'derived-loaded', grantedAt: 1, grantedBy: 'owner' }
  inputGrantsStore(env.DATA_DIR).set({ ...grant, sources: { derived: { records: { source: 'upstream-test:records', optional: true } } } })
  await expect(invokeDataSource(env, query('derived-loaded', bound('selected')), invocation()))
    .rejects.toMatchObject({ code: 'input-unavailable', detail: { reason: 'Not approved' } })
  inputGrantsStore(env.DATA_DIR).set({ ...grant, sources: { derived: { records: { source: 'upstream-test:records', optional: false } } } })
  expect((await invokeDataSource(env, query('derived-loaded', bound('selected')), invocation())).records).toHaveLength(2)
  expect(() => loadedContext().dataSources.invoke(query('upstream-test', { connectionId: 'selected', parameters: {} }, 'records'), invocation()))
    .toThrow('Source belongs to another plugin')
})
