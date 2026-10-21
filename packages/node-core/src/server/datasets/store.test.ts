import { afterEach, expect, it } from 'vitest'
import { makeTestDb, type TestDb } from '../../testkit/db'
import { schema } from '../db'
import type { DatasetCreate } from '@acorn/protocol/datasets.ts'
import { datasetCreateSchema } from '@acorn/protocol/datasets.ts'
import { registeredDataSource } from '../dataSources/registry'
import { datasetSourceDescription, ensureDatasetSource, overdueRefresh } from './source'
import {
  addDatasetVersion,
  assertDatasetWriteScope,
  correctDatasetRow,
  createDataset,
  datasetCoveragePartial,
  deleteWorkspaceDatasets,
  getDataset,
  markMirrorRemoved,
  pruneDatasetRows,
  recordCoverage,
  rowIdentity,
  writeDatasetRows,
} from './store'

let world: TestDb | undefined
afterEach(() => {
  world?.cleanup()
  world = undefined
})

async function setup(mode: DatasetCreate['mode'], feeder: DatasetCreate['feeder'] = 'workflow') {
  world = makeTestDb()
  const now = Date.now()
  await world.db
    .insert(schema.workspaces)
    .values({ id: 'ws', name: 'Workspace', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
  await world.db
    .insert(schema.projects)
    .values({ id: 'project', workspaceId: 'ws', name: 'Project', createdAt: now, updatedAt: now })
  const agent = feeder === 'agent'
  const shape = {
    type: 'object' as const,
    properties: {
      id: { type: 'string' as const },
      at: { type: 'number' as const },
      state: { type: 'string' as const },
      ...(agent
        ? {
            evidence: { type: 'object' as const },
            reason: { type: 'string' as const },
            correction: { type: ['string', 'null'] as ['string', 'null'] },
          }
        : {}),
    },
    required: ['id', 'at', 'state', ...(agent ? ['evidence', 'reason', 'correction'] : [])],
    additionalProperties: false,
  }
  return createDataset(world.db, {
    workspaceId: 'ws',
    projectId: 'project',
    name: 'Items',
    mode,
    feeder,
    schema: shape,
    fields: [
      { pointer: '/id', label: 'ID', origin: 'declared' },
      { pointer: '/at', label: 'At', origin: 'declared' },
      { pointer: '/state', label: 'State', origin: 'declared' },
      ...(agent ? [{ pointer: '/correction', label: 'Correction', origin: 'declared' as const }] : []),
    ],
    identityFields: ['/id'],
    ...(mode === 'event-archive' ? { eventTimeField: '/at', backfillFrom: now - 1000 } : {}),
    retentionDays: 90,
    maxRows: 500_000,
    maxBytes: 512 * 1024 * 1024,
  })
}

const stored = () =>
  world!.db.$client
    .prepare(
      'SELECT identity, observation_time AS observationTime, event_time AS eventTime, removed_at AS removedAt, data_json AS dataJson FROM dataset_rows ORDER BY id',
    )
    .all() as {
    identity: string
    observationTime: number
    eventTime: number | null
    removedAt: number | null
    dataJson: string
  }[]
const write = (
  id: string,
  version: number,
  data: { id: string; at: number; state: string },
  observationTime?: number,
) =>
  writeDatasetRows(world!.db, getDataset(world!.db, id), { datasetId: id, version, rows: [{ data }] }, observationTime)

it('keeps one mirror row and marks only unseen identities removed after a complete read', async () => {
  const dataset = await setup('current-mirror')
  write(dataset.id, 1, { id: 'a', at: 1, state: 'open' })
  write(dataset.id, 1, { id: 'b', at: 1, state: 'open' })
  write(dataset.id, 1, { id: 'a', at: 2, state: 'closed' })
  expect(stored()).toHaveLength(2)
  expect(JSON.parse(stored()[0]!.dataJson).state).toBe('closed')
  markMirrorRemoved(world!.db, dataset, [rowIdentity(dataset, { id: 'a', at: 2, state: 'closed' })], 3)
  expect(stored().map((row) => row.removedAt)).toEqual([null, 3])
})

it('accepts late events, rejects identity changes in event time, and keeps explicit gaps', async () => {
  const dataset = await setup('event-archive')
  write(dataset.id, 1, { id: 'a', at: 20, state: 'open' })
  write(dataset.id, 1, { id: 'b', at: 10, state: 'closed' })
  expect(stored().map((row) => row.eventTime)).toEqual([20, 10])
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
  writeDatasetRows(
    world!.db,
    dataset,
    { datasetId: dataset.id, version: 1, rows: [{ ...row, data: { ...row.data, state: 'closed' } }] },
    200,
  )
  expect(stored().map((item) => item.observationTime)).toEqual([100, 200])
  const correction = world!.db.$client
    .prepare('SELECT value_json AS value FROM dataset_corrections WHERE dataset_id = ?')
    .get(dataset.id) as { value: string }
  expect(JSON.parse(correction.value)).toBe('not a question')
  const bytes = world!.db.$client
    .prepare(`SELECT
    (SELECT SUM(length(data_json) + COALESCE(length(evidence_json), 0)) FROM dataset_rows WHERE dataset_id = ?)
      + (SELECT SUM(length(value_json)) FROM dataset_corrections WHERE dataset_id = ?) AS bytes`)
    .get(dataset.id, dataset.id) as { bytes: number }
  world!.db.$client.prepare('UPDATE datasets SET max_bytes = ? WHERE id = ?').run(bytes.bytes + 1, dataset.id)
  expect(() =>
    correctDatasetRow(
      world!.db,
      getDataset(world!.db, dataset.id),
      rowIdentity(dataset, row.data),
      'a much longer correction',
    ),
  ).toThrow('cap exceeded')
  expect(
    (
      world!.db.$client
        .prepare('SELECT value_json AS value FROM dataset_corrections WHERE dataset_id = ?')
        .get(dataset.id) as { value: string }
    ).value,
  ).toBe(correction.value)
})

it('rejects stale writes, bounds storage, retains versions, and removes workspace datasets', async () => {
  const dataset = await setup('snapshot-history')
  const next = addDatasetVersion(
    world!.db,
    dataset,
    {
      type: 'object',
      properties: {
        id: { type: 'string' },
        at: { type: 'number' },
        state: { type: 'string' },
        note: { type: 'string' },
      },
      required: ['id', 'at', 'state'],
      additionalProperties: false,
    },
    [
      { pointer: '/id', label: 'ID', origin: 'declared' },
      { pointer: '/at', label: 'At', origin: 'declared' },
      { pointer: '/state', label: 'State', origin: 'declared' },
      { pointer: '/note', label: 'Note', origin: 'declared' },
    ],
  )
  expect(next).toBe(2)
  expect(() =>
    addDatasetVersion(
      world!.db,
      getDataset(world!.db, dataset.id),
      {
        type: 'object',
        properties: { id: { type: 'number' }, at: { type: 'number' }, state: { type: 'string' } },
        required: ['id', 'at', 'state'],
        additionalProperties: false,
      },
      [{ pointer: '/id', label: 'ID', origin: 'declared' }],
    ),
  ).toThrow('changed type')
  expect(() => write(dataset.id, 1, { id: 'a', at: 1, state: 'open' })).toThrow('stale')
  write(dataset.id, 2, { id: 'a', at: 1, state: 'open' }, 100)
  world!.db.$client.prepare('UPDATE datasets SET max_rows = 1 WHERE id = ?').run(dataset.id)
  expect(() => write(dataset.id, 2, { id: 'b', at: 2, state: 'open' }, 200)).toThrow('cap exceeded')
  expect(stored()).toHaveLength(1)
  expect(pruneDatasetRows(world!.db, 100 + 91 * 86_400_000)).toBe(1)
  deleteWorkspaceDatasets(world!.db, 'ws')
  expect(() => getDataset(world!.db, dataset.id)).toThrow('not-found')
})

const kept = (rows: unknown[]) =>
  datasetCreateSchema.parse({
    name: 'Forecast',
    workspaceId: 'ws',
    mode: 'current-mirror',
    feeder: 'agent',
    schema: {
      type: 'object',
      properties: {
        day: { type: 'string' },
        high: { type: 'number' },
        evidence: { type: 'object' },
        reason: { type: 'string' },
        correction: { type: ['string', 'null'] },
      },
      additionalProperties: false,
    },
    fields: [{ pointer: '/day', label: 'Day', origin: 'declared' }],
    identityFields: ['/day'],
    refresh: { projectId: 'project', taskId: 'task', origin: { says: 'Open-Meteo' }, every: 86_400 },
    rows: rows.map((data) => ({ data, evidence: { says: 'Open-Meteo' }, reason: 'Kept from the panel' })),
  })

it('keeps a workspace agent dataset that one project refreshes, starting from its first rows', async () => {
  await setup('current-mirror', 'agent')
  const dataset = createDataset(
    world!.db,
    kept([
      { day: '2026-10-20', high: 17 },
      { day: '2026-10-21', high: 15 },
    ]),
  )
  expect(dataset.projectId).toBeNull()
  expect(stored().map((row) => JSON.parse(row.dataJson).evidence)).toEqual([
    { says: 'Open-Meteo' },
    { says: 'Open-Meteo' },
  ])
  // The first rows are its first refresh, and only the named project may write the next.
  const description = datasetSourceDescription(world!.db, dataset)
  expect(description.dataset?.refreshedAt).toBeTypeOf('number')
  expect(() => assertDatasetWriteScope(dataset, 'ws', 'project')).not.toThrow()
  expect(() => assertDatasetWriteScope(dataset, 'ws', 'other')).toThrow()
})

it('leaves no dataset behind when a first row breaks its schema', async () => {
  await setup('current-mirror', 'agent')
  expect(() => createDataset(world!.db, kept([{ day: '2026-10-20', high: 'warm' }]))).toThrow()
  expect(world!.db.$client.prepare('SELECT COUNT(*) AS n FROM datasets').get()).toEqual({ n: 1 })
})

it('refuses first rows and a refresh outside a workspace agent dataset', () => {
  const input = { ...kept([{ day: '2026-10-20', high: 17 }]) }
  expect(datasetCreateSchema.safeParse({ ...input, projectId: 'project' }).success).toBe(false)
  expect(datasetCreateSchema.safeParse({ ...input, feeder: 'workflow' }).success).toBe(false)
  const { refresh: _refresh, ...unkept } = input
  expect(datasetCreateSchema.safeParse(unkept).success).toBe(false)
})

it('shows a scheduled refresh as a gap once it is a quarter of its cadence late', async () => {
  await setup('current-mirror', 'agent')
  const dataset = createDataset(world!.db, kept([{ day: '2026-10-20', high: 17 }]))
  const day = 86_400_000
  expect(overdueRefresh(dataset, 0, day + 3_599_999)).toBeUndefined()
  expect(overdueRefresh(dataset, 0, day + 3_600_000)).toMatchObject({ kind: 'gap', fromTime: day })
})

const recomputed = (id: string) =>
  world!.db.$client
    .prepare(
      `SELECT
      (SELECT COUNT(*) FROM dataset_rows WHERE dataset_id = ?) AS rowCount,
      (SELECT COALESCE(SUM(length(data_json) + COALESCE(length(evidence_json), 0)), 0) FROM dataset_rows WHERE dataset_id = ?)
        + (SELECT COALESCE(SUM(length(value_json)), 0) FROM dataset_corrections WHERE dataset_id = ?) AS byteCount`,
    )
    .get(id, id, id)
const counted = (id: string) =>
  world!.db.$client.prepare('SELECT row_count AS rowCount, byte_count AS byteCount FROM datasets WHERE id = ?').get(id)

it('keeps the row and byte counts through writes, corrections, pruning, and removal', async () => {
  const dataset = await setup('snapshot-history', 'agent')
  const day = 86_400_000
  const agentRow = (id: string, state: string) => ({
    data: { id, at: 1, state },
    evidence: { says: id },
    reason: 'Because',
  })
  const put = (rows: ReturnType<typeof agentRow>[], observed: number) =>
    writeDatasetRows(
      world!.db,
      getDataset(world!.db, dataset.id),
      { datasetId: dataset.id, version: 1, rows },
      observed,
    )
  const now = Date.now()
  put([agentRow('a', 'open'), agentRow('b', 'open')], now - 100 * day)
  put([agentRow('a', 'open')], now)
  // The same observation again replaces its row, which changes its bytes and not its count.
  put([agentRow('a', 'closed with a longer state')], now)
  const row = rowIdentity(dataset, { id: 'a' })
  correctDatasetRow(world!.db, getDataset(world!.db, dataset.id), row, 'first note')
  correctDatasetRow(world!.db, getDataset(world!.db, dataset.id), row, 'a second, longer note')
  expect(counted(dataset.id)).toEqual(recomputed(dataset.id))
  expect(counted(dataset.id)).toMatchObject({ rowCount: 3 })
  // Retention takes the two old observations.
  expect(pruneDatasetRows(world!.db)).toBe(2)
  expect(counted(dataset.id)).toEqual(recomputed(dataset.id))
  expect(counted(dataset.id)).toMatchObject({ rowCount: 1 })
})

it('serves a run its pages from one read, and the same rows an unpaged read would', async () => {
  const dataset = await setup('current-mirror')
  for (let index = 0; index < 7; index++) write(dataset.id, 1, { id: `row-${index}`, at: 7 - index, state: 'open' })
  const scope = { workspaceId: 'ws', projectId: 'project', parameters: {} }
  ensureDatasetSource(world!.db, dataset.id, scope)
  const source = registeredDataSource({ pluginId: 'core', sourceId: `dataset:${dataset.id}` })!
  const read = (pageSize: number, cursor?: string) =>
    source.coreHandler!(
      {
        operation: 'query',
        mode: 'execution',
        evaluationTime: 1,
        pageSize,
        ...(cursor ? { cursor } : {}),
        query: {
          source: { pluginId: 'core', sourceId: `dataset:${dataset.id}` },
          scope,
          sort: [{ pointer: '/at', direction: 'asc' }],
        },
      } as never,
      { DB: world!.db } as never,
      new AbortController().signal,
    ) as Promise<{ records: { recordId: string }[]; completeness: { kind: string; cursor?: string } }>
  const ids: string[] = []
  let page = await read(3)
  for (;;) {
    ids.push(...page.records.map((record) => record.recordId))
    if (page.completeness.kind !== 'more') break
    page = await read(3, page.completeness.cursor)
  }
  const whole = await read(100)
  expect(ids).toHaveLength(7)
  expect(ids).toEqual(whole.records.map((record) => record.recordId))
  expect(page.completeness).toEqual({ kind: 'complete' })
})
