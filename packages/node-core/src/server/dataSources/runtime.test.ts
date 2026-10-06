import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import { dataSourceRequestSchema, type DataSourceRequest } from '@acorn/protocol/dataSources.ts'
import { memoryIdentityStore } from '../activeIdentity'
import { createCoreServices, SecretService } from '../core'
import { makeTestDb, testEnv } from '../../testkit/db'
import { CapabilityRegistry } from '../pluginHost/capabilities'
import { clearRegistrations, initPlugins } from '../pluginHost/host'
import type { NodePlugin, PluginFetchHandler, PluginStorage } from '../pluginHost/types'
import { pluginManifestSchema } from '../plugins/manifest'
import type { AppEnv } from '../middleware/auth'
import { dataSources } from '../routes/dataSources'
import { actOnDataRecord, discoverDataSources, invokeDataSource, listDataSources } from './runtime'

const directory = new URL('../../../../../apps/node/test/__fixtures__/typed-source/', import.meta.url)
const fixtureModule: { fetchSource: PluginFetchHandler } = await import(new URL('node.mjs', directory).href)
const manifest = pluginManifestSchema.parse(JSON.parse(readFileSync(fileURLToPath(new URL('acorn-plugin.json', directory)), 'utf8')))
const pluginId = manifest.id
const source = { pluginId, sourceId: 'records' }
const storage: PluginStorage = { open: () => { throw new Error('No fixture database') } }
const invocation = () => ({ principal: { kind: 'internal' as const, scope: 'service' as const, userId: 'owner' }, signal: new AbortController().signal })
const query = (mode?: string): Extract<DataSourceRequest, { operation: 'query' }> => ({
  operation: 'query', query: { source, scope: { parameters: { project: 'a', ...(mode ? { mode } : {}) } }, sort: [] }, mode: 'execution', pageSize: 25, evaluationTime: 123,
})

const worlds: ReturnType<typeof makeTestDb>[] = []
afterEach(() => { clearRegistrations(pluginId); for (const world of worlds.splice(0)) world.cleanup() })
async function world(loaded = true, handler = fixtureModule.fetchSource) {
  const db = makeTestDb()
  worlds.push(db)
  const identity = memoryIdentityStore('owner')
  const env = testEnv({ DB: db.db, ACTIVE_IDENTITY: identity })
  const binding = { permissions: manifest.permissions.node, storage, dataSources: manifest.contributions.dataSources, dataSourceDiscoveries: manifest.contributions.dataSourceDiscoveries }
  const plugin: NodePlugin = {
    name: pluginId,
    init(ctx) {
      ctx.routes.fetch(handler, { prefix: '/source' })
      if (!loaded) {
        for (const source of binding.dataSources ?? []) ctx.dataSources.register(source)
        for (const discovery of binding.dataSourceDiscoveries ?? []) ctx.dataSources.discover(discovery)
      }
    },
  }
  const host = await initPlugins([plugin], {
    env, dataDir: '', capabilities: new CapabilityRegistry(),
    core: createCoreServices({ db: db.db, activeIdentity: identity, secrets: new SecretService('c'.repeat(64)) }),
    ...(loaded ? { loaded: new Map([[pluginId, binding]]) } : {}),
  })
  const app = new Hono<AppEnv>().use('*', async (c, next) => { c.set('principal', invocation().principal); await next() }).route('/v1/core/data-sources', dataSources)
  return { env, host, binding, plugin, app }
}

