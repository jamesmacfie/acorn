import { and, asc, eq, inArray, lte, max } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import {
  slackChannels,
  slackChannelTasks,
  slackLinks,
  slackMessages,
  slackPending,
  slackThreadSessions,
  slackThreads,
  slackTurns,
} from '../node/schema'

// The plugin's rows, read and written in one place. Everything is keyed by session where a turn is
// concerned: a thread maps to its sessions, never to a task alone (docs/integrations/slack.md § Room
// for forks and several agents).

export type Channel = typeof slackChannels.$inferSelect
export type Thread = typeof slackThreads.$inferSelect
export type Message = typeof slackMessages.$inferSelect
export type Turn = typeof slackTurns.$inferSelect
export type Mode = Thread['mode']

export type SlackStore = ReturnType<typeof slackStore>

export function slackStore(db: PluginDatabase) {
  const threadSession = async (threadId: string): Promise<string | null> =>
    (
      await db
        .select({ sessionId: slackThreadSessions.sessionId })
        .from(slackThreadSessions)
        .where(eq(slackThreadSessions.threadId, threadId))
        .orderBy(asc(slackThreadSessions.ordinal))
        .get()
    )?.sessionId ?? null

  return {
    // --- Links ---
    hasLinks: async () => !!(await db.select({ teamId: slackLinks.teamId }).from(slackLinks).get()),
    links: () => db.select().from(slackLinks).all(),
    link: async (teamId: string) =>
      (await db.select().from(slackLinks).where(eq(slackLinks.teamId, teamId)).get()) ?? null,
    /** The gateway's links for this Node, made the local truth. A team linked again keeps its approvals choice. */
    async syncLinks(
      here: { teamId: string; teamName: string; slackUserId: string; slackUserName: string }[],
      approvals: boolean,
    ) {
      const current = await db.select().from(slackLinks).all()
      for (const link of current)
        if (!here.some((next) => next.teamId === link.teamId && next.slackUserId === link.slackUserId))
          await db.delete(slackLinks).where(eq(slackLinks.teamId, link.teamId))
      for (const link of here) {
        const known = current.find((row) => row.teamId === link.teamId && row.slackUserId === link.slackUserId)
        if (known) await db.update(slackLinks).set(link).where(eq(slackLinks.teamId, link.teamId))
        else await db.insert(slackLinks).values({ ...link, approvals, createdAt: Date.now() })
      }
    },
    removeLink: (teamId: string) => db.delete(slackLinks).where(eq(slackLinks.teamId, teamId)),
    setApprovals: (teamId: string, approvals: boolean) =>
      db.update(slackLinks).set({ approvals }).where(eq(slackLinks.teamId, teamId)),

    // --- Channels ---
    channel: async (teamId: string, channelId: string): Promise<Channel | null> =>
      (await db
        .select()
        .from(slackChannels)
        .where(and(eq(slackChannels.teamId, teamId), eq(slackChannels.channelId, channelId)))
        .get()) ?? null,
    setChannel: (teamId: string, channelId: string, patch: Partial<Pick<Channel, 'name' | 'projectId' | 'mode'>>) =>
      db
        .insert(slackChannels)
        .values({ teamId, channelId, name: null, projectId: null, mode: null, ...patch })
        .onConflictDoUpdate({ target: [slackChannels.teamId, slackChannels.channelId], set: patch }),
    channelTask: async (teamId: string, channelId: string, projectId: string) =>
      (await db
        .select()
        .from(slackChannelTasks)
        .where(
          and(
            eq(slackChannelTasks.teamId, teamId),
            eq(slackChannelTasks.channelId, channelId),
            eq(slackChannelTasks.projectId, projectId),
          ),
        )
        .get()) ?? null,
    setChannelTask: (row: typeof slackChannelTasks.$inferInsert) =>
      db
        .insert(slackChannelTasks)
        .values(row)
        .onConflictDoUpdate({
          target: [slackChannelTasks.teamId, slackChannelTasks.channelId, slackChannelTasks.projectId],
          set: { taskId: row.taskId, createdAt: row.createdAt },
        }),

    // --- Threads and their sessions ---
    activeThread: async (teamId: string, channelId: string, threadTs: string): Promise<Thread | null> =>
      (await db
        .select()
        .from(slackThreads)
        .where(
          and(
            eq(slackThreads.teamId, teamId),
            eq(slackThreads.channelId, channelId),
            eq(slackThreads.threadTs, threadTs),
            eq(slackThreads.ended, false),
          ),
        )
        .get()) ?? null,
    thread: async (id: string) => (await db.select().from(slackThreads).where(eq(slackThreads.id, id)).get()) ?? null,
    activeThreads: () => db.select().from(slackThreads).where(eq(slackThreads.ended, false)).all(),
    threadsOfTask: (taskId: string) =>
      db
        .select()
        .from(slackThreads)
        .where(and(eq(slackThreads.taskId, taskId), eq(slackThreads.ended, false)))
        .all(),
    insertThread: (row: typeof slackThreads.$inferInsert) => db.insert(slackThreads).values(row),
    endThread: (id: string) => db.update(slackThreads).set({ ended: true }).where(eq(slackThreads.id, id)),
    noteGuest: (thread: Thread, userId: string) =>
      db
        .update(slackThreads)
        .set({ notedGuests: JSON.stringify([...(JSON.parse(thread.notedGuests) as string[]), userId]) })
        .where(eq(slackThreads.id, thread.id)),
    threadSession,
    /** The thread a session belongs to, or null for a session Slack didn't start. */
    threadOfSession: async (sessionId: string): Promise<Thread | null> => {
      const joined = await db
        .select({ thread: slackThreads })
        .from(slackThreadSessions)
        .innerJoin(slackThreads, eq(slackThreads.id, slackThreadSessions.threadId))
        .where(eq(slackThreadSessions.sessionId, sessionId))
        .get()
      return joined?.thread ?? null
    },
    async addThreadSession(threadId: string, sessionId: string) {
      const last = await db
        .select({ ordinal: max(slackThreadSessions.ordinal) })
        .from(slackThreadSessions)
        .where(eq(slackThreadSessions.threadId, threadId))
        .get()
      await db
        .insert(slackThreadSessions)
        .values({ threadId, sessionId, ordinal: (last?.ordinal ?? -1) + 1 })
        .onConflictDoNothing()
    },

    // --- Messages ---
    seen: async (teamId: string, channelId: string, ts: string) =>
      !!(await db
        .select({ ts: slackMessages.ts })
        .from(slackMessages)
        .where(and(eq(slackMessages.teamId, teamId), eq(slackMessages.channelId, channelId), eq(slackMessages.ts, ts)))
        .get()),
    message: async (teamId: string, channelId: string, ts: string) =>
      (await db
        .select()
        .from(slackMessages)
        .where(and(eq(slackMessages.teamId, teamId), eq(slackMessages.channelId, channelId), eq(slackMessages.ts, ts)))
        .get()) ?? null,
    insertMessage: (row: typeof slackMessages.$inferInsert) =>
      db.insert(slackMessages).values(row).onConflictDoNothing(),
    updateMessage: (key: Pick<Message, 'teamId' | 'channelId' | 'ts'>, patch: Partial<Message>) =>
      db
        .update(slackMessages)
        .set(patch)
        .where(
          and(
            eq(slackMessages.teamId, key.teamId),
            eq(slackMessages.channelId, key.channelId),
            eq(slackMessages.ts, key.ts),
          ),
        ),
    /** The owner's oldest message still waiting to run in this thread. */
    nextOwnerMessage: async (threadId: string): Promise<Message | null> =>
      (await db
        .select()
        .from(slackMessages)
        .where(
          and(
            eq(slackMessages.threadId, threadId),
            eq(slackMessages.role, 'owner'),
            eq(slackMessages.status, 'waiting'),
          ),
        )
        .orderBy(asc(slackMessages.ts))
        .get()) ?? null,
    waitingGuests: (threadId: string) =>
      db
        .select()
        .from(slackMessages)
        .where(
          and(
            eq(slackMessages.threadId, threadId),
            eq(slackMessages.role, 'guest'),
            eq(slackMessages.status, 'waiting'),
          ),
        )
        .orderBy(asc(slackMessages.ts))
        .all(),
    markGuestsContext: (threadId: string, turnId: string, upTo: string[]) =>
      upTo.length
        ? db
            .update(slackMessages)
            .set({ status: 'context', turnId })
            .where(and(eq(slackMessages.threadId, threadId), inArray(slackMessages.ts, upTo)))
        : Promise.resolve(),

    // --- Pending project picks ---
    insertPending: (row: typeof slackPending.$inferInsert) => db.insert(slackPending).values(row),
    pending: async (id: string) => (await db.select().from(slackPending).where(eq(slackPending.id, id)).get()) ?? null,
    removePending: (id: string) => db.delete(slackPending).where(eq(slackPending.id, id)),
    removeExpiredPending: (now: number) => db.delete(slackPending).where(lte(slackPending.expiresAt, now)),

    // --- Turns ---
    turn: async (turnId: string): Promise<Turn | null> =>
      (await db.select().from(slackTurns).where(eq(slackTurns.turnId, turnId)).get()) ?? null,
    insertTurn: (row: typeof slackTurns.$inferInsert) => db.insert(slackTurns).values(row).onConflictDoNothing(),
    updateTurn: (turnId: string, patch: Partial<Turn>) =>
      db.update(slackTurns).set(patch).where(eq(slackTurns.turnId, turnId)),
    /** The session's turn whose answer hasn't posted: the one running, if any. */
    openTurn: async (sessionId: string): Promise<Turn | null> =>
      (await db
        .select()
        .from(slackTurns)
        .where(and(eq(slackTurns.sessionId, sessionId), eq(slackTurns.posted, false)))
        .orderBy(asc(slackTurns.startedAt))
        .get()) ?? null,
    unpostedTurns: () => db.select().from(slackTurns).where(eq(slackTurns.posted, false)).all(),

    // --- Removal ---
    /** A deleted task's threads and everything under them. Returns how many threads went. */
    async purgeTasks(taskIds: string[]): Promise<number> {
      const threads = await db
        .select({ id: slackThreads.id })
        .from(slackThreads)
        .where(inArray(slackThreads.taskId, taskIds))
        .all()
      const ids = threads.map((thread) => thread.id)
      if (ids.length) {
        await db.delete(slackTurns).where(inArray(slackTurns.threadId, ids))
        await db.delete(slackMessages).where(inArray(slackMessages.threadId, ids))
        await db.delete(slackThreadSessions).where(inArray(slackThreadSessions.threadId, ids))
        await db.delete(slackThreads).where(inArray(slackThreads.id, ids))
      }
      await db.delete(slackChannelTasks).where(inArray(slackChannelTasks.taskId, taskIds))
      return ids.length
    },
  }
}
