// The workflows plugin's own tables (docs/data-layer.md § Plugin databases). They live in
// <data-root>/plugins/workflows.sqlite with their own Drizzle chain, migrated at plugin init.
//
// The two ids that point elsewhere, `task_id` into core's `tasks` and `agent_session_id` into
// plugins/agents' session table, are plain IDs rather than foreign keys, dereferenced through
// CoreServices.tasks and the agents capability.
//
// The generated `0000` migration for this chain has to produce tables byte-identical to what a
// populated data root already holds, or an upgrade hits a schema mismatch on first run instead of
// finding a fresh empty file.
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// Workflow runs (docs/workflows.md): the durable checkpoint for the state machine. Machine-scoped
// like core's tasks.
export const workflowRuns = sqliteTable(
  'workflow_runs',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull(), // → core tasks.id (plain ID, not a foreign key)
    name: text('name').notNull(),
    status: text('status').notNull(), // running | gated | cancelling | done | failed | safety-rail | cancelled
    posture: text('posture').notNull().default('gated'), // gated (default) | autonomous (14 §posture)
    trigger: text('trigger').notNull().default('manual'),
    defJson: text('def_json').notNull(), // the WorkflowDef this run executes (frozen at start)
    // The resolved root and child definitions captured by executable preflight. Kept separate from
    // def_json so the definition shown in the run pane remains the definition the owner authored.
    resolvedGraphJson: text('resolved_graph_json'),
    // Legacy rows are backfilled to their own id by migration 0002. The column remains nullable at
    // the SQLite boundary because adding a row-derived NOT NULL value requires rebuilding the table.
    // Every run written after that migration supplies it.
    rootRunId: text('root_run_id'),
    parentRunId: text('parent_run_id'),
    parentStepId: text('parent_step_id'),
    depth: integer('depth').notNull().default(0),
    invocationKey: text('invocation_key'),
    payloadFingerprint: text('payload_fingerprint'),
    // The authority and limits this run may use after intersection with every ancestor. Persisting
    // them keeps recovery from rebuilding authority from an edited definition.
    effectiveToolsJson: text('effective_tools_json').notNull().default('{}'),
    effectiveBudgetJson: text('effective_budget_json').notNull().default('{}'),
    requiresRepoTrust: integer('requires_repo_trust', { mode: 'boolean' }).notNull().default(false),
    deadlineAt: integer('deadline_at'),
    error: text('error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('workflow_runs_task_created_idx').on(table.taskId, table.createdAt),
    index('workflow_runs_status_idx').on(table.status),
    index('workflow_runs_root_created_idx').on(table.rootRunId, table.createdAt),
    index('workflow_runs_parent_created_idx').on(table.parentRunId, table.createdAt),
    uniqueIndex('workflow_runs_invocation_key_uq').on(table.invocationKey),
  ],
)

// One step of a run. Steps carry their own working context (worktreePath) as a first-class field,
// not a derived value; structured output is the edge currency for branch and converging steps.
export const workflowSteps = sqliteTable(
  'workflow_steps',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(), // → workflow_runs.id (same file, so this one really is local)
    idx: integer('idx').notNull(), // sequence position
    name: text('name').notNull(),
    // Registry ID. Built-ins include agents, gates, control flow, data steps, and child workflows.
    kind: text('kind').notNull().default('agent'),
    mode: text('mode').notNull().default('headless'), // headless | ai | interactive
    profileId: text('profile_id'),
    model: text('model'),
    status: text('status').notNull(), // pending | running | waiting-gate | waiting-children | done | failed | skipped | safety-rail | cancelled
    worktreePath: text('worktree_path'),
    inputsJson: text('inputs_json'), // the assembled bundle handed to the step
    resultJson: text('result_json'), // the captured HeadlessResult (sans events)
    structuredJson: text('structured_json'), // the schema-conforming output, the edge currency
    sessionId: text('session_id'), // for --resume (open in terminal, 15 P2)
    agentSessionId: text('agent_session_id'), // → plugins/agents' session id (plain ID across databases)
    costUsd: real('cost_usd'),
    iteration: integer('iteration').notNull().default(0), // loop bound bookkeeping (14 §loop)
    parentStepId: text('parent_step_id'), // child-dispatch lineage
    error: text('error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('workflow_steps_run_idx_idx').on(table.runId, table.idx),
    index('workflow_steps_parent_created_idx').on(table.parentStepId, table.createdAt),
    index('workflow_steps_agent_session_idx').on(table.agentSessionId),
  ],
)