describe('typed source transport conformance', () => {
  it('checks a field move against fresh source metadata, current value, and the confined route', async () => {
    let current = 'open'
    let writable = true
    let eligible = true
    let writes = 0
    let changeBeforeDispatch = false
    const handler: PluginFetchHandler = async (request, context) => {
      const body = await request.json() as { operation?: string; field?: string; expected?: string; target?: string }
      if (new URL(request.url).pathname.endsWith('/write')) {
        writes++
        if (changeBeforeDispatch) { current = 'closed'; changeBeforeDispatch = false }
        if (current !== body.expected) return Response.json({ outcome: 'stale' })
        current = body.target!
        return Response.json({ outcome: 'done' })
      }
      if (body.operation === 'describe') {
        const base = await fixtureModule.fetchSource(new Request(request.url, { method: 'POST', body: JSON.stringify(body) }), context)
        return Response.json({ ...await base.json() as object,
          detailSchema: { type: 'object', properties: { state: { type: 'string' } }, required: ['state'], additionalProperties: false },
          writable: writable ? [{ field: '/state', path: `/v1/p/${pluginId}/source/write`, risk: 'write', values: ['open', 'closed'] }] : [] })
      }
      if (body.operation === 'details') return Response.json({ kind: 'found', data: { state: current }, fetchedTime: Date.now(), writableFields: eligible ? ['/state'] : [] })
      return fixtureModule.fetchSource(new Request(request.url, { method: 'POST', body: JSON.stringify(body) }), context)
    }
    const { env } = await world(false, handler)
    const ref = { ...source, recordId: 'sample-1', scope: { parameters: {} } }
    const key = '11111111-2222-4333-8444-555555555555'
    const move = { ref, field: '/state', expected: 'open', target: 'closed', confirmedRisk: 'write' }
    const device = { ...invocation(), principal: { kind: 'device' as const, userId: 'owner', deviceId: 'device' } }
    await expect(actOnDataRecord(env, move, key, invocation())).rejects.toMatchObject({ code: 'forbidden' })
    expect(await actOnDataRecord(env, move, key, device)).toEqual({ outcome: 'done' })
    expect(current).toBe('closed')
    expect(await actOnDataRecord(env, move, key, device)).toEqual({ outcome: 'stale' })
    expect(writes).toBe(1)
    expect(await actOnDataRecord(env, { ...move, expected: 'closed', target: 'open' }, key, device)).toEqual({ outcome: 'done' })
    expect(current).toBe('open')
    eligible = false
    expect(await actOnDataRecord(env, { ...move, target: 'closed' }, key, device)).toEqual({ outcome: 'not-writable' })
    eligible = true
    writable = false
    expect(await actOnDataRecord(env, { ...move, target: 'closed' }, key, device)).toEqual({ outcome: 'not-writable' })
    expect(writes).toBe(2)
    writable = true
    changeBeforeDispatch = true
    expect(await actOnDataRecord(env, move, key, device)).toEqual({ outcome: 'stale' })
    expect(writes).toBe(3)
    await expect(actOnDataRecord(env, { ...move, ref: { ...ref, connectionId: 'foreign' } }, key, device))
      .rejects.toMatchObject({ code: 'invalid-request' })
  })
  it('re-reads named actions and refuses one that stopped applying before dispatch', async () => {
    let eligible = true
    let calls = 0
    const handler: PluginFetchHandler = async (request, context) => {
      const body = await request.json() as { operation?: string; actionId?: string }
      if (body.operation === 'describe') {
        const base = await fixtureModule.fetchSource(new Request(request.url, { method: 'POST', body: JSON.stringify(body) }), context)
        return Response.json({ ...await base.json() as object, actions: [{ id: 'retry', label: 'Retry', risk: 'execute' }] })
      }
      if (body.operation === 'actions') return Response.json({ actions: eligible ? [{ id: 'retry', label: 'Retry', risk: 'execute', action: { verb: 'runNodeAction', path: `/v1/p/${pluginId}/source` } }] : [] })
      if (body.actionId === 'retry') { calls++; return Response.json({ ok: true }) }
      return fixtureModule.fetchSource(new Request(request.url, { method: 'POST', body: JSON.stringify(body) }), context)
    }
    const { env } = await world(false, handler)
    const ref = { ...source, recordId: 'sample-1', scope: { parameters: {} } }
    const key = '11111111-2222-4333-8444-555555555555'
    eligible = false
    expect(await actOnDataRecord(env, { ref, actionId: 'retry', confirmedRisk: 'execute' }, key, invocation())).toEqual({ outcome: 'no-longer-available' })
    expect(calls).toBe(0)
    eligible = true
    expect(await actOnDataRecord(env, { ref, actionId: 'retry', confirmedRisk: 'execute' }, key, invocation())).toEqual({ outcome: 'done' })
    expect(calls).toBe(1)
  })
  it('uses source-declared baseline and opaque continuation, not page cursors', async () => {
    const { env } = await world()
    const request = query()
    request.query.incremental = { kind: 'baseline' }
    const baseline = await invokeDataSource(env, request, invocation())
    expect(baseline).toMatchObject({ records: [{ ref: { recordId: 'sample-1' } }, { ref: { recordId: 'sample-2' } }], incrementalBoundary: '2' })
    request.query.incremental = { kind: 'continue', boundary: baseline.incrementalBoundary! }
    expect(await invokeDataSource(env, request, invocation())).toMatchObject({ records: [{ ref: { recordId: 'sample-3' } }], incrementalBoundary: '3' })
    request.query.incremental.boundary = '3'
    expect(await invokeDataSource(env, request, invocation())).toMatchObject({ records: [], incrementalBoundary: '3' })
    request.query.incremental.boundary = 'expired'
    await expect(invokeDataSource(env, request, invocation())).rejects.toMatchObject({ code: 'provider-failure' })
    request.query.take = 1
    request.query.sort = [{ pointer: '/state', direction: 'asc' }]
    await expect(invokeDataSource(env, request, invocation())).rejects.toMatchObject({ code: 'invalid-request' })
  })
  it('produces equivalent nested records from compiled and manifest registration', async () => {
    const loaded = await world()
    const first = await invokeDataSource(loaded.env, query(), invocation())
    clearRegistrations(pluginId)
    const compiled = await world(false)
    const second = await invokeDataSource(compiled.env, query(), invocation())
    expect(second).toEqual(first)
    expect(first.records).toHaveLength(2)
    expect(first.records[0]?.data).toMatchObject({ owner: null, labels: [{ id: 'a' }], extra: { score: 3 } })
    expect(first.records[0]?.ref).toEqual({ ...source, recordId: 'sample-1', scope: query().query.scope })
    expect(first.completeness).toEqual({ kind: 'complete' })
    expect(first.evaluationTime).toBe(123)
  })

  it('lists, describes, queries, provides options and details through core POST routes', async () => {
    const { env, app } = await world()
    const post = async (operation: string, body: unknown) => {
      const response = await app.request(`/v1/core/data-sources/${operation}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, env)
      expect(response.status).toBe(200)
      return response.json()
    }
    expect(await post('list', { parameters: {} })).toMatchObject({ sources: [{ sourceId: 'records' }] })
    expect(JSON.stringify(await post('list', { parameters: {} }))).not.toContain('/v1/p/')
    expect(await post('describe', { operation: 'describe', source, scope: { parameters: {} } })).toMatchObject({ revision: '1' })
    expect(await post('options', { operation: 'options', source, scope: { parameters: { project: 'a' } }, target: 'field', pointer: '/state' })).toMatchObject({ options: [{ id: 'open' }, { id: 'closed' }], exhausted: true })
    expect(await post('query', query())).toMatchObject({ completeness: { kind: 'complete' } })
    expect(await post('details', { operation: 'details', ref: { ...source, recordId: 'missing' }, scope: { parameters: {} } })).toEqual({ kind: 'not-found' })
    expect(await post('details', { operation: 'details', ref: { ...source, recordId: 'sample-1' }, scope: { parameters: {} } })).toMatchObject({ kind: 'found', data: { body: 'Nested record details' } })
  })

  it('confines discovery to its owner and originating scope', async () => {
    const { env } = await world()
    const scope = { parameters: { project: 'a' } }
    expect(await discoverDataSources(env, { pluginId, discoveryId: 'dynamic', scope }, invocation())).toMatchObject({ sources: [{ pluginId, sourceId: 'discovered' }] })
    const request = query()
    request.query.source = { pluginId, sourceId: 'discovered' }
    const records = (await invokeDataSource(env, request, invocation())).records
    expect(records).toHaveLength(2)
    const ref = records[0].ref
    expect(await invokeDataSource(env, { operation: 'details', ref, scope: ref.scope!, projection: [] }, invocation())).toMatchObject({ kind: 'found', schema: { type: 'object' } })
    request.query.scope.parameters.project = 'b'
    await expect(invokeDataSource(env, request, invocation())).rejects.toMatchObject({ code: 'unavailable' })
    expect((await listDataSources(env, request.query.scope, invocation())).sources.map(item => item.sourceId)).toEqual(['records'])
  })

  it('removes old registrations on reload and disable', async () => {
    const { env, host, binding, plugin } = await world()
    expect(await host.reload(pluginId, { plugin, binding: { ...binding, dataSources: [] } })).toEqual({ ok: true })
    await expect(invokeDataSource(env, query(), invocation())).rejects.toMatchObject({ code: 'unavailable' })
    expect(await host.reload(pluginId, { plugin, binding })).toEqual({ ok: true })
    expect((await invokeDataSource(env, query(), invocation())).records).toHaveLength(2)
    clearRegistrations(pluginId)
    await expect(invokeDataSource(env, query(), invocation())).rejects.toMatchObject({ code: 'unavailable' })
  })

  it.each([['forged', 'invalid-response'], ['malformed', 'invalid-response'], ['duplicate', 'duplicate-record'], ['loop', 'cursor-loop'], ['oversize', 'oversize'], ['error', 'provider-failure']])('refuses %s responses', async (mode, code) => {
    const { env } = await world()
    await expect(invokeDataSource(env, query(mode), invocation())).rejects.toMatchObject({ code })
  })

  it("keeps a failed source's own reason, and nothing else from its reply", async () => {
    const { env } = await world()
    const failed = await invokeDataSource(env, query('reason'), invocation()).catch((error: unknown) => error)
    expect(failed).toMatchObject({ code: 'provider-failure', detail: { reason: 'The project was archived.' } })
    expect(JSON.stringify(failed)).not.toContain('provider text')
    await expect(invokeDataSource(env, query('error'), invocation())).rejects.toMatchObject({ code: 'provider-failure', detail: undefined })
  })

  it('keeps preview and incomplete results nondispatchable', async () => {
    const { env } = await world()
    expect(await invokeDataSource(env, { ...query(), mode: 'preview' }, invocation())).toMatchObject({ mode: 'preview', completeness: { kind: 'more' }, records: [{ ref: { recordId: 'sample-1' } }] })
    expect(await invokeDataSource(env, query('incomplete'), invocation())).toMatchObject({ completeness: { kind: 'incomplete', cause: 'upstream-cap' } })
  })

  it('rejects task authority, unknown workspace and wrong connection', async () => {
    const { env } = await world()
    await expect(invokeDataSource(env, query(), { ...invocation(), principal: { kind: 'internal', userId: 'owner', scope: 'task', taskId: 'task-a' } })).rejects.toMatchObject({ code: 'forbidden' })
    const request = query()
    request.query.scope.workspaceId = 'unknown'
    await expect(invokeDataSource(env, request, invocation())).rejects.toMatchObject({ code: 'forbidden' })
    delete request.query.scope.workspaceId
    request.query.scope.connectionId = 'other-provider'
    await expect(invokeDataSource(env, request, invocation())).rejects.toMatchObject({ code: 'invalid-request' })
  })

  it('rejects unsupported operators and wrong typed literals', async () => {
    const { env } = await world()
    const request = query()
    request.query.predicate = { kind: 'comparison', left: { address: { from: 'item', pointer: '/state' } }, operator: 'contains', right: { address: { from: 'literal', value: 'open' } } }
    await expect(invokeDataSource(env, request, invocation())).rejects.toMatchObject({ code: 'unsupported-query' })
    request.query.predicate.operator = 'eq'
    request.query.predicate.right = { address: { from: 'literal', value: 3 } }
    await expect(invokeDataSource(env, request, invocation())).rejects.toMatchObject({ code: 'invalid-request' })
    expect(dataSourceRequestSchema.safeParse({ ...query(), query: { ...query().query, take: 1 } }).success).toBe(false)
  })

  it('times out and cancels even a callback that ignores AbortSignal', async () => {
    const { env } = await world()
    await expect(invokeDataSource(env, { ...query('timeout'), timeoutMs: 10 }, invocation())).rejects.toMatchObject({ code: 'timeout' })
    const controller = new AbortController()
    const pending = invokeDataSource(env, query('timeout'), { ...invocation(), signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('marks a page-budget selection incomplete and never returns its incremental checkpoint', async () => {
    const { env } = await world(true, async (request, context) => {
      const input = dataSourceRequestSchema.parse(await request.clone().json())
      if (input.operation !== 'query') return fixtureModule.fetchSource(request, context)
      const index = Number(input.cursor ?? 0)
      return Response.json({ records: [], revision: '1', readTime: 1, completeness: { kind: 'more', cursor: String(index + 1) } })
    })
    expect(await invokeDataSource(env, query(), invocation())).toMatchObject({
      records: [], completeness: { kind: 'incomplete', cause: 'host-budget' },
    })
  })

  it('accepts an exact sorted take and rejects unsupported bounded claims', async () => {
    const { env } = await world(true, async (request, context) => {
      const input = dataSourceRequestSchema.parse(await request.clone().json())
      if (input.operation !== 'query') return fixtureModule.fetchSource(request, context)
      const response = await fixtureModule.fetchSource(request, context)
      const body = await response.json() as Record<string, unknown>
      return Response.json({ ...body, completeness: { kind: 'bounded' } })
    })
    await expect(invokeDataSource(env, query(), invocation())).rejects.toMatchObject({ code: 'invalid-response' })
    const request = query()
    request.query.sort = [{ pointer: '/state', direction: 'asc' }]
    request.query.take = 1
    expect(await invokeDataSource(env, request, invocation())).toMatchObject({ completeness: { kind: 'bounded' } })
  })

  it('rejects options claiming exhaustion and continuation together', async () => {
    const { env } = await world(true, async (request, context) => {
      const input = dataSourceRequestSchema.parse(await request.clone().json())
      if (input.operation !== 'options') return fixtureModule.fetchSource(request, context)
      return Response.json({ options: [], exhausted: true, nextCursor: 'next' })
    })
    await expect(invokeDataSource(env, {
      operation: 'options', source, scope: { parameters: { project: 'a' } }, target: 'field',
      pointer: '/state', search: '', pageSize: 25,
    }, invocation())).rejects.toMatchObject({ code: 'invalid-response' })
  })
})
