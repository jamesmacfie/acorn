import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// The Slack plugin's tables (docs/integrations/slack.md), in <data-root>/plugins/slack.sqlite. Message
// text lives here, on the Node that owns it: the hosted gateway keeps IDs only. `task_id` and
// `session_id` are plain IDs into core's tasks and the agents plugin's sessions, never joined.

// The owner's link in each Slack team, recorded only when a paired device confirmed the exact Slack user
// the gateway reported for this Node. The Node checks every turn and click against it, whatever the
// gateway checked. `link_id` is new on each confirmation, and the threads and picks made under a link
// carry it, so work from before an unlink or a relink can't run under the next link.
export const slackLinks = sqliteTable('slack_links', {
  teamId: text('team_id').primaryKey(),
  linkId: text('link_id').notNull(),
  teamName: text('team_name').notNull(),
  slackUserId: text('slack_user_id').notNull(),
  slackUserName: text('slack_user_name').notNull(),
  // The owner's choice, unticked by default, to answer approvals from Slack.
  approvals: integer('approvals', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
})

// A channel's or DM's project and mode, set with `/acorn project` and `/acorn mode`. A channel with no
// row takes the defaults: conversation for a DM, tasks for a channel. `name` is what a slash command
// told us, for the posts and the composer note, since events carry only the ID.
export const slackChannels = sqliteTable(
  'slack_channels',
  {
    teamId: text('team_id').notNull(),
    channelId: text('channel_id').notNull(),
    name: text('name'),
    projectId: text('project_id'),
    mode: text('mode', { enum: ['tasks', 'conversation'] }),
  },
  (table) => [primaryKey({ columns: [table.teamId, table.channelId] })],
)

// Conversation mode's one task per channel and project. Replaced when the task is archived.
export const slackChannelTasks = sqliteTable(
  'slack_channel_tasks',
  {
    teamId: text('team_id').notNull(),
    channelId: text('channel_id').notNull(),
    projectId: text('project_id').notNull(),
    taskId: text('task_id').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.teamId, table.channelId, table.projectId] })],
)

// A Slack thread the bot is answering in. At most one that hasn't ended per Slack thread: after it ends,
// a mention there starts another row. `id` is the team, channel, and the timestamp of the message that
// started it.
export const slackThreads = sqliteTable(
  'slack_threads',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id').notNull(),
    channelId: text('channel_id').notNull(),
    threadTs: text('thread_ts').notNull(),
    taskId: text('task_id').notNull(),
    linkId: text('link_id').notNull(),
    mode: text('mode', { enum: ['tasks', 'conversation'] }).notNull(),
    ended: integer('ended', { mode: 'boolean' }).notNull().default(false),
    // Guests already told this thread isn't theirs, as a JSON array of Slack user IDs.
    notedGuests: text('noted_guests').notNull().default('[]'),
    // The thread's earlier messages, read once when the bot was mentioned partway through, for the first turn.
    history: text('history'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('slack_threads_slack_idx').on(table.teamId, table.channelId, table.threadTs)],
)

// A thread's sessions, in the order they joined it. The first version writes one per thread; a fork or
// a second agent would add rows here without a migration.
export const slackThreadSessions = sqliteTable(
  'slack_thread_sessions',
  {
    threadId: text('thread_id').notNull(),
    sessionId: text('session_id').notNull(),
    ordinal: integer('ordinal').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.threadId, table.sessionId] }),
    uniqueIndex('slack_thread_sessions_session_idx').on(table.sessionId),
  ],
)

// Every human message the plugin acted on, which is also how a delivery seen twice is dropped. An owner's
// message waits to run as a turn, and a guest's waits as context for the owner's next turn.
export const slackMessages = sqliteTable(
  'slack_messages',
  {
    teamId: text('team_id').notNull(),
    channelId: text('channel_id').notNull(),
    ts: text('ts').notNull(),
    threadId: text('thread_id'),
    userId: text('user_id').notNull(),
    // The sender's Slack display name, for the context a guest's reply becomes.
    userName: text('user_name').notNull(),
    text: text('text').notNull(),
    role: text('role', { enum: ['owner', 'guest'] }).notNull(),
    status: text('status', { enum: ['waiting', 'sent', 'context', 'failed', 'picking'] }).notNull(),
    turnId: text('turn_id'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.channelId, table.ts] }),
    index('slack_messages_thread_idx').on(table.threadId, table.status),
  ],
)

// An owner's message waiting on a project pick, with the event as it arrived.
export const slackPending = sqliteTable('slack_pending', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull(),
  channelId: text('channel_id').notNull(),
  ts: text('ts').notNull(),
  linkId: text('link_id').notNull(),
  event: text('event').notNull(),
  expiresAt: integer('expires_at').notNull(),
})

// A turn in a Slack session: the message that started it (none for a turn typed in Acorn), its status
// line, the reaction it shows, and whether its answer has posted.
export const slackTurns = sqliteTable(
  'slack_turns',
  {
    turnId: text('turn_id').primaryKey(),
    sessionId: text('session_id').notNull(),
    threadId: text('thread_id').notNull(),
    messageTs: text('message_ts'),
    statusTs: text('status_ts'),
    reaction: text('reaction'),
    startedAt: integer('started_at').notNull(),
    posted: integer('posted', { mode: 'boolean' }).notNull().default(false),
    answerTs: text('answer_ts'),
  },
  (table) => [index('slack_turns_posted_idx').on(table.posted)],
)

// The approval card posted for a permission request, one per request. A click answers only the request
// on the card it came from: the install, channel, and message must match a row, and the row's link must
// still be current. `answered` makes the card single-use, and the row outlives a restart.
export const slackCards = sqliteTable(
  'slack_cards',
  {
    requestId: text('request_id').primaryKey(),
    sessionId: text('session_id').notNull(),
    threadId: text('thread_id').notNull(),
    teamId: text('team_id').notNull(),
    linkId: text('link_id').notNull(),
    channelId: text('channel_id').notNull(),
    messageTs: text('message_ts').notNull(),
    answered: integer('answered', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('slack_cards_message_idx').on(table.teamId, table.channelId, table.messageTs),
    index('slack_cards_thread_idx').on(table.threadId),
  ],
)
