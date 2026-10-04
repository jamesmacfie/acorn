import { afterEach, expect, it } from 'vitest'
import { makeTestDb, type TestDb } from '../../testkit/db'
import { schema } from '../db'
import type { DatasetCreate } from '@acorn/protocol/datasets.ts'
import { addDatasetVersion, correctDatasetRow, createDataset, datasetCoveragePartial, deleteWorkspaceDatasets,
  getDataset, markMirrorRemoved, pruneDatasetRows, recordCoverage, rowIdentity, writeDatasetRows } from './store'

let world: TestDb | undefined
afterEach(() => { world?.cleanup(); world = undefined })

async function setup(mode: DatasetCreate['mode'], feeder: DatasetCreate['feeder'] = 'workflow') {
  world = makeTestDb()
  const now = Date.now()
  await world.db.insert(schema.workspaces).values({ id: 'ws', name: 'Workspace', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
  await world.db.insert(schema.projects).values({ id: 'project', workspaceId: 'ws', name: 'Project', createdAt: now, updatedAt: now })
  const agent = feeder === 'agent'
  const shape = { type: 'object' as const, properties: { id: { type: 'string' as const }, at: { type: 'number' as const },
    state: { type: 'string' as const }, ...(agent ? { evidence: { type: 'object' as const }, reason: { type: 'string' as const },
      correction: { type: ['string', 'null'] as ['string', 'null'] } } : {}) },
    required: ['id', 'at', 'state', ...(agent ? ['evidence', 'reason', 'correction'] : [])], additionalProperties: false }
  return createDataset(world.db, { workspaceId: 'ws', projectId: 'project', name: 'Items', mode, feeder, schema: shape,
    fields: [{ pointer: '/id', label: 'ID', origin: 'declared' }, { pointer: '/at', label: 'At', origin: 'declared' },
      { pointer: '/state', label: 'State', origin: 'declared' }, ...(agent ? [{ pointer: '/correction', label: 'Correction', origin: 'declared' as const }] : [])],
    identityFields: ['/id'], ...(mode === 'event-archive' ? { eventTimeField: '/at', backfillFrom: now - 1000 } : {}),
    retentionDays: 90, maxRows: 500_000, maxBytes: 512 * 1024 * 1024 })
}

const stored = () => world!.db.$client.prepare('SELECT identity, observation_time AS observationTime, event_time AS eventTime, removed_at AS removedAt, data_json AS dataJson FROM dataset_rows ORDER BY id')
  .all() as { identity: string; observationTime: number; eventTime: number | null; removedAt: number | null; dataJson: string }[]
const write = (id: string, version: number, data: { id: string; at: number; state: string }, observationTime?: number) =>
  writeDatasetRows(world!.db, getDataset(world!.db, id), { datasetId: id, version, rows: [{ data }] }, observationTime)

it('keeps one mirror row and marks only unseen identities removed after a complete read', async () => {
  const dataset = await setup('current-mirror')
  write(dataset.id, 1, { id: 'a', at: 1, state: 'open' })
  write(dataset.id, 1, { id: 'b', at: 1, state: 'open' })
  write(dataset.id, 1, { id: 'a', at: 2, state: 'closed' })
  expect(stored()).toHaveLength(2)
  expect(JSON.parse(stored()[0]!.dataJson).state).toBe('closed')
  markMirrorRemoved(world!.db, dataset, [rowIdentity(dataset, { id: 'a', at: 2, state: 'closed' })], 3)
  expect(stored().map(row => row.removedAt)).toEqual([null, 3])
})

it('accepts late events, rejects identity changes in event time, and keeps explicit gaps', async () => {
  const dataset = await setup('event-archive')
  write(dataset.id, 1, { id: 'a', at: 20, state: 'open' })
  write(dataset.id, 1, { id: 'b', at: 10, state: 'closed' })
  expect(stored().map(row => row.eventTime)).toEqual([20, 10])
  expect(() => write(dataset.id, 1, { id: 'a', at: 21, state: 'open' })).toThrow('different event time')
  recordCoverage(world!.db, dataset.id, 0, 10, 'complete', null, null)
  recordCoverage(world!.db, dataset.id, 10, 20, 'gap', 'capture failed', null)
  expect(datasetCoveragePartial(world!.db, dataset)).toBe(true)
  expect(datasetCoveragePartial(world!.db, dataset, { from: 0, to: 10 })).toBe(false)
  expect(datasetCoveragePartial(world!.db, dataset, { from: 12, to: 15 })).toBe(true)
})

it('keeps observations per capture and preserves human correction across agent writes', async () => {
  const dataset = await setup('snapshot-history', 'agent')
  const row = { data: { id: 'a', at: 1, state: 'open' }, evidence: { message: 'm1' }, reason: 'Question detected' }
  writeDatasetRows(world!.db, dataset, { datasetId: dataset.id, version: 1, rows: [row] }, 100)
  correctDatasetRow(world!.db, dataset, rowIdentity(dataset, row.data), 'not a question')
  writeDatasetRows(world!.db, dataset, { datasetId: dataset.id, version: 1, rows: [{ ...row, data: { ...row.data, state: 'closed' } }] }, 200)
  expect(stored().map(item => item.observationTime)).toEqual([100, 200])
  const correction = world!.db.$client.prepare('SELECT value_json AS value FROM dataset_corrections WHERE dataset_id = ?')
    .get(dataset.id) as { value: string }
  expect(JSON.parse(correction.value)).toBe('not a question')
  const bytes = world!.db.$client.prepare(`SELECT
    (SELECT SUM(length(data_json) + COALESCE(length(evidence_json), 0)) FROM dataset_rows WHERE dataset_id = ?)
      + (SELECT SUM(length(value_json)) FROM dataset_corrections WHERE dataset_id = ?) AS bytes`)
    .get(dataset.id, dataset.id) as { bytes: number }
  world!.db.$client.prepare('UPDATE datasets SET max_bytes = ? WHERE id = ?').run(bytes.bytes + 1, dataset.id)
  expect(() => correctDatasetRow(world!.db, getDataset(world!.db, dataset.id), rowIdentity(dataset, row.data), 'a much longer correction'))
    .toThrow('cap exceeded')
  expect((world!.db.$client.prepare('SELECT value_json AS value FROM dataset_corrections WHERE dataset_id = ?')
    .get(dataset.id) as { value: string }).value).toBe(correction.value)
})

it('rejects stale writes, bounds storage, retains versions, and removes workspace datasets', async () => {
  const dataset = await setup('snapshot-history')
  const next = addDatasetVersion(world!.db, dataset, { type: 'object', properties: { id: { type: 'string' }, at: { type: 'number' },
    state: { type: 'string' }, note: { type: 'string' } }, required: ['id', 'at', 'state'], additionalProperties: false },
  [{ pointer: '/id', label: 'ID', origin: 'declared' }, { pointer: '/at', label: 'At', origin: 'declared' },
    { pointer: '/state', label: 'State', origin: 'declared' }, { pointer: '/note', label: 'Note', origin: 'declared' }])
  expect(next).toBe(2)
  expect(() => addDatasetVersion(world!.db, getDataset(world!.db, dataset.id),
    { type: 'object', properties: { id: { type: 'number' }, at: { type: 'number' }, state: { type: 'string' } },
      required: ['id', 'at', 'state'], additionalProperties: false },
    [{ pointer: '/id', label: 'ID', origin: 'declared' }])).toThrow('changed type')
  expect(() => write(dataset.id, 1, { id: 'a', at: 1, state: 'open' })).toThrow('stale')
  write(dataset.id, 2, { id: 'a', at: 1, state: 'open' }, 100)
  world!.db.$client.prepare('UPDATE datasets SET max_rows = 1 WHERE id = ?').run(dataset.id)
  expect(() => write(dataset.id, 2, { id: 'b', at: 2, state: 'open' }, 200)).toThrow('cap exceeded')
  expect(stored()).toHaveLength(1)
  expect(pruneDatasetRows(world!.db, 100 + 91 * 86_400_000)).toBe(1)
  deleteWorkspaceDatasets(world!.db, 'ws')
  expect(() => getDataset(world!.db, dataset.id)).toThrow('not-found')
})
