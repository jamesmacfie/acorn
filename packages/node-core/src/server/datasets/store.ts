import { createHash, randomUUID } from 'node:crypto'
import type { DataField } from '@acorn/protocol/dataBindings.ts'
import type { DataSchema } from '@acorn/protocol/dataSchemas.ts'
import { canonicalDataEncoding, MISSING, readDataPointer, type DataValue } from '@acorn/protocol/dataValues.ts'
import { validateDataValue } from '@acorn/protocol/dataSchemas.ts'
import type { DatasetCreate, DatasetWrite } from '@acorn/protocol/datasets.ts'
import type { AppDatabase } from '../db'
import { sourceFieldSchema } from '../dataSources/validation'

export type DatasetDefinition = {
  id: string; workspaceId: string; projectId: string | null; name: string
  mode: DatasetCreate['mode']; feeder: DatasetCreate['feeder']; feederConfig: string
  currentVersion: number; identityFields: string; eventTimeField: string | null
  backfillFrom: number | null; checkpoint: string | null
  retentionDays: number; maxRows: number; maxBytes: number; createdAt: number; updatedAt: number
}
export type DatasetVersion = { schema: DataSchema; fields: DataField[]; version: number }
export type DatasetInputRow = { data: DataValue; evidence?: DataValue; reason?: string }

export class DatasetError extends Error {
  constructor(public readonly code: 'not-found' | 'forbidden' | 'invalid' | 'schema-mismatch' | 'capacity' | 'conflict', message: string = code) {
    super(message)
  }
}

const definitionColumns = 'id, workspace_id AS workspaceId, project_id AS projectId, name, mode, feeder, feeder_config AS feederConfig, current_version AS currentVersion, identity_fields AS identityFields, event_time_field AS eventTimeField, backfill_from AS backfillFrom, checkpoint, retention_days AS retentionDays, max_rows AS maxRows, max_bytes AS maxBytes, created_at AS createdAt, updated_at AS updatedAt'

export function getDataset(db: AppDatabase, id: string): DatasetDefinition {
  const row = db.$client.prepare(`SELECT ${definitionColumns} FROM datasets WHERE id = ?`).get(id) as DatasetDefinition | undefined
  if (!row) throw new DatasetError('not-found')
  return row
}

export function listDatasets(db: AppDatabase, workspaceId: string, projectId?: string) {
  const rows = db.$client.prepare(`SELECT ${definitionColumns},
    (SELECT COUNT(*) FROM dataset_rows r WHERE r.dataset_id = d.id) AS rowCount,
    (SELECT COALESCE(SUM(length(data_json) + COALESCE(length(evidence_json), 0)), 0) FROM dataset_rows r WHERE r.dataset_id = d.id)
      + (SELECT COALESCE(SUM(length(value_json)), 0) FROM dataset_corrections c WHERE c.dataset_id = d.id) AS bytes
    FROM datasets d WHERE workspace_id = ? AND (project_id IS NULL OR project_id = ?) ORDER BY created_at DESC`)
    .all(workspaceId, projectId ?? null) as (DatasetDefinition & { rowCount: number; bytes: number })[]
  return rows.map(row => {
    const capture = db.$client.prepare(`SELECT finished_at AS finishedAt, complete, reason, row_count AS rowCount
      FROM dataset_captures WHERE dataset_id = ? ORDER BY finished_at DESC LIMIT 1`).get(row.id) as
      { finishedAt: number; complete: number; reason: string | null; rowCount: number } | undefined
    return { ...row, coverage: coverageForDataset(db, row.id),
      ...(capture ? { lastCapture: { ...capture, complete: !!capture.complete } } : {}) }
  })
}

/** Device settings span every workspace and project; source discovery remains scope-bound. */
export function listAllDatasets(db: AppDatabase) {
  const workspaces = db.$client.prepare('SELECT id FROM workspaces').all() as { id: string }[]
  return workspaces.flatMap(workspace => {
    const projects = db.$client.prepare('SELECT id FROM projects WHERE workspace_id = ?').all(workspace.id) as { id: string }[]
    return [listDatasets(db, workspace.id), ...projects.map(project => listDatasets(db, workspace.id, project.id))]
      .flat().filter((dataset, index, all) => all.findIndex(candidate => candidate.id === dataset.id) === index)
  })
}

