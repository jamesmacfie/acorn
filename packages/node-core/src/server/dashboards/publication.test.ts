import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { dataSourceRequestSchema } from '@acorn/protocol/dataSources.ts'
import { queryContentSchema } from '@acorn/protocol/dataQueries.ts'
import { memoryIdentityStore } from '../activeIdentity'
import { openDb } from '../bindings'
import { createCoreServices, SecretService } from '../core'
import { schema } from '../db'
import { initPlugins, clearRegistrations } from '../pluginHost/host'
import { CapabilityRegistry } from '../pluginHost/capabilities'
import { testEnv } from '../../testkit/db'
import { queryStore } from '../queries/store'
import { publishQuery } from '../queries/runtime'
import { dashboardStore } from './store'
import { publishDashboard } from './publication'
import { DashboardLibraryError } from './store'

const cleanups: (() => void)[] = []
afterEach(() => { clearRegistrations('dashboard-fixture'); for (const cleanup of cleanups.splice(0)) cleanup() })
const scope = { workspaceId: 'workspace' }
const invocation = () => ({ principal: { kind: 'internal' as const, scope: 'service' as const, userId: 'owner' }, signal: new AbortController().signal })

async function world() {
  const directory = mkdtempSync(join(tmpdir(), 'acorn-dashboard-test-'))
  const db = openDb(join(directory, 'core.sqlite'))
  cleanups.push(() => { db.close(); rmSync(directory, { recursive: true, force: true }) })
  const identity = memoryIdentityStore('owner')
  const env = testEnv({ DB: db, ACTIVE_IDENTITY: identity })
  db.insert(schema.workspaces).values({ id: scope.workspaceId, name: 'Workspace', createdAt: 1, updatedAt: 1 }).run()
  await initPlugins([{
    name: 'dashboard-fixture',
    init(ctx) {
      ctx.dataSources.register({ sourceId: 'items', name: 'Items', singular: 'Item', plural: 'Items', identityScope: 'Source', handler: '/v1/p/dashboard-fixture/source' })
      ctx.routes.fetch(async request => {
        const input = dataSourceRequestSchema.parse(await request.json())
        if (input.operation !== 'describe') throw new Error('Dashboard publication must not read records')
        return Response.json({
          schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'], additionalProperties: false },
          fields: [{ pointer: '/title', label: 'Title', origin: 'declared', display: { kind: 'text', role: 'title' }, query: { operators: ['eq'], sortable: true } }],
          parameters: { type: 'object', properties: {}, additionalProperties: false }, parameterFields: [],
          operations: { query: true, options: false, details: false, incremental: false, groups: ['all'] },
          revision: 'one', consistency: 'test',
        })
      }, { prefix: '/source' })
    },
  }], { env, dataDir: directory, capabilities: new CapabilityRegistry(), core: createCoreServices({ db, activeIdentity: identity, secrets: new SecretService('0'.repeat(64)) }) })
  return { db, env }
}

describe('dashboard publication', () => {
  it('validates saved queries, publishes immutably, and records shared-query impact', async () => {
    const { db, env } = await world()
    const query = queryStore(db).create(scope, queryContentSchema.parse({
      name: 'Items', parameters: { type: 'object', properties: {}, additionalProperties: false }, sourceParameters: {},
      query: { source: { pluginId: 'dashboard-fixture', sourceId: 'items' }, scope: { ...scope, parameters: {} }, sort: [] },
    }))
    await publishQuery(env, scope, query.id, query.draftRevision, {}, invocation())
    const draft = dashboardStore(db).create(scope, {
      title: 'Items', queries: [{ id: 'first', label: 'Items', reference: { kind: 'saved', queryId: query.id, bindings: {} } }],
      mapping: { columns: [], fields: {}, values: {}, unmapped: 'catch-all' },
      display: { view: { kind: 'list' }, fields: [] },
    })
    const published = await publishDashboard(env, scope, draft.id, draft.draftRevision, invocation())
    expect(published.revision).toBe(1)
    expect(queryStore(db).consumers(scope, query.id)).toEqual([expect.objectContaining({ kind: 'panel', id: draft.id, name: 'Items' })])
    const changed = queryStore(db).save(scope, query.id, 2, { ...query.content, name: 'Changed' })
    const impact = await publishQuery(env, scope, query.id, changed.draftRevision, {}, invocation())
    expect(impact.consumers).toEqual([expect.objectContaining({ kind: 'panel', id: draft.id })])
    const detached = dashboardStore(db).save(scope, draft.id, 2, {
      ...draft.content,
      sources: [{ id: 'first', label: 'Items', role: 'primary', reference: { kind: 'inline', content: query.content, bindings: {} } }],
    })
    await publishDashboard(env, scope, draft.id, detached.draftRevision, invocation())
    expect(queryStore(db).consumers(scope, query.id)).toEqual([])
  })

  it('refuses a panel with an unknown field and names its path', async () => {
    const { db, env } = await world()
    const draft = dashboardStore(db).create(scope, {
      title: 'Items', queries: [{ id: 'first', label: 'Items', reference: { kind: 'inline', bindings: {}, content: queryContentSchema.parse({
        name: 'Items', parameters: { type: 'object', properties: {}, additionalProperties: false }, sourceParameters: {},
        query: { source: { pluginId: 'dashboard-fixture', sourceId: 'items' }, scope: { ...scope, parameters: {} }, sort: [] },
      }) } }],
      mapping: { columns: [], fields: {}, values: {}, unmapped: 'catch-all' },
      display: { view: { kind: 'list' }, fields: ['/title', '/missing'] },
    })
    const refused = await publishDashboard(env, scope, draft.id, draft.draftRevision, invocation()).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(DashboardLibraryError)
    expect((refused as DashboardLibraryError).problems).toEqual([expect.objectContaining({ path: '/columns/1/bind/first' })])
    expect(dashboardStore(db).get(scope, draft.id).publishedRevision).toBeNull()
  })
})
