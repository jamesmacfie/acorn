import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import { queryContentSchema, type QueryConsumer } from '@acorn/protocol/dataQueries.ts'
import { dataSourceRequestSchema } from '@acorn/protocol/dataSources.ts'
import { memoryIdentityStore } from '../activeIdentity'
import { openDb } from '../bindings'
import { testEnv } from '../../testkit/db'
import { schema } from '../db'
import { createCoreServices, SecretService } from '../core'
import { initPlugins, clearRegistrations } from '../pluginHost/host'
import { CapabilityRegistry } from '../pluginHost/capabilities'
import type { NodePluginContext } from '../pluginHost/types'
import type { AppEnv, Principal } from '../middleware/auth'
import { queries } from '../routes/queries'
import { queryStore } from './store'
import { publishQuery, resolveQuery } from './runtime'
import { queryPublication } from './publication'

const scope = { workspaceId: 'workspace' }
const invocation = () => ({ principal: { kind: 'internal' as const, scope: 'service' as const, userId: 'owner' }, signal: new AbortController().signal })
const content = () => queryContentSchema.parse({
  name: 'Open items',
  parameters: { type: 'object', properties: { threshold: { type: 'number' } }, required: ['threshold'], additionalProperties: false },
  query: {
    source: { pluginId: 'query-fixture', sourceId: 'items' }, scope: { ...scope, parameters: {} },
    predicate: { kind: 'comparison', left: { address: { from: 'item', pointer: '/score' } }, operator: 'gt', right: { address: { from: 'input', name: 'threshold', pointer: '' } } },
  },
})
const consumer = (kind: QueryConsumer['kind'], id = kind): QueryConsumer => ({ pluginId: 'consumer', kind, id, name: id, href: `/consumers/${id}` })
const cleanups: (() => void)[] = []
afterEach(() => { clearRegistrations('query-fixture'); for (const cleanup of cleanups.splice(0)) cleanup() })

