import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, lte, max } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import {
  slackCards,
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

type Link = typeof slackLinks.$inferSelect
export type Channel = typeof slackChannels.$inferSelect
export type Thread = typeof slackThreads.$inferSelect
export type Message = typeof slackMessages.$inferSelect
export type Turn = typeof slackTurns.$inferSelect
type Card = typeof slackCards.$inferSelect
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
    /** What the gateway reports for this Node can only take local links away or rename them. A link it no
     *  longer reports, or reports for another Slack user, is gone. A new one waits for `confirmLink`. */
    async reconcileLinks(here: { teamId: string; teamName: string; slackUserId: string; slackUserName: string }[]) {
      for (const link of await db.select().from(slackLinks).all()) {
        const reported = here.find((next) => next.teamId === link.teamId && next.slackUserId === link.slackUserId)
        if (!reported) await db.delete(slackLinks).where(eq(slackLinks.teamId, link.teamId))
        else
          await db
            .update(slackLinks)
            .set({ teamName: reported.teamName, slackUserName: reported.slackUserName })
            .where(eq(slackLinks.teamId, link.teamId))
      }
    },
    /** A link a paired device confirmed, with the approvals choice made beside it. The same Slack user
     *  confirmed again keeps the link ID, and with it the threads already going. */
    async confirmLink(
      link: { teamId: string; teamName: string; slackUserId: string; slackUserName: string },
      approvals: boolean,
    ) {
      const { teamId, teamName, slackUserId, slackUserName } = link
      const current = await db.select().from(slackLinks).where(eq(slackLinks.teamId, teamId)).get()
      if (current?.slackUserId === slackUserId)
        return db.update(slackLinks).set({ teamName, slackUserName, approvals }).where(eq(slackLinks.teamId, teamId))
      await db.delete(slackLinks).where(eq(slackLinks.teamId, teamId))
      await db.insert(slackLinks).values({
        teamId,
        teamName,
        slackUserId,
        slackUserName,
        linkId: randomUUID(),
        approvals,
        createdAt: Date.now(),
      })
    },
    /** The link a thread or pick was made under, or null once that link is unlinked or replaced. */
    linkOf: async (made: { teamId: string; linkId: string }): Promise<Link | null> => {
      const link = await db.select().from(slackLinks).where(eq(slackLinks.teamId, made.teamId)).get()
      return link?.linkId === made.linkId ? link : null
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
    setChannel: (
      teamId: string,
      channelId: string,
      patch: Partial<Pick<Channel, 'name' | 'projectId' | 'mode' | 'guests'>>,
    ) =>
      db
        .insert(slackChannels)
        .values({ teamId, channelId, name: null, projectId: null, mode: null, guests: false, ...patch })
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

    // --- Approval cards ---
    card: async (requestId: string): Promise<Card | null> =>
      (await db.select().from(slackCards).where(eq(slackCards.requestId, requestId)).get()) ?? null,
    /** The card at this Slack message, or null for any message the plugin didn't post a card as. */
    cardAt: async (teamId: string, channelId: string, messageTs: string): Promise<Card | null> =>
      (await db
        .select()
        .from(slackCards)
        .where(
          and(eq(slackCards.teamId, teamId), eq(slackCards.channelId, channelId), eq(slackCards.messageTs, messageTs)),
        )
        .get()) ?? null,
    insertCard: (row: typeof slackCards.$inferInsert) => db.insert(slackCards).values(row).onConflictDoNothing(),
    /** Take the card's one answer. False when another click already took it. */
    claimCard: async (requestId: string): Promise<boolean> =>
      (
        await db
          .update(slackCards)
          .set({ answered: true })
          .where(and(eq(slackCards.requestId, requestId), eq(slackCards.answered, false)))
          .returning({ requestId: slackCards.requestId })
      ).length > 0,
    releaseCard: (requestId: string) =>
      db.update(slackCards).set({ answered: false }).where(eq(slackCards.requestId, requestId)),

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
        await db.delete(slackCards).where(inArray(slackCards.threadId, ids))
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
