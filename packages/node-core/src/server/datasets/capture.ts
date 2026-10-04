import { randomUUID } from 'node:crypto'
import type { DataSourceQuery } from '@acorn/protocol/dataSources.ts'
import { DATA_LIMITS } from '@acorn/protocol/dataValues.ts'
import type { Env } from '../bindings'
import type { AppDatabase } from '../db'
import { invokeDataSource } from '../dataSources/runtime'
import { DatasetError, currentVersion, getDataset, markMirrorRemoved, recordCoverage, rowIdentity, writeDatasetRows } from './store'

/** A capture is one bounded source execution under the Node's service principal. */
export async function captureDataset(db: AppDatabase, env: Env, datasetId: string, signal: AbortSignal): Promise<string> {
  const dataset = getDataset(db, datasetId)
  if (dataset.feeder !== 'capture') throw new DatasetError('invalid', 'Dataset has no capture feeder.')
  const query = JSON.parse(dataset.feederConfig) as DataSourceQuery
  if (query.scope.workspaceId !== dataset.workspaceId || query.scope.projectId !== (dataset.projectId ?? undefined)
    || query.source.pluginId === 'core' && query.source.sourceId.startsWith('dataset:')) {
    throw new DatasetError('forbidden', 'Capture query no longer fits the dataset scope.')
  }
  const captureId = randomUUID(), startedAt = Date.now()
  const prior = db.$client.prepare('SELECT finished_at AS finishedAt FROM dataset_captures WHERE dataset_id = ? AND complete = 1 ORDER BY finished_at DESC LIMIT 1')
    .get(dataset.id) as { finishedAt: number } | undefined
  const fromTime = prior?.finishedAt ?? dataset.backfillFrom ?? startedAt
  const principal = { kind: 'internal' as const, scope: 'service' as const, userId: env.ACTIVE_IDENTITY.get()! }
  let rowCount = 0, boundary: unknown, reason: string | null = null, complete = false
  try {
    const description = await invokeDataSource(env, { operation: 'describe', source: query.source, scope: query.scope }, { principal, signal })
    const continuation = description.operations.incremental
      ? dataset.checkpoint ? { kind: 'continue' as const, boundary: JSON.parse(dataset.checkpoint) }
        : { kind: 'baseline' as const }
      : undefined
    const result = await invokeDataSource(env, {
      operation: 'query', query: { ...query, ...(continuation ? { incremental: continuation } : {}) },
      mode: 'execution', evaluationTime: startedAt, pageSize: DATA_LIMITS.options,
    }, { principal, signal })
    if (result.completeness.kind !== 'complete') throw new DatasetError('invalid', `Source read ${result.completeness.kind}.`)
    boundary = result.incrementalBoundary
    if (continuation && boundary === undefined) throw new DatasetError('invalid', 'Incremental source returned no checkpoint.')
    const proved = result.eventCoverage?.filter(window => window.fromTime < window.toTime) ?? []
    db.$client.transaction(() => {
      const version = currentVersion(db, dataset)
      rowCount = writeDatasetRows(db, dataset, { datasetId, version: version.version,
        rows: result.records.map(record => ({ data: { ...(record.data as Record<string, unknown>), _recordId: record.ref.recordId } })) }, startedAt)
      if (dataset.mode === 'current-mirror' && !continuation) {
        markMirrorRemoved(db, dataset, result.records.map(record => rowIdentity(dataset, { ...(record.data as Record<string, unknown>), _recordId: record.ref.recordId })), startedAt)
      }
      if (boundary !== undefined) db.$client.prepare('UPDATE datasets SET checkpoint = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(boundary), startedAt, datasetId)
      if (dataset.mode === 'event-archive') {
        // A baseline without source coverage cannot prove historical completeness. Once a
        // checkpoint exists, a complete continuation proves the interval after that checkpoint.
        const windows = proved.map(window => ({ from: Math.max(window.fromTime, fromTime), to: Math.min(window.toTime, startedAt) }))
          .filter(window => window.from < window.to)
        if (continuation?.kind === 'continue' && boundary !== undefined) windows.push({ from: fromTime, to: startedAt })
        windows.sort((a, b) => a.from - b.from)
        let coveredUntil = fromTime
        for (const window of windows) {
          if (window.from > coveredUntil) recordCoverage(db, datasetId, coveredUntil, window.from, 'gap', 'Source did not prove event coverage.', captureId)
          if (window.to > Math.max(coveredUntil, window.from)) recordCoverage(db, datasetId,
            Math.max(coveredUntil, window.from), window.to, 'complete', null, captureId)
          coveredUntil = Math.max(coveredUntil, window.to)
        }
        if (coveredUntil < startedAt) recordCoverage(db, datasetId, coveredUntil, startedAt, 'gap',
          'Source did not prove event coverage.', captureId)
      }
    })()
    complete = true
  } catch (error) {
    reason = error instanceof Error ? error.message : 'Capture failed.'
    recordCoverage(db, datasetId, fromTime, Date.now(), 'gap', reason, captureId)
  }
  const finishedAt = Date.now()
  db.$client.prepare(`INSERT INTO dataset_captures
    (id, dataset_id, started_at, finished_at, complete, reason, row_count, boundary_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(captureId, datasetId, startedAt, finishedAt, complete ? 1 : 0, reason, rowCount, boundary === undefined ? null : JSON.stringify(boundary))
  if (!complete) throw new DatasetError('invalid', reason ?? 'Capture failed.')
  return `${rowCount} rows captured`
}
