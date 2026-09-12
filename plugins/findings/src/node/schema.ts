import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// Immutable observations. Scope and provenance snapshots live with the evidence so a deleted task or
// missing contributor cannot rewrite history; task_id remains a first-class column for authorization.
export const observations = sqliteTable('observations', {
  id: text('id').primaryKey(),
  scopeKind: text('scope_kind').notNull(),
  taskId: text('task_id'),
  projectId: text('project_id'),
  workspaceId: text('workspace_id'),
  scopeLabelsJson: text('scope_labels_json').notNull(),
  originKind: text('origin_kind').notNull(),
  originJson: text('origin_json').notNull(),
  producerId: text('producer_id').notNull(),
  kindId: text('kind_id').notNull(),
  kindVersion: integer('kind_version').notNull(),
  kindLabel: text('kind_label').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  claimStatus: text('claim_status').notNull(),
  sourceNamespace: text('source_namespace').notNull(),
  sourceKey: text('source_key').notNull(),
  payloadHash: text('payload_hash').notNull(),
  evidenceJson: text('evidence_json').notNull(),
  correctsObservationId: text('corrects_observation_id'),
  createdAt: integer('created_at').notNull(),
}, (table) => [
  uniqueIndex('observations_source_key_unique').on(table.sourceNamespace, table.sourceKey),
  index('observations_task_created_idx').on(table.taskId, table.createdAt, table.id),
  check('observations_scope_shape', sql`
    (${table.scopeKind} = 'task' AND ${table.taskId} IS NOT NULL AND ${table.projectId} IS NOT NULL AND ${table.workspaceId} IS NOT NULL)
    OR (${table.scopeKind} = 'project' AND ${table.taskId} IS NULL AND ${table.projectId} IS NOT NULL AND ${table.workspaceId} IS NOT NULL)
    OR (${table.scopeKind} = 'workspace' AND ${table.taskId} IS NULL AND ${table.projectId} IS NULL AND ${table.workspaceId} IS NOT NULL)
    OR (${table.scopeKind} = 'private' AND ${table.taskId} IS NULL AND ${table.projectId} IS NULL AND ${table.workspaceId} IS NULL)
  `),
  check('observations_claim_status', sql`${table.claimStatus} IN ('observed', 'inferred', 'asked')`),
])

// Withdrawal is an event about evidence, not a mutable observation body and not a human disposition.
export const observationWithdrawals = sqliteTable('observation_withdrawals', {
  observationId: text('observation_id').primaryKey(),
  actorKind: text('actor_kind').notNull(),
  actorId: text('actor_id').notNull(),
  reason: text('reason'),
  withdrawnAt: integer('withdrawn_at').notNull(),
}, (table) => [check('observation_withdrawal_actor', sql`${table.actorKind} IN ('agent', 'device', 'plugin')`)])