async function world() {
  const directory = mkdtempSync(join(tmpdir(), 'acorn-query-test-'))
  const path = join(directory, 'core.sqlite')
  const db = openDb(path)
  const second = openDb(path)
  cleanups.push(() => { second.close(); db.close(); rmSync(directory, { recursive: true, force: true }) })
  const identity = memoryIdentityStore('owner')
  const env = testEnv({ DB: db, ACTIVE_IDENTITY: identity })
  for (const id of ['workspace', 'other']) db.insert(schema.workspaces).values({ id, name: id, createdAt: 1, updatedAt: 1 }).run()
  for (const id of ['project', 'sibling']) db.insert(schema.projects).values({ id, name: id, workspaceId: scope.workspaceId, createdAt: 1, updatedAt: 1 }).run()
  let beforeDescribe: (() => void) | undefined
  let optionExists = true
  let context!: NodePluginContext
  await initPlugins([{
    name: 'query-fixture',
    init(ctx) {
      context = ctx
      ctx.dataSources.register({ sourceId: 'items', name: 'Items', singular: 'Item', plural: 'Items', identityScope: 'Source', handler: '/v2/p/query-fixture/source' })
      ctx.routes.fetch(async request => {
        const input = dataSourceRequestSchema.parse(await request.json())
        if (input.operation === 'describe') {
          beforeDescribe?.()
          return Response.json({
            schema: { type: 'object', properties: { score: { type: 'number' }, state: { type: 'string' } }, required: ['score', 'state'], additionalProperties: false },
            fields: [
              { pointer: '/score', label: 'Score', origin: 'declared', query: { operators: ['gt'], sortable: true } },
              { pointer: '/state', label: 'State', origin: 'declared', query: { operators: ['eq'], sortable: false }, choices: { kind: 'dynamic', dependsOn: [] } },
            ],
            parameters: { type: 'object', properties: { includeArchived: { type: 'boolean' } }, additionalProperties: false },
            parameterFields: [],
            operations: { query: true, options: true, details: false, incremental: false, groups: ['all'] },
            revision: 'source-1', consistency: 'Live',
          })
        }
        if (input.operation === 'options') return Response.json({ options: optionExists ? [{ id: 'open', label: 'Open' }] : [], exhausted: true })
        throw new Error('Publication must not query records')
      }, { prefix: '/source' })
    },
  }], { env, dataDir: directory, capabilities: new CapabilityRegistry(), core: createCoreServices({ db, activeIdentity: identity, secrets: new SecretService('0'.repeat(64)) }) })
  const app = (principal: Principal = invocation().principal) => new Hono<AppEnv>()
    .use('*', async (c, next) => { c.set('principal', principal); await next() }).route('/queries', queries)
  const post = async (operation: string, body: object, principal?: Principal) => app(principal).request(`/queries/${operation}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation, scope, ...body }),
  }, env)
  return { db, env, store: queryStore(db), second: queryStore(second), post, context,
    duringDescription: (callback: () => void) => { beforeDescribe = callback },
    removeChoice: () => { optionExists = false },
  }
}

describe('workspace query library', () => {
  it('holds cross-store revisions, resumes ambiguous writes, and releases mixed project scopes', async () => {
    const { store, env } = await world()
    const first = store.create(scope, content())
    const projectScope = { ...scope, projectId: 'project' }
    const second = store.create(projectScope, { ...content(), query: { ...content().query, scope: { ...projectScope, parameters: {} } } })
    for (const draft of [first, second]) {
      const ownScope = { workspaceId: draft.workspaceId, projectId: draft.projectId }
      const { plan } = await queryPublication(env, { ...ownScope, action: 'prepare', queryId: draft.id, expectedRevision: 1, parameters: { threshold: 5 } }, invocation())
      await queryPublication(env, { ...ownScope, action: 'hold', operationId: 'operation', plan: plan! }, invocation())
      expect(() => store.delete(ownScope, draft.id, draft.draftRevision)).toThrow('referenced')
      const request = { ...ownScope, action: 'write' as const, operationId: 'operation', plan: plan! }
      const written = await queryPublication(env, request, invocation())
      expect((await queryPublication(env, request, invocation())).published).toEqual(written.published)
      expect(() => store.published(ownScope, draft.id)).toThrow('unpublished')
      await expect(publishQuery(env, ownScope, draft.id, 1, { threshold: 5 }, invocation())).rejects.toThrow('conflict')
    }
    await queryPublication(env, { ...scope, action: 'release', operationId: 'operation' }, invocation())
    expect(store.published(scope, first.id).revision).toBe(1)
    expect(store.published(projectScope, second.id).revision).toBe(1)
    store.delete(scope, first.id, first.draftRevision)
    expect(() => store.get(scope, first.id)).toThrow('not-found')
  })
  it('uses affected-row CAS for saves from two SQLite connections and preserves drafts across reopen', async () => {
    const { store, second } = await world()
    const draft = store.create(scope, content())
    const other = second.get(scope, draft.id)
    store.save(scope, draft.id, draft.draftRevision, { ...draft.content, name: 'Device one' })
    expect(() => second.save(scope, draft.id, other.draftRevision, { ...other.content, name: 'Device two' })).toThrow('conflict')
    expect(second.get(scope, draft.id).content.name).toBe('Device one')
  })
  it('rechecks CAS after metadata I/O and never publishes a newer unreviewed draft', async () => {
    const { store, second, env, duringDescription } = await world()
    const draft = store.create(scope, content())
    duringDescription(() => second.save(scope, draft.id, 1, { ...draft.content, name: 'Changed elsewhere' }))
    await expect(publishQuery(env, scope, draft.id, 1, { threshold: 5 }, invocation())).rejects.toThrow('conflict')
    expect(() => store.published(scope, draft.id)).toThrow('unpublished')
    expect(store.get(scope, draft.id).content.name).toBe('Changed elsewhere')
  })
  it('freezes exact immutable revisions while two consumers resolve latest publication', async () => {
    const { store, env, context } = await world()
    const draft = store.create(scope, content())
    const reference = { kind: 'saved' as const, queryId: draft.id, bindings: { threshold: { address: { from: 'literal' as const, value: 3 } } } }
    await expect(resolveQuery(env, scope, reference, {}, invocation())).rejects.toThrow('unpublished')
    for (const kind of ['panel', 'workflow'] as const) {
      await context.dataSources.setQueryConsumer(scope, draft.id, consumer(kind), invocation())
    }
    const first = await publishQuery(env, scope, draft.id, 1, { threshold: 1 }, invocation())
    expect(first.consumers.map(item => item.kind).sort()).toEqual(['panel', 'workflow'])
    expect(first.consumers.every(item => item.pluginId === 'query-fixture')).toBe(true)
    const [panel, workflow] = await Promise.all([resolveQuery(env, scope, reference, {}, invocation()), context.dataSources.resolveQuery(scope, reference, {}, invocation())])
    expect(panel).toEqual(workflow)
    const projectConsumer = await context.dataSources.resolveQuery({ ...scope, projectId: 'project' }, reference, {}, invocation())
    expect(projectConsumer).toEqual(workflow)
    expect(projectConsumer.query.scope.projectId).toBeUndefined()
    expect(panel.query.predicate).toMatchObject({ right: { address: { from: 'literal', value: 3 } } })
    const saved = store.save(scope, draft.id, 2, { ...content(), name: 'New name' })
    expect(store.published(scope, draft.id).revision).toBe(1)
    await publishQuery(env, scope, draft.id, saved.draftRevision, { threshold: 2 }, invocation())
    expect((await resolveQuery(env, scope, reference, {}, invocation())).published?.revision).toBe(2)
    expect((await resolveQuery(env, scope, { ...reference, revision: 1 }, {}, invocation())).published).toEqual(first.published)
    expect(panel.published).toEqual(first.published)
    expect(() => store.delete(scope, draft.id, 4)).toThrow('referenced')
  })
  it('retains immutable historical content after an unreferenced draft is deleted', async () => {
    const { store, env } = await world()
    const draft = store.create(scope, content())
    const { published } = await publishQuery(env, scope, draft.id, 1, { threshold: 1 }, invocation())
    store.delete(scope, draft.id, 2)
    expect(() => store.published(scope, draft.id)).toThrow('not-found')
    expect(store.published(scope, draft.id, 1)).toEqual(published)
  })
  it('preserves drafts when their source disappears and refuses unavailable or deleted dependencies', async () => {
    const { store, env, post } = await world()
    const draft = store.create(scope, content())
    clearRegistrations('query-fixture')
    await expect(publishQuery(env, scope, draft.id, 1, { threshold: 3 }, invocation())).rejects.toMatchObject({ code: 'unavailable' })
    expect(store.get(scope, draft.id).content).toEqual(content())
    expect((await post('save', { id: draft.id, expectedRevision: 1, content: { ...content(), name: 'Repair later' } })).status).toBe(200)
    await expect(resolveQuery(env, scope, { kind: 'saved', queryId: 'gone', bindings: {} }, {}, invocation())).rejects.toThrow('not-found')
  })
  it('validates declared types independently from sample values and binds boolean source arguments', async () => {
    const { store, env } = await world()
    const value = content()
    value.parameters.properties!.include = { type: 'boolean' }
    value.parameters.required!.push('include')
    value.sourceParameters.includeArchived = { address: { from: 'input', name: 'include', pointer: '' } }
    const draft = store.create(scope, value)
    await publishQuery(env, scope, draft.id, 1, { threshold: 1, include: false }, invocation())
    const result = await resolveQuery(env, scope, { kind: 'saved', queryId: draft.id, bindings: {
      threshold: { address: { from: 'step', stepId: 'previous', pointer: '/count' } },
      include: { address: { from: 'literal', value: true } },
    } }, { steps: { previous: { count: 9 } } }, invocation())
    expect(result.query.scope.parameters).toEqual({ includeArchived: true })
    await expect(publishQuery(env, scope, draft.id, 2, { threshold: '1', include: false }, invocation())).rejects.toThrow()
    const broken = content()
    broken.parameters.properties!.threshold = { type: 'integer' }
    broken.query.predicate = { kind: 'comparison', left: { address: { from: 'item', pointer: '/state' } }, operator: 'eq', right: { address: { from: 'input', name: 'threshold', pointer: '' }, conversion: 'scalar-to-text' } }
    const invalid = store.create(scope, broken)
    await expect(publishQuery(env, scope, invalid.id, 1, { threshold: 1 }, invocation())).rejects.toThrow('choice')
    broken.query.predicate.right = { address: { from: 'step', stepId: 'illegal', pointer: '' }, fallback: 'open' }
    const forbidden = store.create(scope, broken)
    await expect(publishQuery(env, scope, forbidden.id, 1, { threshold: 1 }, invocation())).rejects.toThrow('declared parameters')
  })
  it('refuses removed dynamic selections without executing a query', async () => {
    const { store, env, removeChoice } = await world()
    const value = content()
    value.query.predicate = { kind: 'comparison', left: { address: { from: 'item', pointer: '/state' } }, operator: 'eq', right: { address: { from: 'literal', value: 'open' } } }
    const draft = store.create(scope, value)
    await publishQuery(env, scope, draft.id, 1, { threshold: 1 }, invocation())
    removeChoice()
    await expect(publishQuery(env, scope, draft.id, 2, { threshold: 1 }, invocation())).rejects.toThrow('choice')
    expect(store.published(scope, draft.id).revision).toBe(1)
  })
  it('enforces workspace/project scope and task principal restrictions through routes', async () => {
    const { post, store } = await world()
    expect((await post('create', { content: content() })).status).toBe(200)
    expect((await post('create', { scope: { workspaceId: 'other' }, content: content() })).status).toBe(400)
    expect((await post('list', {}, { kind: 'internal', scope: 'task', taskId: 'task', userId: 'owner' })).status).toBe(403)
    expect((await post('list', { scope: { workspaceId: 'other', projectId: 'project' } })).status).toBe(403)
    const projectScope = { ...scope, projectId: 'project' }
    const value = content()
    value.query.scope.projectId = 'project'
    const draft = store.create(projectScope, value)
    expect(() => store.get(scope, draft.id)).toThrow('not-found')
    expect(() => store.get({ ...scope, projectId: 'sibling' }, draft.id)).toThrow('not-found')
    expect((await post('get', { scope: projectScope, id: draft.id })).status).toBe(200)
    expect((await post('publish', { scope: projectScope, id: draft.id, expectedRevision: 1, validationParameters: { threshold: 1 } })).status).toBe(200)
  })
})
