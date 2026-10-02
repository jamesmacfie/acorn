import { and, desc, eq, gt, sql } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import type { AgentSession, AgentWaitCondition, AgentWaitFacts } from '../../contract/wire'
import { agentEvents, agentSessions } from '../../node/schema'

type Reader = Pick<PluginDatabase, 'select'>
type WaitRow = Pick<AgentSession, 'runtimeState' | 'attention' | 'lastEventSeq'>

/** Reads scalar authority without mapping transcript, request, or historical turn bodies. */
export function readWaitFacts(db: Reader, sessionId: string, afterSeq: number, until: AgentWaitCondition, row?: WaitRow): AgentWaitFacts {
  const session = row ?? db.select({
    runtimeState: agentSessions.runtimeState,
    attention: agentSessions.attention,
    lastEventSeq: agentSessions.lastEventSeq,
  }).from(agentSessions).where(eq(agentSessions.id, sessionId)).get()
  if (!session) throw new Error(`Managed agent session not found: ${sessionId}`)
  const terminal = until === 'turn_completed'
    ? db.select({ seq: agentEvents.seq, turnId: agentEvents.turnId,
        type: sql<'turn_completed' | 'error'>`json_extract(${agentEvents.eventJson}, '$.type')`,
      }).from(agentEvents).where(and(
        eq(agentEvents.sessionId, sessionId), gt(agentEvents.seq, afterSeq),
        sql`json_extract(${agentEvents.eventJson}, '$.type') IN ('turn_completed', 'error')`,
      )).orderBy(desc(agentEvents.seq)).limit(1).get() ?? null
    : null
  const matched = until === 'ready' ? session.runtimeState === 'ready'
    : until === 'attention' ? !['none', 'unread'].includes(session.attention)
    : until === 'stopped' ? ['stopped', 'failed', 'archived'].includes(session.runtimeState)
    : terminal !== null
  return { until, afterSeq, matched, terminal }
}
