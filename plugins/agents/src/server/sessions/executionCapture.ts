import { and, asc, eq, gt, inArray, lte } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import type { AgentEventRecord, AgentSessionSnapshot } from '../../contract/wire'
import { agentEvents, agentSessions, agentTurns } from '../../node/schema'
import { mapAgentEvent, mapAgentSession, mapAgentTurn } from './rowMapping'

type Reader = Pick<PluginDatabase, 'select'>

/** Called in one SQLite transaction: the target and committed ceiling stay fixed across pages. */
export function readExecutionCapture(db: Reader, sessionId: string, turnIds: readonly string[]): AgentSessionSnapshot {
  const row = db.select().from(agentSessions).where(eq(agentSessions.id, sessionId)).get()
  if (!row) throw new Error(`Managed agent session not found: ${sessionId}`)
  const events: AgentEventRecord[] = []
  let cursor = 0
  while (turnIds.length) {
    const page = db.select().from(agentEvents).where(and(
      eq(agentEvents.sessionId, sessionId), inArray(agentEvents.turnId, [...turnIds]),
      gt(agentEvents.seq, cursor), lte(agentEvents.seq, row.lastEventSeq),
    )).orderBy(asc(agentEvents.seq)).limit(500).all()
    for (const event of page) events.push(mapAgentEvent(event))
    if (page.length < 500) break
    cursor = page.at(-1)!.seq
  }
  return {
    session: mapAgentSession(row), events, requests: [],
    turns: turnIds.length ? db.select().from(agentTurns).where(and(
      eq(agentTurns.sessionId, sessionId), inArray(agentTurns.id, [...turnIds]),
    )).orderBy(asc(agentTurns.ordinal)).all().map(mapAgentTurn) : [],
  }
}
