// The workflows plugin's own tables (docs/vNext/data.md § Plugin DBs). They live in
// <data-root>/plugins/workflows.sqlite with their own Drizzle chain, migrated at plugin init.
//
// Moved out of @acorn/node-core's schema.ts: a run and its steps are the workflow engine's durable
// checkpoint and nothing outside this plugin ever read them. The two ids that point elsewhere —
// `task_id` into core's `tasks`, `agent_session_id` into plugins/agents' session table — were already
// plain IDs rather than foreign keys, dereferenced through CoreServices.tasks and the agents capability
// respectively, so no join had to be unpicked to move these.
//
// The row set is unchanged, column for column, including the three indexes. That is deliberate: the
// generated `0000` migration for this chain has to produce byte-identical tables to what an existing
// data root already holds, or a user who upgrades gets a schema mismatch on their first run rather than
// a fresh empty file.
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Workflow runs (docs/workflows.md): the durable checkpoint for the state machine — every transition is
// persisted so a run survives an app restart (LangGraph-style checkpoint = the rows; reconciliation
// mirrors the tmux pattern). Machine-scoped like core's tasks.
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

// One step of a run. Steps carry a FIRST-CLASS working context (worktreePath — bargain-bull's hardest
// lesson); structured output is the edge currency (branch/join material).
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
    structuredJson: text('structured_json'), // the schema-conforming output — the edge currency
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
