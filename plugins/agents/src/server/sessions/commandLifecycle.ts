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
  // A background command outlives its turn on purpose, and the harness reports its exit later. It
  // runs while the harness that owns it does. Once that process is gone, reconnecting included, no
  // exit can arrive, and whether the command finished is unknown.
  if (tool.background)
    return stopped || session.runtimeState === 'reconnecting' ? 'unknown' : (tool.status ?? 'running')
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
  records: AgentEventRecord[],
  session: AgentSession,
  turns: AgentTurn[],
): AgentEventRecord[] {
  const byId = new Map(turns.map((turn) => [turn.id, turn]))
  return records.map((record) => {
    if (record.event.type !== 'tool' || record.event.tool.status === undefined) return record
    const status = commandStatus(record.event.tool, byId.get(record.turnId ?? ''), session)
    return status === record.event.tool.status
      ? record
      : {
          ...record,
          event: { type: 'tool', tool: { ...record.event.tool, status } },
        }
  })
}

/** One session's commands, one turn's, or only commands whose events were written at or after `since`.
 *  A scope with none of these reads every event, which is gigabytes on a long-used Node. */
export type CommandScope = { sessionId?: string; turnId?: string; since?: number }

// Both reads below repeat the expressions of `agent_events_session_tool_idx` exactly, `->>` and all.
// SQLite uses an index on an expression only when the query spells it the same way, and a
// `json_extract` here reads every event of the session instead.
//
// A scope with only `since` is the boot settle, and it names the date index. Its type test also matches
// the tool index's WHERE, and with no statistics SQLite picked that index and opened every tool event
// ever written to check its date: 25 s on a 4 GB ledger instead of 0.4 s.
export function unfinishedCommandsQuery({ sessionId, turnId, since }: CommandScope) {
  const byDate = since !== undefined && !sessionId && !turnId
  return sql`
    WITH commands AS (
      SELECT session_id, min(seq) AS opener,
        coalesce(max(CASE WHEN event_json ->> '$.tool.status' IS NOT NULL THEN seq END), max(seq)) AS seq
      FROM agent_events ${byDate ? sql`INDEXED BY agent_events_created_idx` : sql``}
      WHERE event_json ->> '$.type' = 'tool'
        ${sessionId ? sql`AND session_id = ${sessionId}` : sql``}
        ${turnId ? sql`AND turn_id = ${turnId}` : sql``}
        ${since !== undefined ? sql`AND created_at >= ${since}` : sql``}
      GROUP BY session_id, turn_id, event_json ->> '$.tool.id'
      HAVING max(event_json ->> '$.tool.kind' = 'execute')
    )
    SELECT e.id, e.session_id AS sessionId, e.turn_id AS turnId, e.seq, e.event_json AS eventJson,
      o.event_json AS openerJson, e.created_at AS createdAt
    FROM agent_events e JOIN commands c ON e.session_id = c.session_id AND e.seq = c.seq
      JOIN agent_events o ON o.session_id = c.session_id AND o.seq = c.opener
    WHERE e.event_json ->> '$.tool.status' IN ('pending', 'running')
      OR e.event_json ->> '$.tool.status' IS NULL
    ORDER BY e.session_id, e.seq
  `
}

/** Latest unfinished command states only; output stays in its original ledger rows. */
export function unfinishedCommands(tx: Transaction, scope: CommandScope = {}): AgentEventRecord[] {
  return tx
    .all<{
      id: string
      sessionId: string
      turnId: string | null
      seq: number
      eventJson: string
      openerJson: string
      createdAt: number
    }>(unfinishedCommandsQuery(scope))
    .map(({ eventJson, openerJson, ...row }) => ({
      ...row,
      schemaVersion: 1,
      event: {
        type: 'tool',
        tool: mergeToolCall(JSON.parse(openerJson).tool, JSON.parse(eventJson).tool),
      },
    }))
}

export function commandTurnQuery(sessionId: string, tool: AgentToolCall) {
  return sql`
    SELECT DISTINCT turn_id AS turnId FROM agent_events
    WHERE session_id = ${sessionId} AND event_json ->> '$.type' = 'tool'
      AND event_json ->> '$.tool.id' = ${tool.id}
      AND event_json ->> '$.tool.subagentId' IS ${tool.subagentId ?? null}
    LIMIT 2
  `
}

/** A late update with no turn can join a card only when its stream has one unambiguous owner. */
export function commandTurn(tx: Transaction, sessionId: string, tool: AgentToolCall): string | null {
  const owners = tx.all<{ turnId: string | null }>(commandTurnQuery(sessionId, tool))
  return owners.length === 1 ? owners[0].turnId : null
}
