import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, like, lt, notInArray, or, sql } from 'drizzle-orm'
import * as schema from '../node/schema'
import type { AgentEventPage, AgentEventRecord, AgentProviderDescriptor, AgentSession, AgentSessionList, AgentSessionSnapshot, AgentTurn } from '@acorn/protocol/managedAgents.ts'
import type { CreateAgentSessionInput, EnqueueAgentTurnInput } from '../shared/schemas'
import { mapAgentEvent, mapAgentRequest, mapAgentSession, mapAgentTurn } from './rowMapping'
import { AgentSessionRepository } from './sessionRepository'

type SessionListFilter = {
  taskId?: string
  workspaceId?: string
  archived?: boolean
  attention?: boolean
  search?: string
  cursor?: number
  limit?: number
}

const now = (): number => Date.now()

export class AgentStore extends AgentSessionRepository {

  async createSession(input: CreateAgentSessionInput, provider: AgentProviderDescriptor): Promise<AgentSession> {
    const timestamp = now()
    const id = randomUUID()
    await this.db.insert(schema.agentSessions).values({
      id,
      taskId: input.taskId,
      providerId: input.providerId,
      profileId: input.profileId,
      kind: input.kind,
      driverKind: provider.driverKind,
      driverVersion: provider.driverVersion,
      providerSessionRef: input.resumeProviderSessionRef ?? null,
      controller: 'acorn',
      runtimeState: provider.driverKind === 'terminal' ? 'stopped' : 'creating',
      attention: 'none',
      statusAuthority: provider.statusAuthority,
      title: input.title ?? 'New agent session',
      configJson: JSON.stringify(input.config),
      parentSessionId: input.parentSessionId ?? null,
      parentTurnId: input.parentTurnId ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    return this.requireSession(id)
  }

  async operationResult<T>(idempotencyKey: string, command: string): Promise<T | null> {
    const [row] = await this.db
      .select()
      .from(schema.agentOperations)
      .where(and(
        eq(schema.agentOperations.idempotencyKey, idempotencyKey),
        eq(schema.agentOperations.command, command),
      ))
      .limit(1)
    if (!row) return null
    try {
      return JSON.parse(row.resultJson) as T
    } catch {
      return null
    }
  }

  async saveOperation(
    idempotencyKey: string,
    command: string,
    result: unknown,
    resourceId?: string,
  ): Promise<void> {
    await this.db
      .insert(schema.agentOperations)
      .values({
        idempotencyKey,
        command,
        resourceId: resourceId ?? null,
        resultJson: JSON.stringify(result),
        createdAt: now(),
      })
      .onConflictDoNothing()
  }

  async listSessions(filter: SessionListFilter = {}): Promise<AgentSessionList> {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 100)
    // The fourth of the workspace joins (sessionRepository.ts holds the other three). Resolved to task
    // ids through core rather than joined, because `tasks` and workspace membership are in core's database
    // file and this table is in the plugin's. An empty workspace narrows to nothing — deliberately not
    // to "unfiltered", which is how an id round trip could silently leak another workspace's sessions
    // into the Agent Center.
    const taskIds = await this.workspaceTaskIds(filter.workspaceId)
    if (taskIds?.length === 0) return { sessions: [], nextCursor: null }
    // A session outlives its task's worktree but not its task. Archiving a task retires its agents
    // with it, so the live list — the Agent Center, the Fleet stat, the attention inbox and the
    // dashboard collection all read it — stops offering runs whose task is gone, and the archived
    // list picks them up on the other side. Resolved at read time rather than cascaded onto
    // `archivedAt` when the task is archived, because removing a project hard-deletes its tasks and
    // no cascade would ever visit those rows.
    //
    // A caller that already pinned a task is exempt: the task drawer is looking AT that task, and
    // asking core again per read would be a query for an answer the caller has.
    //
    // ponytail: one extra core read per list call. Fine while `active()` is a small table scan; if
    // it stops being one, core grows an `activeIds()` and this asks for that instead.
    const activeIds = filter.taskId ? null : (await this.core.tasks.active()).map((task) => task.id)
    const liveTask = activeIds && (activeIds.length ? inArray(schema.agentSessions.taskId, activeIds) : sql`0`)
    const retiredTask = activeIds && (activeIds.length ? notInArray(schema.agentSessions.taskId, activeIds) : sql`1`)
    const conditions = [
      filter.taskId ? eq(schema.agentSessions.taskId, filter.taskId) : undefined,
      taskIds ? inArray(schema.agentSessions.taskId, taskIds) : undefined,
      filter.archived
        ? or(isNotNull(schema.agentSessions.archivedAt), retiredTask || undefined)
        : and(isNull(schema.agentSessions.archivedAt), liveTask || undefined),
      filter.attention ? sql`${schema.agentSessions.attention} NOT IN ('none', 'unread')` : undefined,
      filter.cursor ? lt(schema.agentSessions.updatedAt, filter.cursor) : undefined,
      filter.search ? like(schema.agentSessions.title, `%${filter.search.replace(/[%_]/g, '\\$&')}%`) : undefined,
    ].filter((item): item is Exclude<typeof item, undefined> => item != null)

    const rows = await this.db
      .select()
      .from(schema.agentSessions)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.agentSessions.updatedAt))
      .limit(limit + 1)
    const hasMore = rows.length > limit
    const page = rows.slice(0, limit).map(mapAgentSession)
    return { sessions: page, nextCursor: hasMore ? String(page.at(-1)?.updatedAt ?? '') : null }
  }

  async snapshot(sessionId: string, afterSeq = 0, eventLimit = 500): Promise<AgentSessionSnapshot> {
    const session = await this.requireSession(sessionId)
    const [turnRows, eventRows, requestRows] = await Promise.all([
      this.db.select().from(schema.agentTurns).where(eq(schema.agentTurns.sessionId, sessionId)).orderBy(asc(schema.agentTurns.ordinal)),
      this.db
        .select()
        .from(schema.agentEvents)
        .where(and(eq(schema.agentEvents.sessionId, sessionId), gt(schema.agentEvents.seq, afterSeq)))
        .orderBy(asc(schema.agentEvents.seq))
        .limit(Math.min(Math.max(eventLimit, 1), 2_000)),
      this.db.select().from(schema.agentRequests).where(eq(schema.agentRequests.sessionId, sessionId)).orderBy(asc(schema.agentRequests.createdAt)),
    ])
    return {
      session,
      turns: turnRows.map(mapAgentTurn),
      events: eventRows.map(mapAgentEvent),
      requests: requestRows.map(mapAgentRequest),
    }
  }

  async exportSnapshot(sessionId: string): Promise<AgentSessionSnapshot> {
    const session = await this.requireSession(sessionId)
    const [turnRows, eventRows, requestRows] = await Promise.all([
      this.db.select().from(schema.agentTurns).where(eq(schema.agentTurns.sessionId, sessionId)).orderBy(asc(schema.agentTurns.ordinal)),
      this.db.select().from(schema.agentEvents).where(eq(schema.agentEvents.sessionId, sessionId)).orderBy(asc(schema.agentEvents.seq)),
      this.db.select().from(schema.agentRequests).where(eq(schema.agentRequests.sessionId, sessionId)).orderBy(asc(schema.agentRequests.createdAt)),
    ])
    return {
      session,
      turns: turnRows.map(mapAgentTurn),
      events: eventRows.map(mapAgentEvent),
      requests: requestRows.map(mapAgentRequest),
    }
  }

  async eventsForTurn(turnId: string, limit = 2_000): Promise<AgentEventRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.agentEvents)
      .where(eq(schema.agentEvents.turnId, turnId))
      .orderBy(asc(schema.agentEvents.seq))
      .limit(Math.min(Math.max(limit, 1), 10_000))
    return rows.map(mapAgentEvent)
  }

  async eventPage(sessionId: string, afterSeq = 0, limit = 500): Promise<AgentEventPage> {
    const bounded = Math.min(Math.max(limit, 1), 2_000)
    const rows = await this.db
      .select()
      .from(schema.agentEvents)
      .where(and(eq(schema.agentEvents.sessionId, sessionId), gt(schema.agentEvents.seq, afterSeq)))
      .orderBy(asc(schema.agentEvents.seq))
      .limit(bounded + 1)
    const page = rows.slice(0, bounded).map(mapAgentEvent)
    return { events: page, nextCursor: rows.length > bounded ? page.at(-1)?.seq ?? null : null }
  }

  async enqueueTurn(sessionId: string, input: EnqueueAgentTurnInput): Promise<AgentTurn> {
    const [existing] = await this.db
      .select()
      .from(schema.agentTurns)
      .where(and(eq(schema.agentTurns.sessionId, sessionId), eq(schema.agentTurns.idempotencyKey, input.idempotencyKey)))
      .limit(1)
    if (existing) return mapAgentTurn(existing)

    const attachmentParts = input.input.flatMap((part, position) =>
      part.type === 'attachment' || part.type === 'image'
        ? [{ id: part.attachmentId, position }]
        : [])
    const uniqueAttachmentIds = [...new Set(attachmentParts.map((part) => part.id))]
    let attachmentRows: Array<typeof schema.agentAttachments.$inferSelect> = []
    if (uniqueAttachmentIds.length > 8) throw new Error('A turn can include at most eight attachments.')
    if (uniqueAttachmentIds.length) {
      const [session] = await this.db
        .select({ taskId: schema.agentSessions.taskId })
        .from(schema.agentSessions)
        .where(eq(schema.agentSessions.id, sessionId))
        .limit(1)
      if (!session) throw new Error(`Managed agent session not found: ${sessionId}`)
      attachmentRows = await this.db
        .select()
        .from(schema.agentAttachments)
        .where(and(
          inArray(schema.agentAttachments.id, uniqueAttachmentIds),
          eq(schema.agentAttachments.taskId, session.taskId),
          isNull(schema.agentAttachments.deletedAt),
        ))
      if (attachmentRows.length !== uniqueAttachmentIds.length) {
        throw new Error('One or more attachments are missing or belong to another task.')
      }
      const aggregateBytes = attachmentRows.reduce((total, attachment) => total + attachment.byteSize, 0)
      if (aggregateBytes > 25 * 1024 * 1024) throw new Error('Turn attachments are limited to 25 MiB in total.')
    }

    const [maxRow] = await this.db
      .select({ ordinal: sql<number>`coalesce(max(${schema.agentTurns.ordinal}), -1)` })
      .from(schema.agentTurns)
      .where(eq(schema.agentTurns.sessionId, sessionId))
    const timestamp = now()
    const id = randomUUID()
    await this.db.insert(schema.agentTurns).values({
      id,
      sessionId,
      ordinal: Number(maxRow?.ordinal ?? -1) + 1,
      source: input.source,
      status: 'queued',
      inputJson: JSON.stringify(input.input),
      effectivePolicyJson: JSON.stringify(input.effectivePolicy),
      idempotencyKey: input.idempotencyKey,
      createdAt: timestamp,
    })
    if (uniqueAttachmentIds.length) {
      await this.db.insert(schema.agentAttachmentRefs).values(uniqueAttachmentIds.map((attachmentId) => ({
        attachmentId,
        turnId: id,
        position: attachmentParts.find((part) => part.id === attachmentId)?.position ?? 0,
      })))
    }
    if (Number(maxRow?.ordinal ?? -1) < 0) {
      const firstText = input.input.find((part) => part.type === 'text')?.text.trim()
      const deterministicTitle = firstText || attachmentRows[0]?.filename
      if (deterministicTitle) {
        const title = deterministicTitle.replace(/\s+/g, ' ').slice(0, 96)
        await this.db
          .update(schema.agentSessions)
          .set({ title, updatedAt: timestamp })
          .where(and(
            eq(schema.agentSessions.id, sessionId),
            eq(schema.agentSessions.title, 'New agent session'),
          ))
      }
    }
    const [row] = await this.db.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, id)).limit(1)
    if (!row) throw new Error('Queued turn was not persisted.')
    return mapAgentTurn(row)
  }

  async nextQueuedTurn(sessionId: string): Promise<AgentTurn | null> {
    const [row] = await this.db
      .select()
      .from(schema.agentTurns)
      .where(and(eq(schema.agentTurns.sessionId, sessionId), eq(schema.agentTurns.status, 'queued')))
      .orderBy(asc(schema.agentTurns.ordinal))
      .limit(1)
    return row ? mapAgentTurn(row) : null
  }

  async patchQueuedTurn(
    sessionId: string,
    turnId: string,
    patch: { input?: AgentTurn['input']; ordinal?: number },
  ): Promise<AgentTurn> {
    const [current] = await this.db
      .select()
      .from(schema.agentTurns)
      .where(and(eq(schema.agentTurns.id, turnId), eq(schema.agentTurns.sessionId, sessionId)))
      .limit(1)
    if (!current) throw new Error('Queued agent turn not found.')
    if (current.status !== 'queued') throw new Error('Only queued turns can be edited or reordered.')

    let attachmentParts: Array<{ id: string; position: number }> | null = null
    if (patch.input) {
      attachmentParts = patch.input.flatMap((part, position) =>
        part.type === 'attachment' || part.type === 'image'
          ? [{ id: part.attachmentId, position }]
          : [])
      const ids = [...new Set(attachmentParts.map((part) => part.id))]
      if (ids.length > 8) throw new Error('A turn can include at most eight attachments.')
      if (ids.length) {
        const [session] = await this.db
          .select({ taskId: schema.agentSessions.taskId })
          .from(schema.agentSessions)
          .where(eq(schema.agentSessions.id, sessionId))
          .limit(1)
        const attachments = session
          ? await this.db
              .select()
              .from(schema.agentAttachments)
              .where(and(
                inArray(schema.agentAttachments.id, ids),
                eq(schema.agentAttachments.taskId, session.taskId),
                isNull(schema.agentAttachments.deletedAt),
              ))
          : []
        if (attachments.length !== ids.length) {
          throw new Error('One or more attachments are missing or belong to another task.')
        }
        if (attachments.reduce((total, attachment) => total + attachment.byteSize, 0) > 25 * 1024 * 1024) {
          throw new Error('Turn attachments are limited to 25 MiB in total.')
        }
      }
    }

    this.db.transaction((tx) => {
      if (patch.input && attachmentParts) {
        tx.delete(schema.agentAttachmentRefs).where(eq(schema.agentAttachmentRefs.turnId, turnId)).run()
        const unique = [...new Set(attachmentParts.map((part) => part.id))]
        if (unique.length) {
          tx.insert(schema.agentAttachmentRefs).values(unique.map((attachmentId) => ({
            attachmentId,
            turnId,
            position: attachmentParts!.find((part) => part.id === attachmentId)?.position ?? 0,
          }))).run()
        }
        tx.update(schema.agentTurns)
          .set({ inputJson: JSON.stringify(patch.input) })
          .where(eq(schema.agentTurns.id, turnId))
          .run()
      }
      if (patch.ordinal != null) {
        const queued = tx
          .select({ id: schema.agentTurns.id, ordinal: schema.agentTurns.ordinal })
          .from(schema.agentTurns)
          .where(and(eq(schema.agentTurns.sessionId, sessionId), eq(schema.agentTurns.status, 'queued')))
          .orderBy(asc(schema.agentTurns.ordinal))
          .all()
        const target = queued.find((row) => row.id === turnId)
        if (target) {
          const ordered = queued.filter((row) => row.id !== turnId)
          ordered.splice(Math.min(patch.ordinal, ordered.length), 0, target)
          const slots = queued.map((row) => row.ordinal).sort((a, b) => a - b)
          ordered.forEach((row, index) => {
            tx.update(schema.agentTurns)
              .set({ ordinal: -1_000_000 - index })
              .where(eq(schema.agentTurns.id, row.id))
              .run()
          })
          ordered.forEach((row, index) => {
            tx.update(schema.agentTurns)
              .set({ ordinal: slots[index]! })
              .where(eq(schema.agentTurns.id, row.id))
              .run()
          })
        }
      }
    })
    const [updated] = await this.db.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, turnId)).limit(1)
    if (!updated) throw new Error('Queued agent turn disappeared while updating.')
    return mapAgentTurn(updated)
  }

  async startTurn(turnId: string): Promise<void> {
    await this.db
      .update(schema.agentTurns)
      .set({
        status: 'active',
        attempt: sql`${schema.agentTurns.attempt} + 1`,
        startedAt: now(),
        completedAt: null,
        errorJson: null,
      })
      .where(and(eq(schema.agentTurns.id, turnId), eq(schema.agentTurns.status, 'queued')))
  }

  async requeueTransientTurn(turnId: string, message: string): Promise<void> {
    await this.db
      .update(schema.agentTurns)
      .set({
        status: 'queued',
        providerTurnRef: null,
        startedAt: null,
        completedAt: null,
        errorJson: JSON.stringify({ code: 'safe_transient_retry', message }),
      })
      .where(and(eq(schema.agentTurns.id, turnId), eq(schema.agentTurns.status, 'active')))
  }

  async setTurnProviderRef(turnId: string, providerTurnRef: string): Promise<void> {
    await this.db
      .update(schema.agentTurns)
      .set({ providerTurnRef })
      .where(eq(schema.agentTurns.id, turnId))
  }

  async cancelTurn(turnId: string): Promise<void> {
    await this.db
      .update(schema.agentTurns)
      .set({ status: 'cancelled', completedAt: now() })
      .where(and(eq(schema.agentTurns.id, turnId), inArray(schema.agentTurns.status, ['queued', 'dispatching', 'active'])))
  }

  async interruptActiveTurn(sessionId: string, message: string): Promise<void> {
    await this.db
      .update(schema.agentTurns)
      .set({
        status: 'interrupted',
        errorJson: JSON.stringify({ code: 'provider_disconnected', message }),
        completedAt: now(),
      })
      .where(and(
        eq(schema.agentTurns.sessionId, sessionId),
        inArray(schema.agentTurns.status, ['dispatching', 'active']),
      ))
  }

  async queuedHeads(): Promise<Array<{ session: AgentSession; turn: AgentTurn }>> {
    const sessions = await this.db
      .select()
      .from(schema.agentSessions)
      .where(and(
        isNull(schema.agentSessions.archivedAt),
        eq(schema.agentSessions.controller, 'acorn'),
      ))
    const result: Array<{ session: AgentSession; turn: AgentTurn }> = []
    for (const row of sessions) {
      const turn = await this.nextQueuedTurn(row.id)
      if (turn) result.push({ session: mapAgentSession(row), turn })
    }
    return result
  }

  async hasProviderExecutionHistory(sessionId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: schema.agentTurns.id })
      .from(schema.agentTurns)
      .where(and(
        eq(schema.agentTurns.sessionId, sessionId),
        or(
          isNotNull(schema.agentTurns.providerTurnRef),
          inArray(schema.agentTurns.status, ['dispatching', 'active', 'completed', 'failed', 'interrupted']),
        ),
      ))
      .limit(1)
    return row != null
  }

  async unsettledSessions(): Promise<AgentSession[]> {
    const rows = await this.db
      .select()
      .from(schema.agentSessions)
      .where(inArray(schema.agentSessions.runtimeState, [
        'creating',
        'connecting',
        'replaying',
        'working',
        'waiting',
        'cancelling',
        'reconnecting',
      ]))
    return rows.map(mapAgentSession)
  }


}
