import { afterEach, expect, it } from 'vitest'
import { makeTestDb, testEnv, type TestDb } from '../../testkit/db'
import { memoryIdentityStore } from '../activeIdentity'
import { schema } from '../db'
import { registerCoreDataSource } from '../dataSources/registry'
import { invokeDataSource, listDataSources } from '../dataSources/runtime'
import { captureDataset } from './capture'
import { createDataset, datasetCoveragePartial, getDataset } from './store'

let world: TestDb | undefined
afterEach(() => { world?.cleanup(); world = undefined })

let prove = false
registerCoreDataSource({ sourceId: 'dataset-capture-fixture', name: 'Events', singular: 'Event', plural: 'Events', identityScope: 'fixture' },
  request => request.operation === 'describe' ? {
    revision: '1', schema: { type: 'object', properties: { id: { type: 'string' }, at: { type: 'number' } },
      required: ['id', 'at'], additionalProperties: false },
    fields: [{ pointer: '/id', label: 'ID', origin: 'declared' }, { pointer: '/at', label: 'At', origin: 'declared' }],
    parameters: { type: 'object', properties: {}, additionalProperties: false }, parameterFields: [],
    operations: { query: true, options: false, details: false, incremental: false, groups: ['all'] }, consistency: 'fixture',
  } : request.operation === 'query' ? {
    records: [{ recordId: 'event-1', data: { id: 'event-1', at: 100 } }],
    completeness: { kind: 'complete' }, revision: '1', readTime: request.evaluationTime,
    ...(prove ? { eventCoverage: [{ fromTime: 0, toTime: request.evaluationTime + 1000 }] } : {}),
  } : {})

it('records success separately from event completeness, and marks unproved windows as gaps', async () => {
  world = makeTestDb()
  const now = Date.now()
  await world.db.insert(schema.workspaces).values({ id: 'ws', name: 'Workspace', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
  await world.db.insert(schema.workspaces).values({ id: 'other', name: 'Other', isDefault: false, sort: 1, createdAt: now, updatedAt: now })
  const dataset = createDataset(world.db, { workspaceId: 'ws', name: 'Events', mode: 'event-archive', feeder: 'capture',
    schema: { type: 'object', properties: { id: { type: 'string' }, at: { type: 'number' }, _recordId: { type: 'string' } },
      required: ['id', 'at', '_recordId'], additionalProperties: false },
    fields: [{ pointer: '/id', label: 'ID', origin: 'declared' }, { pointer: '/at', label: 'At', origin: 'declared' },
      { pointer: '/_recordId', label: 'Record ID', origin: 'declared' }], identityFields: ['/_recordId'],
    eventTimeField: '/at', backfillFrom: now - 1000,
    captureQuery: { source: { pluginId: 'core', sourceId: 'dataset-capture-fixture' }, scope: { workspaceId: 'ws', parameters: {} }, sort: [] },
    retentionDays: 90, maxRows: 500_000, maxBytes: 512 * 1024 * 1024 })
  const env = testEnv({ DB: world.db, ACTIVE_IDENTITY: memoryIdentityStore('owner') })
  prove = false
  await captureDataset(world.db, env, dataset.id, AbortSignal.timeout(5000))
  expect((world.db.$client.prepare('SELECT complete FROM dataset_captures').get() as { complete: number }).complete).toBe(1)
  expect(datasetCoveragePartial(world.db, dataset)).toBe(true)
  expect((world.db.$client.prepare('SELECT kind FROM dataset_coverage ORDER BY id').all() as { kind: string }[]).map(row => row.kind)).toEqual(['gap'])
  prove = true
  await new Promise(resolve => setTimeout(resolve, 5))
  await captureDataset(world.db, env, dataset.id, AbortSignal.timeout(5000))
  expect((world.db.$client.prepare('SELECT COUNT(*) AS count FROM dataset_rows').get() as { count: number }).count).toBe(1)
  expect((world.db.$client.prepare('SELECT kind FROM dataset_coverage ORDER BY id').all() as { kind: string }[]).map(row => row.kind)).toContain('complete')
  expect(getDataset(world.db, dataset.id).currentVersion).toBe(1)
  const invocation = { principal: { kind: 'internal' as const, scope: 'service' as const, userId: 'owner' }, signal: AbortSignal.timeout(5000) }
  const ref = { pluginId: 'core', sourceId: `dataset:${dataset.id}` }
  expect((await listDataSources(env, { workspaceId: 'ws', parameters: {} }, invocation)).sources).toContainEqual(expect.objectContaining(ref))
  expect((await listDataSources(env, { workspaceId: 'other', parameters: {} }, invocation)).sources).not.toContainEqual(expect.objectContaining(ref))
  const description = await invokeDataSource(env, { operation: 'describe', source: ref, scope: { workspaceId: 'ws', parameters: {} } }, invocation)
  expect(description.fields.find(field => field.pointer === '/at')?.query?.operators).toContain('gte')
  const result = await invokeDataSource(env, { operation: 'query', query: { source: ref, scope: { workspaceId: 'ws', parameters: {} },
    sort: [], predicate: { kind: 'comparison', left: { address: { from: 'item', pointer: '/at' } }, operator: 'gte',
      right: { address: { from: 'literal', value: 100 } } } }, mode: 'execution', pageSize: 20, evaluationTime: now }, invocation)
  expect(result.records).toHaveLength(1)
  expect(result.records[0]?.data).toMatchObject({ id: 'event-1', _recordId: 'event-1' })
})
