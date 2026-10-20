// The terminal plugin's own tables (docs/data-layer/plugin-databases.md § Plugin databases). Lives in
// <data-root>/plugins/terminal.sqlite with its own Drizzle chain, migrated at plugin init.
//
// A pseudo-terminal session is this plugin's data and nothing in core reads it. `task_id` is a plain
// ID into core's `tasks`, dereferenced through
// CoreServices.tasks, never joined, because a transaction never spans database files.
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const terminalSessions = sqliteTable(
  'terminal_sessions',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    kind: text('kind').notNull(), // shell | agent
    profileId: text('profile_id').notNull(),
    backend: text('backend').notNull(), // node-pty | tmux (only tmux rows are persisted)
    status: text('status').notNull(), // running | exited
    cwd: text('cwd').notNull(),
    taskId: text('task_id').notNull(), // → core tasks.id (plain ID, not a foreign key)
    command: text('command').notNull(),
    argvJson: text('argv_json').notNull().default('[]'),
    tmuxSession: text('tmux_session'),
    cols: integer('cols').notNull(),
    rows: integer('rows').notNull(),
    agentSessionId: text('agent_session_id'), // managed-agent handoff/tool-terminal lineage
    createdAt: integer('created_at').notNull(),
    exitedAt: integer('exited_at'),
    exitCode: integer('exit_code'),
  },
  (t) => [
    index('terminal_sessions_task_idx').on(t.taskId),
    index('terminal_sessions_agent_session_idx').on(t.agentSessionId),
  ],
)

// One row per finished run: a run target, setup script, or teardown script the engine started. Numbers
// and identifiers only, never the command line, its output, or its environment (docs/terminal/run-targets.md
// § Run history).
export const terminalRuns = sqliteTable(
  'terminal_runs',
  {
    id: text('id').primaryKey(), // the session's id
    taskId: text('task_id').notNull(), // → core tasks.id (plain ID, not a foreign key)
    kind: text('kind').notNull(), // target | setup | teardown
    name: text('name').notNull(), // the target's declared id, or Setup or Teardown
    exitCode: integer('exit_code'), // null when it was stopped or ended by a signal
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at').notNull(),
  },
  (t) => [index('terminal_runs_task_idx').on(t.taskId), index('terminal_runs_finished_idx').on(t.finishedAt)],
)
