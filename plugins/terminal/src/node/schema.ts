// The terminal plugin's own tables (docs/vNext/data.md § Plugin DBs). Lives in
// <data-root>/plugins/terminal.sqlite with its own Drizzle chain, migrated at plugin init.
//
// Moved out of @acorn/node-core's schema.ts: a pseudo-terminal session is this plugin's data and
// nothing in core reads it. `task_id` is a plain ID into core's `tasks` — dereferenced through
// CoreServices.tasks, never joined, because a transaction never spans database files.
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Durable terminal sessions (docs/workflows.md). Machine-scoped like repo_paths. We persist ONLY
// tmux-backed sessions: tmux outlives an app restart, so on startup the engine reconciles these rows
// against `tmux list-sessions` and re-attaches the survivors. node-pty sessions die with the process
// and live only in the in-memory map. No terminal output is ever stored
// (docs/terminal-and-agents.md). ponytail: a §7 subset — no pid / last_attached_at (we re-derive
// liveness from tmux, not a stored pid).
// Bound to a task (docs/workspaces-and-tasks.md/03): repo / branch / PR are derived through the
// taskId → tasks lookup, so the loose repo_owner / repo_name / pull_number columns are gone.
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
