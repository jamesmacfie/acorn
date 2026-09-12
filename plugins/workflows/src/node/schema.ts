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
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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
    error: text('error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('workflow_runs_task_created_idx').on(table.taskId, table.createdAt), index('workflow_runs_status_idx').on(table.status)],
)

// One step of a run. Steps carry their own working context (worktreePath) as a first-class field,
// not a derived value; structured output is the edge currency for branch and join steps.
export const workflowSteps = sqliteTable(
  'workflow_steps',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(), // → workflow_runs.id (same file, so this one really is local)
    idx: integer('idx').notNull(), // sequence position
    name: text('name').notNull(),
    kind: text('kind').notNull().default('agent'), // registry id; built-ins include agent/gates/ci-loop/fan-out/join/decide
    mode: text('mode').notNull().default('headless'), // headless | ai | interactive
    profileId: text('profile_id'),
    model: text('model'),
    status: text('status').notNull(), // pending | running | waiting-gate | done | failed | skipped | safety-rail | cancelled
    worktreePath: text('worktree_path'),
    inputsJson: text('inputs_json'), // the assembled bundle handed to the step
    resultJson: text('result_json'), // the captured HeadlessResult (sans events)
    structuredJson: text('structured_json'), // the schema-conforming output, the edge currency
    sessionId: text('session_id'), // for --resume (open in terminal, 15 P2)
    agentSessionId: text('agent_session_id'), // → plugins/agents' session id (plain ID across databases)
    costUsd: real('cost_usd'),
    iteration: integer('iteration').notNull().default(0), // loop bound bookkeeping (14 §loop)
    parentStepId: text('parent_step_id'), // fan-out lineage (14 P4)
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
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('workflow_defs_workspace_idx').on(table.workspaceId, table.updatedAt)],
)
