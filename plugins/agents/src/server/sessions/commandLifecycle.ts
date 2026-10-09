import { sql } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import type { AgentEventRecord, AgentSession, AgentToolCall, AgentTurn } from '../../contract/wire'
import { isActiveSubagent } from './stateMachine'
import { mergeToolCall } from '../../shared/toolFold'

type Transaction = Parameters<Parameters<PluginDatabase['transaction']>[0]>[0]

/** An unfinished command needs a turn or a child owned by a live session. */
export function commandStatus(
  tool: AgentToolCall,
  turn: Pick<AgentTurn, 'status'> | undefined,
  session: Pick<AgentSession, 'runtimeState' | 'subagents'>,
): AgentToolCall['status'] {
  if (tool.status && !['pending', 'running'].includes(tool.status)) return tool.status
  const stopped = ['stopped', 'failed', 'archived'].includes(session.runtimeState)
  if (tool.subagentId) {
    const child = session.subagents.find((entry) => entry.id === tool.subagentId)
    if (!stopped && child && isActiveSubagent(child)) return tool.status ?? 'running'
    return stopped || turn?.status === 'interrupted' ? 'interrupted' : 'unknown'
  }
  if (turn?.status === 'cancelled') return 'cancelled'
  if (turn?.status === 'interrupted') return 'interrupted'
  if (turn && ['completed', 'failed', 'queued'].includes(turn.status)) return 'unknown'
  if (stopped) return 'interrupted'
  if (turn && ['dispatching', 'active'].includes(turn.status)) return tool.status ?? 'running'
  // A settled turn does not prove that an unfinished command succeeded.
  return 'unknown'
}

/** Node read projection for histories written before lifecycle endings updated command cards. */
export function projectCommandEvents(
  records: AgentEventRecord[], session: AgentSession, turns: AgentTurn[],
): AgentEventRecord[] {
  const byId = new Map(turns.map((turn) => [turn.id, turn]))
  return records.map((record) => {
    if (record.event.type !== 'tool' || record.event.tool.status === undefined) return record
    const status = commandStatus(record.event.tool, byId.get(record.turnId ?? ''), session)
    return status === record.event.tool.status ? record : {
      ...record, event: { type: 'tool', tool: { ...record.event.tool, status } },
    }
  })
}

/** Latest unfinished command states only; output stays in its original ledger rows. */
export function unfinishedCommands(tx: Transaction, sessionId?: string): AgentEventRecord[] {
  return tx.all<{ id: string; sessionId: string; turnId: string | null; seq: number; eventJson: string; openerJson: string; createdAt: number }>(sql`
    WITH commands AS (
      SELECT session_id, min(seq) AS opener,
        coalesce(max(CASE WHEN json_extract(event_json, '$.tool.status') IS NOT NULL THEN seq END), max(seq)) AS seq
      FROM agent_events
      WHERE json_extract(event_json, '$.type') = 'tool'
        ${sessionId ? sql`AND session_id = ${sessionId}` : sql``}
      GROUP BY session_id, turn_id, json_extract(event_json, '$.tool.id')
      HAVING max(json_extract(event_json, '$.tool.kind') = 'execute')
    )
    SELECT e.id, e.session_id AS sessionId, e.turn_id AS turnId, e.seq, e.event_json AS eventJson,
      o.event_json AS openerJson, e.created_at AS createdAt
    FROM agent_events e JOIN commands c ON e.session_id = c.session_id AND e.seq = c.seq
      JOIN agent_events o ON o.session_id = c.session_id AND o.seq = c.opener
    WHERE json_extract(e.event_json, '$.tool.status') IN ('pending', 'running')
      OR json_extract(e.event_json, '$.tool.status') IS NULL
    ORDER BY e.session_id, e.seq
  `).map(({ eventJson, openerJson, ...row }) => ({ ...row, schemaVersion: 1, event: {
    type: 'tool', tool: mergeToolCall(JSON.parse(openerJson).tool, JSON.parse(eventJson).tool),
  } }))
}

/** A late update with no turn can join a card only when its stream has one unambiguous owner. */
export function commandTurn(tx: Transaction, sessionId: string, tool: AgentToolCall): string | null {
  const owners = tx.all<{ turnId: string | null }>(sql`
    SELECT DISTINCT turn_id AS turnId FROM agent_events
    WHERE session_id = ${sessionId} AND json_extract(event_json, '$.type') = 'tool'
      AND json_extract(event_json, '$.tool.id') = ${tool.id}
      AND json_extract(event_json, '$.tool.subagentId') IS ${tool.subagentId ?? null}
    LIMIT 2
  `)
  return owners.length === 1 ? owners[0].turnId : null
}
