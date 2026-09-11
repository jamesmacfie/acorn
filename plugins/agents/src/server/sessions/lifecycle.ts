import { and, asc, eq } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import * as schema from '../../node/schema'
import type { AgentRequest, AgentSession, AgentTurn } from '@acorn/protocol/managedAgents.ts'
import type {
  AgentLifecyclePublisher,
  AgentRequestState,
  AgentSessionRosterEntry,
  AgentTurnState,
} from '../../contract/lifecycle'
import { mapAgentRequest, mapAgentSession, mapAgentTurn } from './rowMapping'

/**
 * The one post-commit projection from managed-agent rows to the public lifecycle catalogue.
 * Persistence owners call the announce methods only after their transaction has committed; capability
 * readers use the same projections, so an event payload and a subsequent read cannot disagree.
 */
export class AgentLifecycle {
  constructor(
    private readonly db: PluginDatabase,
    private readonly publish?: AgentLifecyclePublisher,
  ) {}

  announceSession(session: AgentSession, present = true): void {
    this.publish?.({
      channel: 'plugin:agents:sessions-changed',
      taskId: session.taskId,
      sessionId: session.id,
      present,
      archived: session.archivedAt != null,
    })
  }

  async announceTurn(turnId: string): Promise<void> {
    if (!this.publish) return
    const row = await this.turnRow(turnId)
    if (!row) return
    this.publish({
      channel: 'plugin:agents:turn-changed',
      taskId: row.taskId,
      sessionId: row.turn.sessionId,
      turnId: row.turn.id,
      source: row.turn.source,
      status: row.turn.status,
      attempt: row.turn.attempt,
    })
  }

  async announceRequest(sessionId: string, providerRequestId: string): Promise<void> {
    if (!this.publish) return
    const row = await this.requestRow(sessionId, providerRequestId)
    if (!row) return
    this.publish({
      channel: 'plugin:agents:request-changed',
      taskId: row.taskId,
      sessionId: row.request.sessionId,
      requestId: row.request.providerRequestId,
      kind: row.request.kind,
      status: row.request.status,
    })
  }

  async turns(filter: { taskId: string; sessionId?: string }): Promise<AgentTurnState[]> {
    const rows = await this.db
      .select({ turn: schema.agentTurns })
      .from(schema.agentTurns)
      .innerJoin(schema.agentSessions, eq(schema.agentTurns.sessionId, schema.agentSessions.id))
      .where(and(
        eq(schema.agentSessions.taskId, filter.taskId),
        filter.sessionId ? eq(schema.agentTurns.sessionId, filter.sessionId) : undefined,
      ))
      .orderBy(asc(schema.agentTurns.createdAt))
    return rows.map(({ turn: row }) => this.turnState(filter.taskId, mapAgentTurn(row)))
  }

  async requests(filter: { taskId: string; sessionId?: string }): Promise<AgentRequestState[]> {
    const rows = await this.db
      .select({ request: schema.agentRequests })
      .from(schema.agentRequests)
      .innerJoin(schema.agentSessions, eq(schema.agentRequests.sessionId, schema.agentSessions.id))
      .where(and(
        eq(schema.agentSessions.taskId, filter.taskId),
        filter.sessionId ? eq(schema.agentRequests.sessionId, filter.sessionId) : undefined,
      ))
      .orderBy(asc(schema.agentRequests.createdAt))
    return rows.map(({ request: row }) => this.requestState(filter.taskId, mapAgentRequest(row)))
  }

  async sessions(taskId: string): Promise<AgentSessionRosterEntry[]> {
    const rows = await this.db
      .select()
      .from(schema.agentSessions)
      .where(eq(schema.agentSessions.taskId, taskId))
      .orderBy(asc(schema.agentSessions.createdAt))
    return rows.map((row) => {
      const session = mapAgentSession(row)
      return {
        taskId,
        sessionId: session.id,
        present: true,
        archived: session.archivedAt != null,
        providerId: session.providerId,
        profileId: session.profileId,
        kind: session.kind,
        title: session.title,
        runtimeState: session.runtimeState,
        attention: session.attention,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      }
    })
  }

  private async turnRow(turnId: string): Promise<{ turn: AgentTurn; taskId: string } | null> {
    const [row] = await this.db
      .select({ turn: schema.agentTurns, taskId: schema.agentSessions.taskId })
      .from(schema.agentTurns)
      .innerJoin(schema.agentSessions, eq(schema.agentTurns.sessionId, schema.agentSessions.id))
      .where(eq(schema.agentTurns.id, turnId))
      .limit(1)
    return row ? { taskId: row.taskId, turn: mapAgentTurn(row.turn) } : null
  }

  private async requestRow(
    sessionId: string,
    providerRequestId: string,
  ): Promise<{ request: AgentRequest; taskId: string } | null> {
    const [row] = await this.db
      .select({ request: schema.agentRequests, taskId: schema.agentSessions.taskId })
      .from(schema.agentRequests)
      .innerJoin(schema.agentSessions, eq(schema.agentRequests.sessionId, schema.agentSessions.id))
      .where(and(
        eq(schema.agentRequests.sessionId, sessionId),
        eq(schema.agentRequests.providerRequestId, providerRequestId),
      ))
      .limit(1)
    return row ? { taskId: row.taskId, request: mapAgentRequest(row.request) } : null
  }

  private turnState(taskId: string, turn: AgentTurn): AgentTurnState {
    return {
      taskId,
      sessionId: turn.sessionId,
      turnId: turn.id,
      source: turn.source,
      status: turn.status,
      attempt: turn.attempt,
      ordinal: turn.ordinal,
      providerTurnRef: turn.providerTurnRef,
      stopReason: turn.stopReason,
      createdAt: turn.createdAt,
      startedAt: turn.startedAt,
      completedAt: turn.completedAt,
    }
  }

  private requestState(taskId: string, request: AgentRequest): AgentRequestState {
    return {
      taskId,
      sessionId: request.sessionId,
      requestId: request.providerRequestId,
      kind: request.kind,
      status: request.status,
      turnId: request.turnId,
      title: request.title,
      detail: request.detail,
      payload: request.payload,
      expiresAt: request.expiresAt,
      createdAt: request.createdAt,
      resolvedAt: request.resolvedAt,
    }
  }
}