// One monotonic revision per logical scope. Clients receive it only as an invalidation/checkpoint;
// content stays behind the paginated route.
export const findingScopeRevisions = sqliteTable('finding_scope_revisions', {
  scopeKey: text('scope_key').primaryKey(),
  revision: integer('revision').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const findingCandidates = sqliteTable('finding_candidates', {
  id: text('id').primaryKey(), targetKind: text('target_kind').notNull(), targetVersion: integer('target_version').notNull(),
  scopeKind: text('scope_kind').notNull(), taskId: text('task_id'), projectId: text('project_id'), workspaceId: text('workspace_id'),
  currentRevision: integer('current_revision').notNull(), status: text('status').notNull(), fingerprint: text('fingerprint').notNull(),
  subjectKey: text('subject_key').notNull(), groupingExplanation: text('grouping_explanation').notNull(), warningsJson: text('warnings_json').notNull(),
  baseTargetId: text('base_target_id'), baseHash: text('base_hash'), basePayloadJson: text('base_payload_json'), snoozedUntil: integer('snoozed_until'),
  createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
}, (table) => [
  index('finding_candidates_scope_status_idx').on(table.scopeKind, table.taskId, table.projectId, table.status, table.updatedAt),
  index('finding_candidates_fingerprint_idx').on(table.fingerprint),
])

export const findingCandidateRevisions = sqliteTable('finding_candidate_revisions', {
  candidateId: text('candidate_id').notNull(), revision: integer('revision').notNull(), payloadJson: text('payload_json').notNull(),
  payloadHash: text('payload_hash').notNull(), createdAt: integer('created_at').notNull(),
}, (table) => [primaryKey({ columns: [table.candidateId, table.revision] })])

export const findingCandidateObservations = sqliteTable('finding_candidate_observations', {
  candidateId: text('candidate_id').notNull(), observationId: text('observation_id').notNull(), ordinal: integer('ordinal').notNull(),
}, (table) => [primaryKey({ columns: [table.candidateId, table.observationId] })])

export const findingBundles = sqliteTable('finding_bundles', {
  id: text('id').primaryKey(), scopeKind: text('scope_kind').notNull(), taskId: text('task_id'), projectId: text('project_id'), workspaceId: text('workspace_id'),
  boundaryKey: text('boundary_key').notNull(), revision: integer('revision').notNull(), state: text('state').notNull(), inputCount: integer('input_count').notNull(),
  pendingCount: integer('pending_count').notNull(), error: text('error'), createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
}, (table) => [uniqueIndex('finding_bundles_boundary_unique').on(table.scopeKind, table.taskId, table.projectId, table.workspaceId, table.boundaryKey)])

export const findingBundleCandidates = sqliteTable('finding_bundle_candidates', {
  bundleId: text('bundle_id').notNull(), candidateId: text('candidate_id').notNull(), ordinal: integer('ordinal').notNull(),
}, (table) => [primaryKey({ columns: [table.bundleId, table.candidateId] })])

export const findingGroupingOutcomes = sqliteTable('finding_grouping_outcomes', {
  bundleId: text('bundle_id').notNull(), observationId: text('observation_id').notNull(), outcome: text('outcome').notNull(),
  candidateId: text('candidate_id'), explanation: text('explanation').notNull(),
}, (table) => [primaryKey({ columns: [table.bundleId, table.observationId] })])

export const findingPreparationJobs = sqliteTable('finding_preparation_jobs', {
  id: text('id').primaryKey(), boundaryKey: text('boundary_key').notNull(), scopeKey: text('scope_key').notNull(), inputHighWaterMark: integer('input_high_water_mark').notNull(),
  state: text('state').notNull(), leaseOwner: text('lease_owner'), leaseExpiresAt: integer('lease_expires_at'), attempt: integer('attempt').notNull(),
  sourceTaskId: text('source_task_id'), backendId: text('backend_id'), modelId: text('model_id'), usageJson: text('usage_json'), inputCount: integer('input_count').notNull(), outputCount: integer('output_count').notNull(), error: text('error'),
  bundleId: text('bundle_id'), createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
}, (table) => [uniqueIndex('finding_preparation_job_boundary_unique').on(table.scopeKey, table.boundaryKey)])

export const findingPreparationInputs = sqliteTable('finding_preparation_inputs', {
  jobId: text('job_id').notNull(), observationId: text('observation_id').notNull(), ordinal: integer('ordinal').notNull(),
}, (table) => [primaryKey({ columns: [table.jobId, table.observationId] }), uniqueIndex('finding_preparation_inputs_ordinal_unique').on(table.jobId, table.ordinal)])

export const findingReviewActions = sqliteTable('finding_review_actions', {
  id: text('id').primaryKey(), candidateId: text('candidate_id').notNull(), expectedRevision: integer('expected_revision').notNull(), actorId: text('actor_id').notNull(),
  action: text('action').notNull(), reason: text('reason'), idempotencyKey: text('idempotency_key').notNull(), createdAt: integer('created_at').notNull(),
}, (table) => [uniqueIndex('finding_review_action_idempotency_unique').on(table.idempotencyKey), index('finding_review_action_candidate_idx').on(table.candidateId, table.createdAt)])

export const findingSuppressions = sqliteTable('finding_suppressions', {
  id: text('id').primaryKey(), scopeKey: text('scope_key').notNull(), fingerprint: text('fingerprint').notNull(), subjectKey: text('subject_key'), reason: text('reason'),
  actorId: text('actor_id').notNull(), expiresAt: integer('expires_at'), createdAt: integer('created_at').notNull(), removedAt: integer('removed_at'),
}, (table) => [index('finding_suppressions_lookup_idx').on(table.scopeKey, table.fingerprint, table.removedAt)])

export const findingLifecycleCheckpoints = sqliteTable('finding_lifecycle_checkpoints', {
  boundaryKey: text('boundary_key').primaryKey(),
  taskId: text('task_id').notNull(),
  sourceKind: text('source_kind').notNull(),
  sourceVersion: text('source_version').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  availability: text('availability').notNull(),
  unavailableReason: text('unavailable_reason'),
  completedAt: integer('completed_at').notNull(),
  observationId: text('observation_id'),
  preparedBundleId: text('prepared_bundle_id'),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [index('finding_lifecycle_task_completed_idx').on(table.taskId, table.completedAt)])

export const findingLegacyImports = sqliteTable('finding_legacy_imports', {
  legacyId: text('legacy_id').primaryKey(),
  migrationVersion: integer('migration_version').notNull().default(1),
  sourceFilename: text('source_filename').notNull(),
  sourceHash: text('source_hash').notNull(),
  status: text('status').notNull(),
  observationId: text('observation_id'),
  candidateId: text('candidate_id'),
  candidateRevision: integer('candidate_revision'),
  candidatePayloadHash: text('candidate_payload_hash'),
  oneToOne: integer('one_to_one', { mode: 'boolean' }).notNull().default(false),
  error: text('error'),
  importedAt: integer('imported_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const findingBundleNotices = sqliteTable('finding_bundle_notices', {
  bundleId: text('bundle_id').primaryKey(),
  emittedAt: integer('emitted_at').notNull(),
})
