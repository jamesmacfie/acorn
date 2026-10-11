import { and, asc, eq, sql } from 'drizzle-orm'
import { createLogger, describeError, type PluginDatabase } from '@acorn/plugin-api/node'
import * as schema from '../../node/schema'
import type {
  AgentConfigOption,
  AgentNormalizedEvent,
  AgentRequest,
  AgentRequestBlocked,
  AgentSession,
  AgentSubagent,
  AgentTurn,
} from '../../contract/wire.ts'
import type {
  AgentActivityState,
  AgentActivityUsage,
  AgentLifecyclePublisher,
  AgentReviewInputResult,
  AgentRequestState,
  AgentSessionChange,
  AgentSessionRosterEntry,
  SessionRenameSource,
  AgentTurnState,
} from '../../contract/lifecycle'
import { mapAgentRequest, mapAgentSession, mapAgentTurn } from './rowMapping'

const log = createLogger('agents:lifecycle', 'agents')

/**
 * The one post-commit projection from managed-agent rows to the public lifecycle catalogue.
 * Persistence owners call the announce methods only after their transaction has committed; capability
 * readers use the same projections, so an event payload and a subsequent read cannot disagree.
 */
export class AgentLifecycle {
  // The context fill last sent per session, so a report that moves nothing sends nothing, and a report
  // with one count keeps the other. Harnesses send usage several times a turn.
  readonly #sentUsage = new Map<string, AgentActivityUsage>()
  // Loaded on the first tool, subagent, or usage event, not at boot.
  #activityLoad: Promise<typeof import('./activity')> | null = null
  readonly #activityModule = () => (this.#activityLoad ??= import('./activity'))

  constructor(
    private readonly db: PluginDatabase,
    private readonly publish?: AgentLifecyclePublisher,
  ) {}

  announceSession(session: AgentSession, changes: AgentSessionChange[], renameSource?: SessionRenameSource): void {
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

  /** After the event's transaction commits. `stored` and `roster` are what it committed. */
  announceActivity(
    taskId: string,
    sessionId: string,
    turnId: string | null,
    event: AgentNormalizedEvent,
    stored: AgentNormalizedEvent,
    roster: readonly AgentSubagent[],
  ): void {
    if (!this.publish || (event.type !== 'tool' && event.type !== 'subagent' && event.type !== 'usage')) return
    const publish = this.publish
    // One promise for every frame, so they go out in commit order.
    this.#activityModule()
      .then(({ activityItem }) => {
        const item = activityItem(event, stored, roster, turnId)
        if (!item) return
        if (item.kind !== 'usage') return publish({ channel: 'plugin:agents:activity', taskId, sessionId, ...item })
        const sent = this.#sentUsage.get(sessionId)
        const usage = {
          contextUsed: item.usage.contextUsed ?? sent?.contextUsed ?? null,
          contextSize: item.usage.contextSize ?? sent?.contextSize ?? null,
        }
        if (sent?.contextUsed === usage.contextUsed && sent.contextSize === usage.contextSize) return
        this.#sentUsage.set(sessionId, usage)
        publish({ channel: 'plugin:agents:activity', taskId, sessionId, kind: 'usage', usage })
      })
      .catch((error: unknown) => log.warn(`failed to announce activity: ${describeError(error).message}`))
  }

  /** The frames' items rebuilt from the ledger (./activity.ts). */
  async activity(ref: { taskId: string; sessionId: string }): Promise<AgentActivityState | null> {
    return (await this.#activityModule()).readActivity(this.db, ref)
  }

  async turns(filter: { taskId: string; sessionId?: string }): Promise<AgentTurnState[]> {
    const rows = await this.db
      .select({ turn: schema.agentTurns })
      .from(schema.agentTurns)
      .innerJoin(schema.agentSessions, eq(schema.agentTurns.sessionId, schema.agentSessions.id))
      .where(
        and(
          eq(schema.agentSessions.taskId, filter.taskId),
          filter.sessionId ? eq(schema.agentTurns.sessionId, filter.sessionId) : undefined,
        ),
      )
      .orderBy(asc(schema.agentTurns.createdAt))
    return rows.map(({ turn: row }) => this.turnState(filter.taskId, mapAgentTurn(row)))
  }

  async requests(filter: { taskId: string; sessionId?: string }): Promise<AgentRequestState[]> {
    const rows = await this.db
      .select({ request: schema.agentRequests })
      .from(schema.agentRequests)
      .innerJoin(schema.agentSessions, eq(schema.agentRequests.sessionId, schema.agentSessions.id))
      .where(
        and(
          eq(schema.agentSessions.taskId, filter.taskId),
          filter.sessionId ? eq(schema.agentRequests.sessionId, filter.sessionId) : undefined,
        ),
      )
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
        configOptions: Array.isArray(session.config.configOptions)
          ? (session.config.configOptions as AgentConfigOption[])
          : [],
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      }
    })
  }

  /** One completed turn of one task, bounded for a reviewer. The task and session must both match. */
  async reviewInput(ref: { taskId: string; sessionId: string; turnId: string }): Promise<AgentReviewInputResult> {
    const [row] = await this.db
      .select({ turn: schema.agentTurns })
      .from(schema.agentTurns)
      .innerJoin(schema.agentSessions, eq(schema.agentTurns.sessionId, schema.agentSessions.id))
      .where(
        and(
          eq(schema.agentSessions.taskId, ref.taskId),
          eq(schema.agentSessions.id, ref.sessionId),
          eq(schema.agentTurns.id, ref.turnId),
        ),
      )
      .limit(1)
    if (!row) return { available: false, reason: 'not-found' }
    const turn = mapAgentTurn(row.turn)
    if (turn.status !== 'completed' || turn.completedAt == null) return { available: false, reason: 'not-completed' }
    // Assistant rows only, so a turn's tool output never leaves SQLite on its way to being skipped.
    const events = await this.db
      .select({ eventJson: schema.agentEvents.eventJson })
      .from(schema.agentEvents)
      .where(
        and(
          eq(schema.agentEvents.sessionId, ref.sessionId),
          eq(schema.agentEvents.turnId, ref.turnId),
          sql`json_extract(${schema.agentEvents.eventJson}, '$.type') = 'assistant_message'`,
        ),
      )
      .orderBy(asc(schema.agentEvents.seq))
    // Loaded on the first review, not at boot.
    const { finalAssistantText, reviewUserText } = await import('./reviewInput')
    return {
      available: true,
      input: {
        ...ref,
        source: turn.source,
        completedAt: turn.completedAt,
        ...reviewUserText(turn),
        ...finalAssistantText(events.map((event) => JSON.parse(event.eventJson) as Record<string, unknown>)),
      },
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
      .where(
        and(
          eq(schema.agentRequests.sessionId, sessionId),
          eq(schema.agentRequests.providerRequestId, providerRequestId),
        ),
      )
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
    // Only the refusal leaves; the rest of the resolution is what the person answered and stays private.
    const blocked = request.status === 'resolved' ? blockedOf(request.resolution) : null
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
      ...(blocked ? { blocked } : {}),
    }
  }
}

const blockedOf = (resolution: unknown): AgentRequestBlocked | null => {
  const blocked = (resolution as { blocked?: Partial<AgentRequestBlocked> } | null)?.blocked
  return typeof blocked?.by === 'string' && typeof blocked.reason === 'string'
    ? { by: blocked.by, reason: blocked.reason }
    : null
}
