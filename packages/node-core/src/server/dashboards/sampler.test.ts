import { describe, expect, it } from 'vitest'
import type { DashboardPanelContent } from '@acorn/protocol/dashboards.ts'
import { memoryIdentityStore } from '../activeIdentity'
import { makeTestDb, testEnv } from '../../testkit/db'
import { schema } from '../db'
import { registerCoreDataSource } from '../dataSources/registry'
import { dashboardStore } from './store'
import { readSeries } from './history'
import { definedPanelIds, panelsToSample, runSamplePass } from './sampler'

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
    fields: [{ pointer: '/points', label: 'Points', origin: 'declared', display: { kind: 'number' } }],
    parameters: { type: 'object', properties: {}, additionalProperties: false }, parameterFields: [],
    operations: { query: true, options: false, details: false, incremental: false, groups: ['all'] }, consistency: 'fixture',
  }
  : request.operation === 'query'
    ? { records: [1, 2, 3].map(value => ({ recordId: String(value), data: { points: value } })), completeness: { kind: 'complete' }, revision: '1', readTime: request.evaluationTime }
    : {})

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
})
