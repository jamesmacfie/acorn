import { eq, sql } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import * as schema from '../../node/schema'
import type { AgentToolCall, AgentToolCallRead } from '../../contract/wire.ts'
import { mergeToolCall } from '../../shared/toolFold'
import { commandStatus } from './commandLifecycle'
import { mapAgentSession, mapAgentTurn } from './rowMapping'

type Transaction = Parameters<Parameters<PluginDatabase['transaction']>[0]>[0]

/**
 * One tool call, read by its ID rather than by paging the session, and folded as the transcript folds
 * it. The ledger keeps a call as its opener and its latest state, but an older ledger or a call still
 * streaming can hold more rows, so every row is folded in sequence order.
 *
 * A card is keyed by turn and tool ID, so the call is the first turn's rows. The WHERE repeats the
 * expressions of `agent_events_session_tool_idx` exactly, so SQLite reads the call through it.
 *
 * Throws for a session that doesn't exist, and answers null for a call the session doesn't have.
 */
export function readToolCall(tx: Transaction, sessionId: string, toolId: string): AgentToolCallRead | null {
  const session = tx.select().from(schema.agentSessions).where(eq(schema.agentSessions.id, sessionId)).get()
  if (!session) throw new Error(`Managed agent session not found: ${sessionId}`)
  const rows = tx.all<{ turnId: string | null; eventJson: string }>(sql`
    SELECT turn_id AS turnId, event_json AS eventJson FROM agent_events
    WHERE session_id = ${sessionId} AND event_json ->> '$.tool.id' = ${toolId} AND event_json ->> '$.type' = 'tool'
    ORDER BY seq
  `)
  const turnId = rows[0]?.turnId ?? null
  const calls = rows
    .filter((row) => row.turnId === turnId)
    .map((row) => (JSON.parse(row.eventJson) as { tool: AgentToolCall }).tool)
  if (!calls.length) return null
  const tool = calls.reduce(mergeToolCall)
  const turn = turnId ? tx.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, turnId)).get() : undefined
  // The status every client read projects, so a call whose turn ended without its result reads as it
  // does in the transcript.
  const status = tool.status && commandStatus(tool, turn && mapAgentTurn(turn), mapAgentSession(session))
  return { tool: status ? { ...tool, status } : tool, turnId, taskId: session.taskId }
}