export function assertDatasetScope(dataset: DatasetDefinition, workspaceId: string, projectId?: string): void {
  if (dataset.workspaceId !== workspaceId || dataset.projectId && dataset.projectId !== projectId) throw new DatasetError('forbidden')
}

/** Task writes target one project-owned definition; a workspace-wide read source is not a write grant. */
export function assertDatasetWriteScope(dataset: DatasetDefinition, workspaceId: string, projectId: string): void {
  if (dataset.workspaceId !== workspaceId || dataset.projectId !== projectId) throw new DatasetError('forbidden')
}

export function currentVersion(db: AppDatabase, dataset: DatasetDefinition): DatasetVersion {
  const row = db.$client.prepare('SELECT schema_json AS schemaJson, fields_json AS fieldsJson FROM dataset_versions WHERE dataset_id = ? AND version = ?')
    .get(dataset.id, dataset.currentVersion) as { schemaJson: string; fieldsJson: string } | undefined
  if (!row) throw new DatasetError('schema-mismatch')
  return { version: dataset.currentVersion, schema: JSON.parse(row.schemaJson) as DataSchema, fields: JSON.parse(row.fieldsJson) as DataField[] }
}

export function createDataset(db: AppDatabase, input: DatasetCreate): DatasetDefinition {
  for (const field of input.fields) if (!sourceFieldSchema(input.schema, field.pointer)) throw new DatasetError('invalid', `Field ${field.pointer} is absent from the schema.`)
  for (const field of input.identityFields) if (!sourceFieldSchema(input.schema, field)) throw new DatasetError('invalid', `Identity ${field} is absent from the schema.`)
  if (input.eventTimeField && !sourceFieldSchema(input.schema, input.eventTimeField)) throw new DatasetError('invalid', 'Event time is absent from the schema.')
  const workspace = db.$client.prepare('SELECT 1 FROM workspaces WHERE id = ?').get(input.workspaceId)
  if (!workspace) throw new DatasetError('not-found', 'Workspace does not exist.')
  if (input.projectId) {
    const project = db.$client.prepare('SELECT 1 FROM projects WHERE id = ? AND workspace_id = ?').get(input.projectId, input.workspaceId)
    if (!project) throw new DatasetError('forbidden', 'Project does not belong to workspace.')
  }
  const id = randomUUID(), now = Date.now()
  db.$client.transaction(() => {
    db.$client.prepare(`INSERT INTO datasets (id, workspace_id, project_id, name, mode, feeder, feeder_config,
      current_version, identity_fields, event_time_field, backfill_from, checkpoint, retention_days, max_rows, max_bytes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`).run(
      id, input.workspaceId, input.projectId ?? null, input.name, input.mode, input.feeder,
      JSON.stringify(input.captureQuery ?? null), JSON.stringify(input.identityFields), input.eventTimeField ?? null,
      input.backfillFrom ?? null, input.retentionDays, input.maxRows, input.maxBytes, now, now,
    )
    db.$client.prepare('INSERT INTO dataset_versions (dataset_id, version, schema_json, fields_json, created_at) VALUES (?, 1, ?, ?, ?)')
      .run(id, JSON.stringify(input.schema), JSON.stringify(input.fields), now)
  })()
  return getDataset(db, id)
}

