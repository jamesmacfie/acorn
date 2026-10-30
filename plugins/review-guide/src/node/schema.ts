// The review guide plugin's one table (docs/first-party-plugins/review-guide.md § Storage). It lives in
// <data-root>/plugins/review-guide.sqlite with its own Drizzle chain, migrated at plugin init.
//
// `task_id` is a plain ID into core's `tasks`, read through CoreServices.tasks and never joined.
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const reviewGuides = sqliteTable(
  'review_guides',
  {
    taskId: text('task_id').notNull(),
    // Where the change leaves its target branch, and the worktree's HEAD when the guide was asked for.
    baseSha: text('base_sha').notNull(),
    headSha: text('head_sha').notNull(),
    baseRef: text('base_ref').notNull(),
    profileId: text('profile_id').notNull(),
    status: text('status', { enum: ['generating', 'ready', 'failed', 'stale'] }).notNull(),
    // The checked guide as JSON (shared/guide.ts `Guide`). Null until a turn answers.
    guide: text('guide'),
    error: text('error'),
    // How far the reader got, as JSON (shared/guide.ts `GuideProgress`). Null until they mark something.
    progress: text('progress'),
    // The managed agent session the turn runs in, once it has one.
    sessionId: text('session_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.baseSha, t.headSha] })],
)
