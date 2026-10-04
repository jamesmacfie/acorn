import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/** Dataset definitions are workspace owned. Versions are immutable descriptions of stored rows. */
export const datasets = sqliteTable('datasets', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  projectId: text('project_id'),
  name: text('name').notNull(),
  mode: text('mode').notNull(),
  feeder: text('feeder').notNull(),
  feederConfig: text('feeder_config').notNull(),
  currentVersion: integer('current_version').notNull().default(1),
  identityFields: text('identity_fields').notNull(),
  eventTimeField: text('event_time_field'),
  backfillFrom: integer('backfill_from'),
  checkpoint: text('checkpoint'),
  retentionDays: integer('retention_days').notNull(),
  maxRows: integer('max_rows').notNull(),
  maxBytes: integer('max_bytes').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, t => [index('datasets_workspace_idx').on(t.workspaceId, t.projectId)])

export const datasetVersions = sqliteTable('dataset_versions', {
  datasetId: text('dataset_id').notNull(),
  version: integer('version').notNull(),
  schemaJson: text('schema_json').notNull(),
  fieldsJson: text('fields_json').notNull(),
  createdAt: integer('created_at').notNull(),
}, t => [primaryKey({ columns: [t.datasetId, t.version] })])

export const datasetRows = sqliteTable('dataset_rows', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  datasetId: text('dataset_id').notNull(),
  identity: text('identity').notNull(),
  observationTime: integer('observation_time').notNull(),
  eventTime: integer('event_time'),
  arrivedAt: integer('arrived_at').notNull(),
  removedAt: integer('removed_at'),
  schemaVersion: integer('schema_version').notNull(),
  dataJson: text('data_json').notNull(),
  evidenceJson: text('evidence_json'),
  reason: text('reason'),
}, t => [
  uniqueIndex('dataset_rows_identity_observation_idx').on(t.datasetId, t.identity, t.observationTime),
  index('dataset_rows_time_idx').on(t.datasetId, t.eventTime),
  index('dataset_rows_arrived_idx').on(t.datasetId, t.arrivedAt),
])

export const datasetCorrections = sqliteTable('dataset_corrections', {
  datasetId: text('dataset_id').notNull(),
  identity: text('identity').notNull(),
  valueJson: text('value_json').notNull(),
  correctedAt: integer('corrected_at').notNull(),
}, t => [primaryKey({ columns: [t.datasetId, t.identity] })])

export const datasetCaptures = sqliteTable('dataset_captures', {
  id: text('id').primaryKey(),
  datasetId: text('dataset_id').notNull(),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at').notNull(),
  complete: integer('complete', { mode: 'boolean' }).notNull(),
  reason: text('reason'),
  rowCount: integer('row_count').notNull(),
  boundaryJson: text('boundary_json'),
}, t => [index('dataset_captures_dataset_idx').on(t.datasetId, t.startedAt)])

export const datasetCoverage = sqliteTable('dataset_coverage', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  datasetId: text('dataset_id').notNull(),
  fromTime: integer('from_time').notNull(),
  toTime: integer('to_time').notNull(),
  kind: text('kind').notNull(),
  reason: text('reason'),
  captureId: text('capture_id'),
}, t => [index('dataset_coverage_dataset_time_idx').on(t.datasetId, t.fromTime, t.toTime)])