// A workflow definition typed by the owner rather than committed to a repository
// (docs/workflows.md § Database definitions). The file layer and this one are read together and a
// repo id wins, so a definition someone can review in a pull request always beats a local draft.
//
// `workspace_id` and `project_id` point into core's tables as plain IDs, the same way `task_id` above
// does. A null `project_id` means "any project in this workspace"; a project that is deleted leaves
// the row behind and the merged list marks it.
export const workflowDefs = sqliteTable(
  'workflow_defs',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(), // → core workspaces.id (plain ID)
    projectId: text('project_id'), // → core projects.id (plain ID), null = any project here
    name: text('name').notNull(),
    defJson: text('def_json').notNull(), // the WorkflowDef, without node positions
    revision: integer('revision').notNull().default(1), // bumped per save; a stale one is a 409
    publishedRevision: integer('published_revision'),
    basePublishedRevision: integer('base_published_revision'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('workflow_defs_workspace_idx').on(table.workspaceId, table.updatedAt)],
)

export const workflowRevisions = sqliteTable('workflow_revisions', {
  id: text('id').primaryKey(),
  definitionId: text('definition_id').notNull(),
  revision: integer('revision').notNull(),
  workspaceId: text('workspace_id').notNull(),
  projectId: text('project_id'),
  defJson: text('def_json').notNull(),
  digest: text('digest').notNull(),
  operationId: text('operation_id').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => [uniqueIndex('workflow_revisions_definition_revision_uq').on(table.definitionId, table.revision)])

export const workflowPublications = sqliteTable('workflow_publications', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  rootId: text('root_id').notNull(),
  state: text('state').notNull(),
  planJson: text('plan_json').notNull(),
  landedJson: text('landed_json').notNull().default('[]'),
  error: text('error'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const workflowDependencies = sqliteTable('workflow_dependencies', {
  id: text('id').primaryKey(),
  consumerId: text('consumer_id').notNull(),
  kind: text('kind').notNull(),
  targetId: text('target_id').notNull(),
}, table => [index('workflow_dependencies_target_idx').on(table.kind, table.targetId)])

export const workflowFileDrafts = sqliteTable('workflow_file_drafts', {
  id: text('id').primaryKey(),
  revision: integer('revision').notNull(),
  contentJson: text('content_json').notNull(),
})

export const workflowFileOperations = sqliteTable('workflow_file_operations', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  contentJson: text('content_json').notNull(),
})

// One replay-safe intent for creating a child task and starting its workflow run. The payload is
// frozen before either effect, so reconciliation never consults an edited definition after restart.
export const workflowDispatches = sqliteTable(
  'workflow_dispatches',
  {
    id: text('id').primaryKey(),
    callerKey: text('caller_key').notNull(),
    payloadFingerprint: text('payload_fingerprint').notNull(),
    payloadJson: text('payload_json').notNull(),
    parentTaskId: text('parent_task_id').notNull(),
    taskId: text('task_id').notNull(),
    runId: text('run_id').notNull(),
    rootRunId: text('root_run_id').notNull(),
    parentRunId: text('parent_run_id').notNull(),
    parentStepId: text('parent_step_id').notNull(),
    itemKey: text('item_key'),
    state: text('state').notNull(), // reserved | task-created | run-started | cancelling | terminal
    error: text('error'), // last recoverable transition error
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('workflow_dispatches_caller_key_uq').on(table.callerKey),
    uniqueIndex('workflow_dispatches_task_id_uq').on(table.taskId),
    uniqueIndex('workflow_dispatches_run_id_uq').on(table.runId),
    index('workflow_dispatches_state_updated_idx').on(table.state, table.updatedAt),
    index('workflow_dispatches_root_created_idx').on(table.rootRunId, table.createdAt),
    index('workflow_dispatches_parent_step_idx').on(table.parentStepId),
  ],
)

// One provider turn admitted against a workflow tree. A row is inserted before provider dispatch
// and settled once. Reserved rows still count after a crash because the provider may have spent
// usage before the Node lost the terminal event.
export const workflowTurnAdmissions = sqliteTable(
  'workflow_turn_admissions',
  {
    id: text('id').primaryKey(),
    rootRunId: text('root_run_id').notNull(),
    runId: text('run_id').notNull(),
    stepId: text('step_id').notNull(),
    state: text('state').notNull(), // reserved | settled
    costUsd: real('cost_usd').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    error: text('error'),
    createdAt: integer('created_at').notNull(),
    settledAt: integer('settled_at'),
  },
  (table) => [
    index('workflow_turn_admissions_root_created_idx').on(table.rootRunId, table.createdAt),
    index('workflow_turn_admissions_run_created_idx').on(table.runId, table.createdAt),
    index('workflow_turn_admissions_step_created_idx').on(table.stepId, table.createdAt),
    index('workflow_turn_admissions_state_idx').on(table.state),
  ],
)

// Processing history is workflow-owned so a selection and its child intents commit together.
export const workflowProcessingScopes = sqliteTable('workflow_processing_scopes', {
  runId: text('run_id').primaryKey(),
  scopeId: text('scope_id').notNull(),
  epoch: text('epoch').notNull(),
  baseline: integer('baseline', { mode: 'boolean' }).notNull().default(false),
})
export const workflowSelections = sqliteTable('workflow_selections', {
  id: text('id').primaryKey(),
  invocationKey: text('invocation_key').notNull().unique(),
  fingerprint: text('fingerprint').notNull(),
  runId: text('run_id').notNull(),
  stepId: text('step_id').notNull(),
  scopeKey: text('scope_key').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => [index('workflow_selections_run_idx').on(table.runId, table.createdAt)])
export const workflowSelectedRecords = sqliteTable('workflow_selected_records', {
  id: text('id').primaryKey(),
  selectionId: text('selection_id').notNull(),
  position: integer('position').notNull(),
  recordKey: text('record_key').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
  decision: text('decision').notNull(),
  attemptId: text('attempt_id'),
}, table => [uniqueIndex('workflow_selected_records_selection_key_uq').on(table.selectionId, table.recordKey),
  index('workflow_selected_records_page_idx').on(table.selectionId, table.position)])
export const workflowRecordStates = sqliteTable('workflow_record_states', {
  id: text('id').primaryKey(),
  scopeKey: text('scope_key').notNull(),
  recordKey: text('record_key').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
  fieldsJson: text('fields_json').notNull(),
  projection: text('projection').notNull(),
  attemptId: text('attempt_id'),
  updatedAt: integer('updated_at').notNull(),
}, table => [uniqueIndex('workflow_record_states_scope_key_uq').on(table.scopeKey, table.recordKey)])
export const workflowRecordAttempts = sqliteTable('workflow_record_attempts', {
  id: text('id').primaryKey(),
  stateId: text('state_id').notNull(),
  selectionId: text('selection_id').notNull(),
  dispatchId: text('dispatch_id').notNull().unique(),
  previousAttemptId: text('previous_attempt_id'),
  createdAt: integer('created_at').notNull(),
}, table => [index('workflow_record_attempts_history_idx').on(table.stateId, table.createdAt)])
export const workflowProcessingBoundaries = sqliteTable('workflow_processing_boundaries', {
  scopeKey: text('scope_key').primaryKey(),
  queryFingerprint: text('query_fingerprint').notNull(),
  boundaryJson: text('boundary_json').notNull(),
  selectionId: text('selection_id').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

// Approved schedule bindings and their replay ledger are workflow-owned. Core owns cadence and
// invokes the target by id; this database owns everything specific to workflow approval/recovery.
export const workflowSchedules = sqliteTable('workflow_schedules', {
  id: text('id').primaryKey(),
  schedulerKey: text('scheduler_key').unique(),
  workspaceId: text('workspace_id').notNull(),
  projectId: text('project_id').notNull(),
  workflowId: text('workflow_id').notNull(),
  inputsJson: text('inputs_json').notNull(),
  timezone: text('timezone').notNull(),
  limitsJson: text('limits_json').notNull(),
  loopsJson: text('loops_json').notNull().default('[]'),
  approvedGraphJson: text('approved_graph_json'),
  approvedGraphDigest: text('approved_graph_digest'),
  generation: integer('generation').notNull().default(0),
  epoch: text('epoch').notNull(),
  state: text('state').notNull(), // draft | baselining | active | needs-review | baseline-failed | deleted
  firstCheck: text('first_check').notNull().default('process-current'),
  error: text('error'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => [index('workflow_schedules_project_idx').on(table.projectId, table.updatedAt)])

export const workflowScheduleOccurrences = sqliteTable('workflow_schedule_occurrences', {
  id: text('id').primaryKey(),
  scheduleId: text('schedule_id').notNull(),
  generation: integer('generation').notNull(),
  kind: text('kind').notNull(), // due | catch-up | manual | baseline
  dueAt: integer('due_at'),
  requestKey: text('request_key').notNull(),
  payloadFingerprint: text('payload_fingerprint').notNull(),
  payloadJson: text('payload_json').notNull(),
  taskId: text('task_id').notNull(),
  runId: text('run_id').notNull(),
  state: text('state').notNull(), // claimed | task-created | run-started | terminal | skipped | blocked
  detail: text('detail'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, table => [
  uniqueIndex('workflow_schedule_occurrences_request_uq').on(table.scheduleId, table.requestKey),
  uniqueIndex('workflow_schedule_occurrences_due_uq').on(table.scheduleId, table.generation, table.dueAt),
  uniqueIndex('workflow_schedule_occurrences_task_uq').on(table.taskId),
  uniqueIndex('workflow_schedule_occurrences_run_uq').on(table.runId),
  index('workflow_schedule_occurrences_state_idx').on(table.scheduleId, table.state, table.updatedAt),
])
