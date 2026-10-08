import { and, eq, isNotNull } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import type { AgentGoalStatus, AgentGoalVerdict, AgentSession } from '../../contract/wire.ts'
import * as schema from '../../node/schema'
import { mapAgentSession } from './rowMapping'
import type { AgentStore } from './store'

/** Goal columns are session-owned, but their writes load only when a goal is used or recovered. */
export class SessionGoalStore {
  constructor(private readonly db: PluginDatabase, private readonly sessions: Pick<AgentStore, 'requireSession'>) {}

  async set(sessionId: string, objective: string | null): Promise<AgentSession> {
    const session = await this.sessions.requireSession(sessionId)
    if (session.kind !== 'interactive' || session.controller !== 'acorn' || session.archivedAt) {
      throw new Error('Goals require an active interactive session controlled by Acorn.')
    }
    await this.db.update(schema.agentSessions).set({
      goalObjective: objective, goalStatus: objective ? 'active' : null,
      goalContinuations: 0, goalNoProgress: 0, goalVerdictJson: null, updatedAt: Date.now(),
    }).where(eq(schema.agentSessions.id, sessionId))
    return this.sessions.requireSession(sessionId)
  }

  async status(sessionId: string, status: AgentGoalStatus): Promise<AgentSession> {
    await this.db.update(schema.agentSessions).set({ goalStatus: status, updatedAt: Date.now() })
      .where(and(eq(schema.agentSessions.id, sessionId), isNotNull(schema.agentSessions.goalObjective)))
    return this.sessions.requireSession(sessionId)
  }

  async apply(sessionId: string, objective: string, verdict: AgentGoalVerdict,
    status: AgentGoalStatus, continuations: number, noProgress: number): Promise<AgentSession | null> {
    const changed = await this.db.update(schema.agentSessions).set({
      goalStatus: status, goalContinuations: continuations, goalNoProgress: noProgress,
      goalVerdictJson: JSON.stringify(verdict), attention: status === 'active' ? 'none' : 'completed',
      updatedAt: Date.now(),
    }).where(and(eq(schema.agentSessions.id, sessionId), eq(schema.agentSessions.goalObjective, objective),
      eq(schema.agentSessions.goalStatus, 'active')))
    return changed.changes ? this.sessions.requireSession(sessionId) : null
  }

  async active(): Promise<AgentSession[]> {
    return (await this.db.select().from(schema.agentSessions)
      .where(eq(schema.agentSessions.goalStatus, 'active'))).map(mapAgentSession)
  }
}
