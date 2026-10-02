import { describe, expect, it } from 'vitest'
import type { DashboardPanelContent } from '@acorn/protocol/dashboards.ts'
import { memoryIdentityStore } from '../activeIdentity'
import { makeTestDb, testEnv } from '../../testkit/db'
import { schema } from '../db'
import { registerCoreDataSource } from '../dataSources/registry'
import { dashboardStore } from './store'
import { readSeries } from './history'
import { definedPanelIds, panelsToSample, runSamplePass } from './sampler'
import { queryContentSchema } from '@acorn/protocol/dataQueries.ts'
import { queryStore } from '../queries/store'
import { publishQuery } from '../queries/runtime'
import { HOUR_MS } from './history'

const OWNER = 'owner-1'
const scope = { workspaceId: 'workspace-1' }
const content: DashboardPanelContent = {
  title: 'Open records',
  queries: [{
    id: 'records', label: 'Records', reference: { kind: 'inline', bindings: {}, content: {
      name: 'Records', parameters: { type: 'object', properties: {}, additionalProperties: false },
      sourceParameters: {}, query: { source: { pluginId: 'core', sourceId: 'records' }, scope: { ...scope, parameters: {} }, sort: [] },
    } },
  }],
  mapping: { columns: [], fields: {}, values: {}, unmapped: 'catch-all' },
  display: { view: { kind: 'stat', trend: 'history' }, fields: [] },
}

const blob = (dashboardId: string) => ({
  version: 1,
  panels: { p1: { id: 'p1', title: content.title, sources: [], shaping: {}, view: content.display.view, publication: { dashboardId } } },
  placements: { home: ['p1'] }, layouts: {},
})

registerCoreDataSource({
  sourceId: 'records', name: 'Records', singular: 'Record', plural: 'Records', identityScope: 'fixture',
}, request => request.operation === 'describe'
  ? {
    revision: '1', schema: { type: 'object', properties: { points: { type: 'number' } }, required: ['points'], additionalProperties: false },
    fields: [{ pointer: '/points', label: 'Points', origin: 'declared', display: { kind: 'number' }, query: { operators: ['gt'], sortable: true } }],
    parameters: { type: 'object', properties: {}, additionalProperties: false }, parameterFields: [],
    operations: { query: true, options: false, details: false, incremental: false, groups: ['all'] }, consistency: 'fixture',
  }
  : request.operation === 'query'
    ? { records: [1, 2, 3].map(value => ({ recordId: String(value), data: { points: value } })), completeness: { kind: 'complete' }, revision: '1', readTime: request.evaluationTime }
    : {})

registerCoreDataSource({
  sourceId: 'partial', name: 'Partial', singular: 'Record', plural: 'Records', identityScope: 'fixture',
}, request => request.operation === 'describe'
  ? {
    revision: '1', schema: { type: 'object', properties: { points: { type: 'number' } }, required: ['points'], additionalProperties: false },
    fields: [{ pointer: '/points', label: 'Points', origin: 'declared', display: { kind: 'number' } }],
    parameters: { type: 'object', properties: {}, additionalProperties: false }, parameterFields: [],
    operations: { query: true, options: false, details: false, incremental: false, groups: ['all'] }, consistency: 'fixture',
  }
  : request.operation === 'query'
    ? { records: [{ recordId: '1', data: { points: 1 } }], completeness: { kind: 'incomplete', cause: 'upstream-cap' }, revision: '1', readTime: request.evaluationTime }
    : {})

const NOW = 1_800_000_000_000
const invocation = () => ({ principal: { kind: 'internal' as const, scope: 'service' as const, userId: OWNER }, signal: AbortSignal.timeout(5_000) })

async function sampled(panelContent: DashboardPanelContent) {
  const core = makeTestDb()
  const env = testEnv({ DB: core.db, ACTIVE_IDENTITY: memoryIdentityStore(OWNER) })
  await core.db.insert(schema.workspaces).values({ id: scope.workspaceId, name: 'Workspace', isDefault: true, sort: 0, createdAt: 1, updatedAt: 1 })
  const store = dashboardStore(core.db)
  const draft = store.create(scope, panelContent)
  store.publish(scope, draft.id, draft.draftRevision)
  await core.db.insert(schema.prefs).values({ userId: OWNER, key: 'dashboards', value: JSON.stringify(blob(draft.id)) })
  return { core, env }
}