export function addDatasetVersion(db: AppDatabase, dataset: DatasetDefinition, schema: DataSchema, fields: DataField[]): number {
  const previous = currentVersion(db, dataset)
  if (schema.type !== 'object' || schema.properties?._observationTime || schema.properties?._arrivedAt) {
    throw new DatasetError('invalid', 'Dataset metadata field names are reserved.')
  }
  for (const field of fields) {
    const next = sourceFieldSchema(schema, field.pointer)
    if (!next) throw new DatasetError('invalid', `Field ${field.pointer} is absent from the schema.`)
    const old = sourceFieldSchema(previous.schema, field.pointer)
    if (old && JSON.stringify(old.type) !== JSON.stringify(next.type)) throw new DatasetError('invalid', `Field ${field.pointer} changed type; create a new dataset.`)
  }
  for (const identity of JSON.parse(dataset.identityFields) as string[]) if (!sourceFieldSchema(schema, identity)) {
    throw new DatasetError('invalid', `Identity ${identity} cannot be removed.`)
  }
  for (const identity of JSON.parse(dataset.identityFields) as string[]) {
    const before = sourceFieldSchema(previous.schema, identity)
    const after = sourceFieldSchema(schema, identity)
    if (JSON.stringify(before?.type) !== JSON.stringify(after?.type)) throw new DatasetError('invalid', `Identity ${identity} changed type.`)
  }
  if (dataset.eventTimeField && !sourceFieldSchema(schema, dataset.eventTimeField)) throw new DatasetError('invalid', 'Event time cannot be removed.')
  if (dataset.eventTimeField && JSON.stringify(sourceFieldSchema(previous.schema, dataset.eventTimeField)?.type)
    !== JSON.stringify(sourceFieldSchema(schema, dataset.eventTimeField)?.type)) throw new DatasetError('invalid', 'Event time changed type.')
  if (dataset.feeder === 'agent' && (!schema.properties?.evidence || !schema.properties.reason
    || !schema.properties.correction || !Array.isArray(schema.properties.correction.type)
    || !schema.properties.correction.type.includes('null'))) {
    throw new DatasetError('invalid', 'Agent datasets need evidence, reason, and nullable correction fields.')
  }
  const version = dataset.currentVersion + 1
  db.$client.transaction(() => {
    db.$client.prepare('INSERT INTO dataset_versions (dataset_id, version, schema_json, fields_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(dataset.id, version, JSON.stringify(schema), JSON.stringify(fields), Date.now())
    db.$client.prepare('UPDATE datasets SET current_version = ?, updated_at = ? WHERE id = ?').run(version, Date.now(), dataset.id)
  })()
  return version
}

export function rowIdentity(dataset: DatasetDefinition, data: DataValue): string {
  const values = (JSON.parse(dataset.identityFields) as string[]).map(pointer => readDataPointer(data, pointer))
  if (values.some(value => value === MISSING || value === null || typeof value === 'object')) {
    throw new DatasetError('invalid', 'Identity fields must be present scalar values.')
  }
  return createHash('sha256').update(canonicalDataEncoding(values as DataValue)).digest('hex')
}

function eventTime(dataset: DatasetDefinition, data: DataValue): number | null {
  if (!dataset.eventTimeField) return null
  const value = readDataPointer(data, dataset.eventTimeField)
  const time = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN
  if (!Number.isFinite(time)) throw new DatasetError('invalid', 'Event time must be an instant.')
  return time
}

/** One transaction protects all rows and the capacity check. Corrections live outside feeder rows. */
export function writeDatasetRows(db: AppDatabase, dataset: DatasetDefinition, input: DatasetWrite, observationTime = Date.now()): number {
  if (dataset.currentVersion !== input.version) throw new DatasetError('schema-mismatch', 'Feeder schema version is stale.')
  const { schema } = currentVersion(db, dataset)
  const rows = input.rows.map(row => {
    const evidence = row.evidence
    const hasEvidence = evidence !== undefined && evidence !== null &&
      (typeof evidence !== 'string' || evidence.trim().length > 0) &&
      (typeof evidence !== 'object' || Object.keys(evidence).length > 0)
    if (dataset.feeder === 'agent' && (!hasEvidence || !row.reason?.trim())) {
      throw new DatasetError('invalid', 'Agent rows need evidence and a reason.')
    }
    const data = dataset.feeder === 'agent' ? {
      ...(row.data as Record<string, DataValue>), evidence: row.evidence!, reason: row.reason!, correction: null,
    } : row.data
    try { validateDataValue(data, schema) }
    catch { throw new DatasetError('schema-mismatch', 'Feeder output does not match the dataset schema.') }
    const identity = rowIdentity(dataset, data)
    const occurred = eventTime(dataset, data)
    return { ...row, identity, occurred, dataJson: JSON.stringify(data), evidenceJson: row.evidence === undefined ? null : JSON.stringify(row.evidence) }
  })
  return db.$client.transaction(() => {
    const insert = db.$client.prepare(`INSERT INTO dataset_rows
      (dataset_id, identity, observation_time, event_time, arrived_at, removed_at, schema_version, data_json, evidence_json, reason)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
      ON CONFLICT(dataset_id, identity, observation_time) DO UPDATE SET
      arrived_at = excluded.arrived_at, data_json = excluded.data_json, evidence_json = excluded.evidence_json,
      reason = excluded.reason, schema_version = excluded.schema_version, removed_at = NULL`)
    for (const row of rows) {
      if (dataset.mode === 'event-archive') {
        const existing = db.$client.prepare('SELECT event_time AS eventTime FROM dataset_rows WHERE dataset_id = ? AND identity = ? LIMIT 1')
          .get(dataset.id, row.identity) as { eventTime: number } | undefined
        if (existing && existing.eventTime !== row.occurred) throw new DatasetError('conflict', 'Event identity has a different event time.')
        if (existing) continue
      }
      const observation = dataset.mode === 'current-mirror' ? 0 : dataset.mode === 'event-archive' ? row.occurred! : observationTime
      insert.run(dataset.id, row.identity, observation, row.occurred, Date.now(), input.version, row.dataJson, row.evidenceJson, row.reason ?? null)
    }
    const size = db.$client.prepare(`SELECT
      (SELECT COUNT(*) FROM dataset_rows WHERE dataset_id = ?) AS rows,
      (SELECT COALESCE(SUM(length(data_json) + COALESCE(length(evidence_json), 0)), 0) FROM dataset_rows WHERE dataset_id = ?)
        + (SELECT COALESCE(SUM(length(value_json)), 0) FROM dataset_corrections WHERE dataset_id = ?) AS bytes`)
      .get(dataset.id, dataset.id, dataset.id) as { rows: number; bytes: number }
    if (size.rows > dataset.maxRows || size.bytes > dataset.maxBytes) throw new DatasetError('capacity', 'Dataset cap exceeded.')
    return rows.length
  })()
}

export function markMirrorRemoved(db: AppDatabase, dataset: DatasetDefinition, identities: readonly string[], at: number): void {
  if (dataset.mode !== 'current-mirror') return
  db.$client.transaction(() => {
    const seen = new Set(identities)
    const active = db.$client.prepare('SELECT identity FROM dataset_rows WHERE dataset_id = ? AND removed_at IS NULL').all(dataset.id) as { identity: string }[]
    const mark = db.$client.prepare('UPDATE dataset_rows SET removed_at = ? WHERE dataset_id = ? AND identity = ?')
    for (const row of active) if (!seen.has(row.identity)) mark.run(at, dataset.id, row.identity)
  })()
}

export function correctDatasetRow(db: AppDatabase, dataset: DatasetDefinition, identity: string, value: DataValue): void {
  const exists = db.$client.prepare('SELECT 1 FROM dataset_rows WHERE dataset_id = ? AND identity = ?').get(dataset.id, identity)
  if (!exists) throw new DatasetError('not-found')
  const correctionSchema = currentVersion(db, dataset).schema.properties?.correction
  if (!correctionSchema) throw new DatasetError('schema-mismatch', 'Dataset has no correction field.')
  try { validateDataValue(value, correctionSchema) }
  catch { throw new DatasetError('invalid', 'Correction does not fit its field type.') }
  db.$client.transaction(() => {
    db.$client.prepare(`INSERT INTO dataset_corrections (dataset_id, identity, value_json, corrected_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(dataset_id, identity) DO UPDATE SET value_json = excluded.value_json, corrected_at = excluded.corrected_at`)
      .run(dataset.id, identity, JSON.stringify(value), Date.now())
    const bytes = db.$client.prepare(`SELECT
      (SELECT COALESCE(SUM(length(data_json) + COALESCE(length(evidence_json), 0)), 0) FROM dataset_rows WHERE dataset_id = ?)
        + (SELECT COALESCE(SUM(length(value_json)), 0) FROM dataset_corrections WHERE dataset_id = ?) AS bytes`)
      .get(dataset.id, dataset.id) as { bytes: number }
    if (bytes.bytes > dataset.maxBytes) throw new DatasetError('capacity', 'Dataset cap exceeded.')
  })()
}

export function coverageForDataset(db: AppDatabase, id: string) {
  return db.$client.prepare('SELECT from_time AS fromTime, to_time AS toTime, kind, reason FROM dataset_coverage WHERE dataset_id = ? ORDER BY from_time DESC LIMIT 100')
    .all(id) as { fromTime: number; toTime: number; kind: string; reason: string | null }[]
}

export function datasetCoveragePartial(db: AppDatabase, dataset: DatasetDefinition, window?: { from?: number; to?: number }): boolean {
  const windows = db.$client.prepare('SELECT from_time AS fromTime, to_time AS toTime, kind FROM dataset_coverage WHERE dataset_id = ? ORDER BY from_time')
    .all(dataset.id) as { fromTime: number; toTime: number; kind: string }[]
  const complete = windows.filter(window => window.kind === 'complete').sort((a, b) => a.fromTime - b.fromTime)
  const merged: { fromTime: number; toTime: number }[] = []
  for (const part of complete) {
    const last = merged.at(-1)
    if (last && part.fromTime <= last.toTime) last.toTime = Math.max(last.toTime, part.toTime)
    else merged.push({ fromTime: part.fromTime, toTime: part.toTime })
  }
  if (dataset.mode === 'event-archive' && !complete.length) return true
  return windows.some(gap => gap.kind === 'gap' && gap.toTime > (window?.from ?? -Infinity)
    && gap.fromTime < (window?.to ?? Infinity)
    && !merged.some(part => part.fromTime <= Math.max(gap.fromTime, window?.from ?? -Infinity)
      && part.toTime >= Math.min(gap.toTime, window?.to ?? Infinity)))
}

export function recordCoverage(db: AppDatabase, id: string, fromTime: number, toTime: number, kind: 'complete' | 'gap', reason: string | null, captureId: string | null): void {
  db.$client.prepare('INSERT INTO dataset_coverage (dataset_id, from_time, to_time, kind, reason, capture_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, fromTime, toTime, kind, reason, captureId)
}

export function deleteDataset(db: AppDatabase, id: string): void {
  db.$client.transaction(() => {
    for (const table of ['dataset_rows', 'dataset_versions', 'dataset_corrections', 'dataset_captures', 'dataset_coverage']) {
      db.$client.prepare(`DELETE FROM ${table} WHERE dataset_id = ?`).run(id)
    }
    db.$client.prepare('DELETE FROM datasets WHERE id = ?').run(id)
  })()
}

export function deleteWorkspaceDatasets(db: AppDatabase, workspaceId: string): void {
  const ids = db.$client.prepare('SELECT id FROM datasets WHERE workspace_id = ?').all(workspaceId) as { id: string }[]
  for (const row of ids) deleteDataset(db, row.id)
}

export function pruneDatasetRows(db: AppDatabase, now = Date.now()): number {
  const definitions = db.$client.prepare(`SELECT ${definitionColumns} FROM datasets`).all() as DatasetDefinition[]
  let removed = 0
  for (const dataset of definitions) {
    const timeColumn = dataset.mode === 'event-archive' ? 'event_time' : dataset.mode === 'snapshot-history' ? 'observation_time' : 'arrived_at'
    const result = db.$client.prepare(`DELETE FROM dataset_rows WHERE dataset_id = ? AND ${timeColumn} < ?`)
      .run(dataset.id, now - dataset.retentionDays * 86_400_000)
    removed += Number(result.changes)
    const cutoff = now - dataset.retentionDays * 86_400_000
    db.$client.prepare('DELETE FROM dataset_captures WHERE dataset_id = ? AND finished_at < ?').run(dataset.id, cutoff)
    db.$client.prepare('DELETE FROM dataset_coverage WHERE dataset_id = ? AND to_time < ?').run(dataset.id, cutoff)
  }
  return removed
}
