import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm'
import type { AppDatabase } from '../../../core/server/db'
import { schema } from '../../../core/server/db'
import type {
  AgentEventRecord,
  AgentNormalizedEvent,
  AgentRequest,
  AgentSession,
  AgentTurn,
} from '@acorn/protocol/managedAgents.ts'
import { AGENT_EVENT_SCHEMA_VERSION, agentEventSearchText } from '@acorn/protocol/managedAgents.ts'
import { mapAgentEvent, mapAgentRequest, mapAgentSession, mapAgentTurn } from './rowMapping'
import type { RemovedArtifactObject } from './artifactStore'
import { projectAgentEvent } from './stateMachine'

const now = (): number => Date.now()

type SessionSearchFilter = {
  taskId?: string
  workspaceId?: string
  limit?: number
}

/**
 * Session projection, request-resolution, deletion, and search repository.
 *
 * The append-only event transaction lives here because it is the authority that advances the
 * session sequence and all query projections atomically. Turn queue operations remain in
 * AgentStore; both slices share one inherited database handle.
 */
export class AgentSessionRepository {
  constructor(protected readonly db: AppDatabase) {}

  async getSession(id: string): Promise<AgentSession | null> {
    const [row] = await this.db.select().from(schema.agentSessions).where(eq(schema.agentSessions.id, id)).limit(1)
    return row ? mapAgentSession(row) : null
  }

  async requireSession(id: string): Promise<AgentSession> {
    const session = await this.getSession(id)
    if (!session) throw new Error(`Managed agent session not found: ${id}`)
    return session
  }

  async recordEvent(sessionId: string, turnId: string | null, event: AgentNormalizedEvent): Promise<AgentEventRecord> {
    const timestamp = now()
    const projection = projectAgentEvent(event)
    const eventId = randomUUID()
    const row = this.db.transaction((tx) => {
      const current = tx
        .select({
          lastEventSeq: schema.agentSessions.lastEventSeq,
          configJson: schema.agentSessions.configJson,
        })
        .from(schema.agentSessions)
        .where(eq(schema.agentSessions.id, sessionId))
        .get()
      if (!current) throw new Error(`Managed agent session not found: ${sessionId}`)
      const seq = current.lastEventSeq + 1
      const configJson = event.type === 'session_metadata'
        ? JSON.stringify({
            ...JSON.parse(current.configJson) as Record<string, unknown>,
            ...(event.configOptions ? { configOptions: event.configOptions } : {}),
            ...(event.commands ? { commands: event.commands } : {}),
            ...(event.skills ? { skills: event.skills } : {}),
          })
        : projection.configJson
      tx.update(schema.agentSessions)
        .set({
          lastEventSeq: seq,
          updatedAt: timestamp,
          ...(projection.runtimeState ? { runtimeState: projection.runtimeState } : {}),
          ...(projection.attention ? { attention: projection.attention } : {}),
          ...(projection.providerSessionRef ? { providerSessionRef: projection.providerSessionRef } : {}),
          ...(configJson ? { configJson } : {}),
        })
        .where(eq(schema.agentSessions.id, sessionId))
        .run()

      const values: typeof schema.agentEvents.$inferInsert = {
        id: eventId,
        sessionId,
        turnId,
        seq,
        schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
        eventJson: JSON.stringify(event),
        searchText: agentEventSearchText(event),
        createdAt: timestamp,
      }
      tx.insert(schema.agentEvents).values(values).run()
      this.applyEventProjection(tx, sessionId, turnId, event, timestamp)
      return { ...values, turnId: values.turnId ?? null, searchText: values.searchText ?? null }
    })
    return mapAgentEvent(row)
  }

