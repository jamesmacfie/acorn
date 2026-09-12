import { and, asc, eq } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import * as schema from '../../node/schema'
import type { AgentRequest, AgentSession, AgentTurn } from '@acorn/protocol/managedAgents.ts'
import type {
  AgentLifecyclePublisher,
  AgentReviewInput,
  AgentReviewInputRef,
  AgentRequestState,
  AgentSessionChange,
  AgentSessionRosterEntry,
  SessionRenameSource,
  AgentTurnState,
} from '../../contract/lifecycle'
import { mapAgentRequest, mapAgentSession, mapAgentTurn } from './rowMapping'

const eventType = (json: string): string | null => {
  try {
    const parsed = JSON.parse(json) as { type?: unknown }
    return typeof parsed.type === 'string' ? parsed.type : null
  } catch { return null }
}

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

  announceSession(
    session: AgentSession,
    changes: AgentSessionChange[],
    renameSource?: SessionRenameSource,
  ): void {
    if (!changes.length) return
    this.publish?.({
      channel: 'plugin:agents:sessions-changed',
      taskId: session.taskId,
      sessionId: session.id,
      present: !changes.includes('deleted'),
      archived: session.archivedAt != null,
      changes,
      ...(changes.includes('renamed') && renameSource ? { renameSource } : {}),
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

  async completedReviewInputs(taskId: string): Promise<AgentReviewInputRef[]> {
    const rows = await this.db
      .select({ turn: schema.agentTurns, session: schema.agentSessions })
      .from(schema.agentTurns)
      .innerJoin(schema.agentSessions, eq(schema.agentTurns.sessionId, schema.agentSessions.id))
      .where(and(eq(schema.agentSessions.taskId, taskId), eq(schema.agentTurns.status, 'completed')))
      .orderBy(asc(schema.agentTurns.completedAt))
    const refs: AgentReviewInputRef[] = []
    for (const { turn, session } of rows) {
      const events = await this.db.select({ seq: schema.agentEvents.seq, eventJson: schema.agentEvents.eventJson })
        .from(schema.agentEvents)
        .where(and(eq(schema.agentEvents.turnId, turn.id), eq(schema.agentEvents.sessionId, session.id)))
        .orderBy(asc(schema.agentEvents.seq))
      const completedSequence = events.findLast((event) => eventType(event.eventJson) === 'turn_completed')?.seq
      if (turn.completedAt == null || completedSequence == null) continue
      refs.push({
        taskId,
        sessionId: session.id,
        turnId: turn.id,
        source: turn.source as AgentReviewInputRef['source'],
        attempt: turn.attempt,
        purpose: session.kind === 'workflow' || turn.source === 'workflow' ? 'workflow' : 'ordinary',
        completedSequence,
        completedAt: turn.completedAt,
      })
    }
    return refs
  }

  async reviewInput(input: { taskId: string; sessionId: string; turnId: string }): Promise<AgentReviewInput> {
    const [row] = await this.db
      .select({ turn: schema.agentTurns, session: schema.agentSessions })
      .from(schema.agentTurns)
      .innerJoin(schema.agentSessions, eq(schema.agentTurns.sessionId, schema.agentSessions.id))
      .where(and(
        eq(schema.agentSessions.taskId, input.taskId),
        eq(schema.agentSessions.id, input.sessionId),
        eq(schema.agentTurns.id, input.turnId),
      ))
      .limit(1)
    if (!row || row.turn.status !== 'completed' || row.turn.completedAt == null) {
      return {
        ...input, source: 'interactive', attempt: 0, purpose: 'ordinary', completedSequence: 0,
        completedAt: 0, availability: 'unavailable', assistantSummary: null, userMessages: [],
        unavailableReason: 'The completed managed turn is unavailable for this task.',
      }
    }
    const events = await this.db.select().from(schema.agentEvents)
      .where(and(eq(schema.agentEvents.sessionId, input.sessionId), eq(schema.agentEvents.turnId, input.turnId)))
      .orderBy(asc(schema.agentEvents.seq))
    const completedSequence = events.findLast((event) => eventType(event.eventJson) === 'turn_completed')?.seq ?? 0
    const parsed = events.filter((event) => event.seq <= completedSequence).flatMap((event) => {
      try { return [JSON.parse(event.eventJson) as { type?: string; text?: string }] } catch { return [] }
    })
    const assistantSummary = parsed.filter((event) => event.type === 'assistant_message' && typeof event.text === 'string')
      .map((event) => event.text!.trim()).filter(Boolean).join('\n\n').slice(-12_000) || null
    const userMessages = parsed.filter((event) => event.type === 'user_message' && typeof event.text === 'string')
      .map((event) => event.text!.trim()).filter(Boolean).slice(-4).map((text) => text.slice(-2_000))
    const available = !!assistantSummary || userMessages.length > 0
    return {
      taskId: input.taskId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      source: row.turn.source as AgentReviewInput['source'],
      attempt: row.turn.attempt,
      purpose: row.session.kind === 'workflow' || row.turn.source === 'workflow' ? 'workflow' : 'ordinary',
      completedSequence,
      completedAt: row.turn.completedAt,
      availability: available ? 'available' : 'unavailable',
      assistantSummary,
      userMessages,
      unavailableReason: available ? null : 'The turn completed without bounded reviewable text.',
    }
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
