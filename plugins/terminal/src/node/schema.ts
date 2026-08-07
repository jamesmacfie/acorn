// The terminal plugin's own tables (docs/data-layer.md § Plugin DBs). Lives in
// <data-root>/plugins/terminal.sqlite with its own Drizzle chain, migrated at plugin init.
//
// Moved out of @acorn/node-core's schema.ts: a pseudo-terminal session is this plugin's data and
// nothing in core reads it. `task_id` is a plain ID into core's `tasks` — dereferenced through
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