  private applyEventProjection(
    tx: Parameters<Parameters<AppDatabase['transaction']>[0]>[0],
    sessionId: string,
    turnId: string | null,
    event: AgentNormalizedEvent,
    timestamp: number,
  ): void {
    if (event.type === 'request') {
      tx.insert(schema.agentRequests)
        .values({
          id: randomUUID(),
          sessionId,
          turnId,
          providerRequestId: event.requestId,
          kind: event.kind,
          status: 'pending',
          title: event.title,
          detail: event.detail ?? null,
          payloadJson: JSON.stringify({ options: event.options ?? [], questions: event.questions ?? [] }),
          createdAt: timestamp,
        })
        .onConflictDoNothing()
        .run()
    } else if (event.type === 'request_resolved') {
      tx.update(schema.agentRequests)
        .set({ status: 'resolved', resolutionJson: JSON.stringify(event.resolution), resolvedAt: timestamp })
        .where(and(eq(schema.agentRequests.sessionId, sessionId), eq(schema.agentRequests.providerRequestId, event.requestId)))
        .run()
    } else if (event.type === 'turn_completed' && turnId) {
      tx.update(schema.agentTurns)
        .set({ status: 'completed', stopReason: event.stopReason ?? null, completedAt: timestamp })
        .where(eq(schema.agentTurns.id, turnId))
        .run()
    } else if (event.type === 'usage' && turnId) {
      tx.update(schema.agentTurns)
        .set({ usageJson: JSON.stringify(event.usage) })
        .where(eq(schema.agentTurns.id, turnId))
        .run()
    } else if (event.type === 'error' && turnId) {
      tx.update(schema.agentTurns)
        .set({
          status: event.retryable ? 'interrupted' : 'failed',
          errorJson: JSON.stringify({ code: event.code, message: event.message }),
          completedAt: timestamp,
        })
        .where(eq(schema.agentTurns.id, turnId))
        .run()
    }
  }

  async claimRequestResolution(
    sessionId: string,
    providerRequestId: string,
    resolution: unknown,
    idempotencyKey: string,
  ): Promise<{ request: AgentRequest; claimed: boolean }> {
    return this.db.transaction((tx) => {
      const request = tx
        .select()
        .from(schema.agentRequests)
        .where(and(
          eq(schema.agentRequests.sessionId, sessionId),
          eq(schema.agentRequests.providerRequestId, providerRequestId),
        ))
        .get()
      if (!request) throw new Error('Agent request not found.')
      if (request.status === 'resolved' || request.status === 'expired') {
        return { request: mapAgentRequest(request), claimed: false }
      }
      if (request.status === 'resolving') {
        if (request.resolutionIdempotencyKey !== idempotencyKey) {
          throw new Error('Agent request resolution is already in progress.')
        }
        return { request: mapAgentRequest(request), claimed: false }
      }
      tx.update(schema.agentRequests)
        .set({
          status: 'resolving',
          resolutionJson: JSON.stringify(resolution),
          resolutionIdempotencyKey: idempotencyKey,
        })
        .where(and(eq(schema.agentRequests.id, request.id), eq(schema.agentRequests.status, 'pending')))
        .run()
      const claimed = tx
        .select()
        .from(schema.agentRequests)
        .where(eq(schema.agentRequests.id, request.id))
        .get()
      if (!claimed) throw new Error('Claimed agent request disappeared.')
      return { request: mapAgentRequest(claimed), claimed: true }
    })
  }

  async request(sessionId: string, providerRequestId: string): Promise<AgentRequest | null> {
    const [request] = await this.db
      .select()
      .from(schema.agentRequests)
      .where(and(
        eq(schema.agentRequests.sessionId, sessionId),
        eq(schema.agentRequests.providerRequestId, providerRequestId),
      ))
      .limit(1)
    return request ? mapAgentRequest(request) : null
  }

  async expireClaimedRequest(sessionId: string, providerRequestId: string): Promise<void> {
    await this.db
      .update(schema.agentRequests)
      .set({ status: 'expired', resolvedAt: now() })
      .where(and(
        eq(schema.agentRequests.sessionId, sessionId),
        eq(schema.agentRequests.providerRequestId, providerRequestId),
        eq(schema.agentRequests.status, 'resolving'),
      ))
  }

  async expirePendingRequests(sessionId: string): Promise<void> {
    await this.db
      .update(schema.agentRequests)
      .set({ status: 'expired', resolvedAt: now() })
      .where(and(
        eq(schema.agentRequests.sessionId, sessionId),
        inArray(schema.agentRequests.status, ['pending', 'resolving']),
      ))
  }

