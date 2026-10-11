import { sql } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import { ftsTerms } from './sessionSearch'

type Transaction = Parameters<Parameters<PluginDatabase['transaction']>[0]>[0]
export type HistoryRole = 'user' | 'assistant' | 'tool'
export type HistoryHit = { seq: number; role: HistoryRole; time: number; excerpt: string }
export type HistoryPage = {
  seq: number
  role: HistoryRole
  time: number
  text: string
  nextOffset: number | null
  truncated: boolean
}

const roleSql = sql<string>`CASE json_extract(e.event_json, '$.type')
  WHEN 'user_message' THEN 'user'
  WHEN 'assistant_message' THEN 'assistant'
  WHEN 'tool' THEN 'tool' END`

export function searchSessionHistory(
  db: Transaction,
  sessionId: string,
  query: string,
  role: HistoryRole | undefined,
  limit: number,
): HistoryHit[] {
  const terms = ftsTerms(query)
  if (!terms) return []
  const rows = db.all<HistoryHit>(sql`
    SELECT e.seq, ${roleSql} AS role, e.created_at AS time,
      snippet(agent_events_fts, -1, '', '', '…', 64) AS excerpt
    FROM agent_events_fts
    JOIN agent_events e ON e.rowid = agent_events_fts.rowid AND e.id = agent_events_fts.event_id
    WHERE agent_events_fts MATCH ${terms} AND e.session_id = ${sessionId}
      AND ${roleSql} IN ('user', 'assistant', 'tool')
      ${role ? sql`AND ${roleSql} = ${role}` : sql``}
    ORDER BY agent_events_fts.rank, e.seq
    LIMIT ${limit}
  `)
  return rows.map((row) => ({ ...row, excerpt: row.excerpt.slice(0, 600) }))
}

export function readSessionHistory(
  db: Transaction,
  sessionId: string,
  seq: number,
  offset: number,
): HistoryPage | null {
  const row = db.get<{ seq: number; role: HistoryRole; time: number; text: string }>(sql`
    SELECT e.seq, ${roleSql} AS role, e.created_at AS time, e.search_text AS text
    FROM agent_events e
    WHERE e.session_id = ${sessionId} AND e.seq = ${seq}
      AND e.search_text IS NOT NULL AND ${roleSql} IN ('user', 'assistant', 'tool')
  `)
  if (!row) return null
  const end = Math.min(offset + 4_000, row.text.length)
  return {
    seq: row.seq,
    role: row.role,
    time: row.time,
    text: row.text.slice(offset, end),
    nextOffset: end < row.text.length ? end : null,
    truncated: end < row.text.length,
  }
}