describe('dashboard measure sampler', () => {
  it('selects only placed published history panels', () => {
    const prefs = blob('dashboard-1')
    expect(panelsToSample(prefs).map(panel => panel.id)).toEqual(['p1'])
    expect([...definedPanelIds(prefs)]).toEqual(['p1'])
    expect(panelsToSample({ ...prefs, version: 2 })).toEqual([])
  })

  it('resolves the immutable dashboard and shared Node source with no client attached', async () => {
    const core = makeTestDb()
    const env = testEnv({ DB: core.db, ACTIVE_IDENTITY: memoryIdentityStore(OWNER) })
    try {
      await core.db.insert(schema.workspaces).values({
        id: scope.workspaceId, name: 'Workspace', isDefault: true, sort: 0,
        createdAt: 1, updatedAt: 1,
      })
      const store = dashboardStore(core.db)
      const draft = store.create(scope, content)
      store.publish(scope, draft.id, draft.draftRevision)
      await core.db.insert(schema.prefs).values({ userId: OWNER, key: 'dashboards', value: JSON.stringify(blob(draft.id)) })
      expect(await runSamplePass(core.db, env, AbortSignal.timeout(5_000), 1_800_000_000_000)).toMatchObject({ sampled: 1, skipped: [] })
      expect((await readSeries(core.db, 'p1')).samples.map(sample => sample.value)).toEqual([3])
    } finally { core.cleanup() }
  })

  it('reports an unavailable publication without inventing a zero', async () => {
    const core = makeTestDb()
    const env = testEnv({ DB: core.db, ACTIVE_IDENTITY: memoryIdentityStore(OWNER) })
    try {
      await core.db.insert(schema.prefs).values({ userId: OWNER, key: 'dashboards', value: JSON.stringify(blob('missing')) })
      expect(await runSamplePass(core.db, env, AbortSignal.timeout(5_000))).toMatchObject({ sampled: 0, skipped: [{ panelId: 'p1', reason: 'published dashboard unavailable' }] })
    } finally { core.cleanup() }
  })

  it('records nothing from a partial read and names why', async () => {
    const partial = structuredClone(content)
    if (partial.queries[0]!.reference.kind === 'inline') partial.queries[0]!.reference.content.query.source.sourceId = 'partial'
    const { core, env } = await sampled(partial)
    try {
      expect(await runSamplePass(core.db, env, AbortSignal.timeout(5_000), NOW)).toMatchObject({ sampled: 0, skipped: [{ panelId: 'p1', reason: 'Records returned partial data' }] })
      expect((await readSeries(core.db, 'p1')).samples).toEqual([])
    } finally { core.cleanup() }
  })

  it("resets the series when the saved query's filter changes", async () => {
    const core = makeTestDb()
    const env = testEnv({ DB: core.db, ACTIVE_IDENTITY: memoryIdentityStore(OWNER) })
    try {
      await core.db.insert(schema.workspaces).values({ id: scope.workspaceId, name: 'Workspace', isDefault: true, sort: 0, createdAt: 1, updatedAt: 1 })
      const inline = content.queries[0]!.reference
      if (inline.kind !== 'inline') throw new Error('fixture is inline')
      const queries = queryStore(core.db)
      const saved = queries.create(scope, queryContentSchema.parse(inline.content))
      await publishQuery(env, scope, saved.id, saved.draftRevision, {}, invocation())
      const dashboards = dashboardStore(core.db)
      const draft = dashboards.create(scope, { ...content, queries: [{ id: 'records', label: 'Records', reference: { kind: 'saved', queryId: saved.id, bindings: {} } }] })
      dashboards.publish(scope, draft.id, draft.draftRevision)
      await core.db.insert(schema.prefs).values({ userId: OWNER, key: 'dashboards', value: JSON.stringify(blob(draft.id)) })

      expect(await runSamplePass(core.db, env, AbortSignal.timeout(5_000), NOW)).toMatchObject({ sampled: 1, reset: 0 })
      expect(await runSamplePass(core.db, env, AbortSignal.timeout(5_000), NOW + HOUR_MS)).toMatchObject({ sampled: 1, reset: 0 })
      const current = queries.get(scope, saved.id)
      const filtered = queries.save(scope, saved.id, current.draftRevision, queryContentSchema.parse({ ...inline.content, query: { ...inline.content.query,
        predicate: { kind: 'comparison', left: { address: { from: 'item', pointer: '/points' } }, operator: 'gt', right: { address: { from: 'literal', value: 1 } } },
      } }))
      await publishQuery(env, scope, saved.id, filtered.draftRevision, {}, invocation())
      expect(await runSamplePass(core.db, env, AbortSignal.timeout(5_000), NOW + 2 * HOUR_MS)).toMatchObject({ sampled: 1, reset: 1 })
      expect((await readSeries(core.db, 'p1')).samples).toHaveLength(1)
    } finally { core.cleanup() }
  })
})