  async patchSession(
    sessionId: string,
    patch: { title?: string; archived?: boolean; lastReadSeq?: number; config?: Record<string, unknown> },
  ): Promise<AgentSession> {
    const timestamp = now()
    await this.db
      .update(schema.agentSessions)
      .set({
        updatedAt: timestamp,
        ...(patch.title ? { title: patch.title } : {}),
        ...(patch.archived != null
          ? {
              archivedAt: patch.archived ? timestamp : null,
              runtimeState: patch.archived ? 'archived' : 'stopped',
            }
          : {}),
        ...(patch.lastReadSeq != null
          ? {
              lastReadSeq: patch.lastReadSeq,
              attention: 'none',
            }
          : {}),
        ...(patch.config ? { configJson: JSON.stringify(patch.config) } : {}),
      })
      .where(eq(schema.agentSessions.id, sessionId))
    return this.requireSession(sessionId)
  }

  async setController(sessionId: string, controller: AgentSession['controller']): Promise<AgentSession> {
    await this.db
      .update(schema.agentSessions)
      .set({ controller, updatedAt: now() })
      .where(eq(schema.agentSessions.id, sessionId))
    return this.requireSession(sessionId)
  }

  async setProviderSessionReference(
    sessionId: string,
    providerSessionRef: string | null,
  ): Promise<AgentSession> {
    await this.db
      .update(schema.agentSessions)
      .set({ providerSessionRef, updatedAt: now() })
      .where(eq(schema.agentSessions.id, sessionId))
    return this.requireSession(sessionId)
  }

  async deleteSession(sessionId: string): Promise<{
    attachmentIds: string[]
    artifactObjects: RemovedArtifactObject[]
  }> {
    const turns = await this.db.select({ id: schema.agentTurns.id }).from(schema.agentTurns).where(eq(schema.agentTurns.sessionId, sessionId))
    const turnIds = turns.map((turn) => turn.id)
    const [attachmentRows, artifactRows] = await Promise.all([
      turnIds.length
        ? this.db
            .selectDistinct({ attachmentId: schema.agentAttachmentRefs.attachmentId })
            .from(schema.agentAttachmentRefs)
            .where(inArray(schema.agentAttachmentRefs.turnId, turnIds))
        : Promise.resolve([]),
      this.db
        .select({ id: schema.agentArtifacts.id, storageKey: schema.agentArtifacts.storageKey })
        .from(schema.agentArtifacts)
        .where(eq(schema.agentArtifacts.sessionId, sessionId)),
    ])
    this.db.transaction((tx) => {
      if (turnIds.length) tx.delete(schema.agentAttachmentRefs).where(inArray(schema.agentAttachmentRefs.turnId, turnIds)).run()
      tx.delete(schema.agentArtifacts).where(eq(schema.agentArtifacts.sessionId, sessionId)).run()
      tx.delete(schema.agentRequests).where(eq(schema.agentRequests.sessionId, sessionId)).run()
      tx.delete(schema.agentEvents).where(eq(schema.agentEvents.sessionId, sessionId)).run()
      tx.delete(schema.agentTurns).where(eq(schema.agentTurns.sessionId, sessionId)).run()
      tx.delete(schema.agentSessions).where(eq(schema.agentSessions.id, sessionId)).run()
    })
    return {
      attachmentIds: attachmentRows.map((row) => row.attachmentId),
      artifactObjects: artifactRows,
    }
  }

