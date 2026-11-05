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
  const rows = tx.all<{ turnId: string | null; seq: number; eventJson: string }>(sql`
    SELECT turn_id AS turnId, seq, event_json AS eventJson FROM agent_events
    WHERE session_id = ${sessionId} AND event_json ->> '$.tool.id' = ${toolId} AND event_json ->> '$.type' = 'tool'
    ORDER BY seq
  `)
  const turnId = rows[0]?.turnId ?? null
  const own = rows.filter((row) => row.turnId === turnId)
  if (!own.length) return null
  const tool = own.map((row) => (JSON.parse(row.eventJson) as { tool: AgentToolCall }).tool).reduce(mergeToolCall)
  const turn = turnId ? tx.select().from(schema.agentTurns).where(eq(schema.agentTurns.id, turnId)).get() : undefined
  // The status every client read projects, so a call whose turn ended without its result reads as it
  // does in the transcript.
  const status = tool.status && commandStatus(tool, turn && mapAgentTurn(turn), mapAgentSession(session))
  return { tool: status ? { ...tool, status } : tool, turnId, taskId: session.taskId, seq: own.at(-1)!.seq }
}

/**
 * A session's latest `limit` tool calls, newest first by when each started, each folded as
 * `readToolCall` folds one. The inner read repeats the expressions of `agent_events_session_tool_idx`.
 */
export function readRecentToolCalls(tx: Transaction, sessionId: string, limit: number): AgentToolCall[] {
  const rows = tx.all<{ eventJson: string }>(sql`
    SELECT event_json AS eventJson FROM agent_events
    WHERE session_id = ${sessionId} AND event_json ->> '$.type' = 'tool' AND event_json ->> '$.tool.id' IN (
      SELECT event_json ->> '$.tool.id' FROM agent_events
      WHERE session_id = ${sessionId} AND event_json ->> '$.type' = 'tool'
      GROUP BY event_json ->> '$.tool.id' ORDER BY MIN(seq) DESC LIMIT ${limit}
    )
    ORDER BY seq
  `)
  const calls = new Map<string, AgentToolCall>()
  for (const row of rows) {
    const { tool } = JSON.parse(row.eventJson) as { tool: AgentToolCall }
    const previous = calls.get(tool.id)
    calls.set(tool.id, previous ? mergeToolCall(previous, tool) : tool)
  }
  return [...calls.values()].reverse()
}
