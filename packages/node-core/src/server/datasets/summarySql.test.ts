import { afterEach, expect, it } from 'vitest'
import { makeTestDb, type TestDb } from '../../testkit/db'
import { schema } from '../db'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataSourceQuery } from '@acorn/protocol/dataSources.ts'
import { runPlanStages, type PlanRow } from '@acorn/dashboards-core/plan.ts'
import { createDataset, getDataset, writeDatasetRows } from './store'
import { datasetSourceDescription } from './source'
import { summarizeDataset } from './summarySql'

let world: TestDb | undefined
afterEach(() => { world?.cleanup(); world = undefined })

const query: DataSourceQuery = { source: { pluginId: 'core', sourceId: 'fixture' }, scope: { workspaceId: 'ws', projectId: 'project', parameters: {} }, sort: [] }
const plan = (stages: PanelPlan['stages']): PanelPlan => ({
  version: 2, title: 'Run durations', time: { zone: 'Pacific/Auckland', mode: 'fixed', weekStart: 'monday' },
  sources: [{ id: 'runs', label: 'Runs', role: 'primary', reference: { kind: 'inline',
    content: { name: 'Runs', parameters: { type: 'object' }, query, sourceParameters: {} }, bindings: {} } }],
  columns: [
    { id: 'id', label: 'ID', type: 'text', bind: { runs: { field: '/id' } } },
    { id: 'duration', label: 'Duration', type: 'number', bind: { runs: { field: '/duration' } } },
    { id: 'at', label: 'At', type: 'datetime', bind: { runs: { field: '/at' } } },
  ], stages, view: { kind: 'list' },
})

async function setup() {
  world = makeTestDb()
  const now = Date.now()
  await world.db.insert(schema.workspaces).values({ id: 'ws', name: 'Workspace', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
  await world.db.insert(schema.projects).values({ id: 'project', workspaceId: 'ws', name: 'Project', createdAt: now, updatedAt: now })
  const dataset = createDataset(world.db, { workspaceId: 'ws', projectId: 'project', name: 'Runs', mode: 'event-archive', feeder: 'workflow',
    schema: { type: 'object', properties: { id: { type: 'string' }, duration: { type: ['number', 'null'] }, at: { type: 'number' } }, required: ['id', 'duration', 'at'], additionalProperties: false },
    fields: [
      { pointer: '/id', label: 'ID', origin: 'declared', query: { operators: ['eq'], sortable: false } },
      { pointer: '/duration', label: 'Duration', origin: 'declared', query: { operators: ['eq', 'gt'], sortable: true } },
      { pointer: '/at', label: 'At', origin: 'declared', query: { operators: ['gte', 'lt'], sortable: true } },
    ], identityFields: ['/id'], eventTimeField: '/at', backfillFrom: now - 100_000, retentionDays: 90, maxRows: 500_000, maxBytes: 512 * 1024 * 1024 })
  return dataset
}

it('matches the in-memory summary for filters, nulls, percentiles and local day buckets', async () => {
  const dataset = await setup()
  const input = [
    { id: 'a', duration: 10, at: Date.parse('2026-10-01T11:30:00Z') },
    { id: 'b', duration: 20, at: Date.parse('2026-10-01T12:30:00Z') },
    { id: 'c', duration: null, at: Date.parse('2026-10-01T13:30:00Z') },
  ]
  writeDatasetRows(world!.db, dataset, { datasetId: dataset.id, version: 1, rows: input.map(data => ({ data })) })
  const stages: PanelPlan['stages'] = [{ op: 'filter', where: { kind: 'comparison', left: { address: { from: 'item', pointer: '/duration' } }, operator: 'present' } },
    { op: 'summarize', by: [{ column: 'at', bucket: 'day' }], measures: [
      { id: 'count', label: 'Count', kind: 'count' }, { id: 'average', label: 'Average', kind: 'average', column: 'duration' },
      { id: 'p95', label: 'P95', kind: 'percentile', percentile: 95, column: 'duration' },
    ] }]
  const content = plan(stages)
  const memoryRows: PlanRow[] = input.map(item => ({ id: item.id, values: item, records: [] }))
  const memory = runPlanStages(content, memoryRows).rows
  const sql = summarizeDataset(world!.db, getDataset(world!.db, dataset.id), content, query, datasetSourceDescription(world!.db, dataset), false).rows
  expect(sql.map(row => row.values)).toEqual(memory.map(row => row.values))
  expect(sql.map(row => row.partial)).toEqual(memory.map(row => row.partial))
})

it('matches every supported reduction and a measure-local filter', async () => {
  const dataset = await setup()
  const input = [10, 20, null, 20].map((duration, index) => ({ id: String(index), duration, at: index + 1 }))
  writeDatasetRows(world!.db, dataset, { datasetId: dataset.id, version: 1, rows: input.map(data => ({ data })) })
  const where = { kind: 'comparison' as const, left: { address: { from: 'item' as const, pointer: '/duration' } },
    operator: 'gt' as const, right: { address: { from: 'literal' as const, value: 10 } } }
  const measures = [
    { id: 'count', label: 'Count', kind: 'count' as const },
    { id: 'filtered', label: 'Filtered count', kind: 'count-where' as const, where },
    ...(['sum', 'average', 'minimum', 'maximum', 'median', 'percentile', 'distinct-count', 'distinct-list', 'earliest', 'latest'] as const)
      .map(kind => ({ id: kind, label: kind, kind, column: 'duration', ...(kind === 'percentile' ? { percentile: 75 } : {}) })),
  ]
  const content = plan([{ op: 'summarize', by: [], measures }])
  const memory = runPlanStages(content, input.map(item => ({ id: item.id, values: item, records: [] }))).rows
  const sql = summarizeDataset(world!.db, dataset, content, query, datasetSourceDescription(world!.db, dataset), false).rows
  expect(sql.map(row => row.values)).toEqual(memory.map(row => row.values))
  expect(sql.map(row => row.partial)).toEqual(memory.map(row => row.partial))
})

it('reduces 200,000 stored rows in SQLite without materializing them in the runner', async () => {
  const dataset = await setup()
  const at = Date.parse('2026-10-01T12:00:00Z')
  world!.db.$client.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 200000)
    INSERT INTO dataset_rows (dataset_id, identity, observation_time, event_time, arrived_at, schema_version, data_json)
    SELECT ?, printf('run-%d', x), ?, ?, ?, 1, json_object('id', printf('run-%d', x), 'duration', x % 100, 'at', ?) FROM n`)
    .run(dataset.id, at, at, at, at)
  const content = plan([{ op: 'summarize', by: [{ column: 'at', bucket: 'week' }], measures: [
    { id: 'count', label: 'Count', kind: 'count' }, { id: 'p95', label: 'P95', kind: 'percentile', percentile: 95, column: 'duration' },
  ] }])
  const result = summarizeDataset(world!.db, dataset, content, query, datasetSourceDescription(world!.db, dataset), false)
  expect(result.inputCount).toBe(200_000)
  expect(result.rows).toHaveLength(1)
  expect(result.rows[0]?.values.count).toBe(200_000)
  expect(result.rows[0]?.values.p95).toBeCloseTo(94.05)
  expect(result.rows[0]?.representedRows).toBeUndefined()
}, 120_000)