  async searchSessions(query: string, filter: SessionSearchFilter = {}): Promise<AgentSession[]> {
    const bounded = Math.min(Math.max(filter.limit ?? 50, 1), 100)
    const terms = query
      .split(/\s+/)
      .map((term) => term.replace(/"/g, ''))
      .filter(Boolean)
      .map((term) => `"${term}"`)
      .join(' ')
    if (!terms) return []
    const escapedLike = `%${query.replace(/[%_]/g, '\\$&')}%`
    const [eventMatches, artifactMatches] = await Promise.all([
      filter.workspaceId
        ? this.db.all<{ sessionId: string; rank: number }>(sql`
            SELECT agent_events_fts.session_id AS sessionId, min(agent_events_fts.rank) AS rank
            FROM agent_events_fts
            INNER JOIN agent_sessions ON agent_sessions.id = agent_events_fts.session_id
            INNER JOIN tasks ON tasks.id = agent_sessions.task_id
            INNER JOIN workspace_repos
              ON workspace_repos.repo_owner = tasks.repo_owner
              AND workspace_repos.repo_name = tasks.repo_name
            WHERE agent_events_fts MATCH ${terms}
              AND workspace_repos.workspace_id = ${filter.workspaceId}
            GROUP BY agent_events_fts.session_id
            ORDER BY rank
            LIMIT 200
          `)
        : this.db.all<{ sessionId: string; rank: number }>(sql`
            SELECT session_id AS sessionId, min(rank) AS rank
            FROM agent_events_fts
            WHERE agent_events_fts MATCH ${terms}
            GROUP BY session_id
            ORDER BY rank
            LIMIT 200
          `),
      filter.workspaceId
        ? this.db
            .selectDistinct({ sessionId: schema.agentArtifacts.sessionId })
            .from(schema.agentArtifacts)
            .innerJoin(schema.agentSessions, eq(schema.agentSessions.id, schema.agentArtifacts.sessionId))
            .innerJoin(schema.tasks, eq(schema.tasks.id, schema.agentSessions.taskId))
            .innerJoin(
              schema.workspaceRepos,
              and(
                eq(schema.workspaceRepos.repoOwner, schema.tasks.repoOwner),
                eq(schema.workspaceRepos.repoName, schema.tasks.repoName),
              ),
            )
            .where(and(
              eq(schema.workspaceRepos.workspaceId, filter.workspaceId),
              or(
                like(schema.agentArtifacts.title, escapedLike),
                like(schema.agentArtifacts.metadataJson, escapedLike),
              ),
            ))
            .limit(200)
        : this.db
            .selectDistinct({ sessionId: schema.agentArtifacts.sessionId })
            .from(schema.agentArtifacts)
            .where(or(
              like(schema.agentArtifacts.title, escapedLike),
              like(schema.agentArtifacts.metadataJson, escapedLike),
            ))
            .limit(200),
    ])
    const rankBySession = new Map(eventMatches.map((match) => [match.sessionId, match.rank]))
    const matchedIds = [...new Set([
      ...eventMatches.map((match) => match.sessionId),
      ...artifactMatches.map((match) => match.sessionId),
    ])]
    const textMatch = matchedIds.length
      ? or(like(schema.agentSessions.title, escapedLike), inArray(schema.agentSessions.id, matchedIds))
      : like(schema.agentSessions.title, escapedLike)
    const baseWhere = and(
      isNull(schema.agentSessions.archivedAt),
      filter.taskId ? eq(schema.agentSessions.taskId, filter.taskId) : undefined,
      textMatch,
    )
    const rows = filter.workspaceId
      ? (await this.db
          .select({ session: schema.agentSessions })
          .from(schema.agentSessions)
          .innerJoin(schema.tasks, eq(schema.tasks.id, schema.agentSessions.taskId))
          .innerJoin(
            schema.workspaceRepos,
            and(
              eq(schema.workspaceRepos.repoOwner, schema.tasks.repoOwner),
              eq(schema.workspaceRepos.repoName, schema.tasks.repoName),
            ),
          )
          .where(and(baseWhere, eq(schema.workspaceRepos.workspaceId, filter.workspaceId)))
          .limit(200))
          .map((item) => item.session)
      : await this.db
          .select()
          .from(schema.agentSessions)
          .where(baseWhere)
          .limit(200)
    return rows
      .sort((a, b) => {
        const aRank = rankBySession.get(a.id) ?? Number.POSITIVE_INFINITY
        const bRank = rankBySession.get(b.id) ?? Number.POSITIVE_INFINITY
        return aRank - bRank || b.updatedAt - a.updatedAt
      })
      .slice(0, bounded)
      .map(mapAgentSession)
  }

  async activeTurn(sessionId: string): Promise<AgentTurn | null> {
    const [row] = await this.db
      .select()
      .from(schema.agentTurns)
      .where(and(eq(schema.agentTurns.sessionId, sessionId), inArray(schema.agentTurns.status, ['dispatching', 'active'])))
      .limit(1)
    return row ? mapAgentTurn(row) : null
  }

  async pendingRequests(sessionId: string): Promise<AgentRequest[]> {
    const rows = await this.db
      .select()
      .from(schema.agentRequests)
      .where(and(eq(schema.agentRequests.sessionId, sessionId), eq(schema.agentRequests.status, 'pending')))
      .orderBy(asc(schema.agentRequests.createdAt))
    return rows.map(mapAgentRequest)
  }
}
