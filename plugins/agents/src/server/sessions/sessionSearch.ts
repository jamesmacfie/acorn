import { and, eq, inArray, isNull, like, or, sql } from 'drizzle-orm'
import type { PluginDatabase, SearchHit } from '@acorn/plugin-api/node'
import type { AgentSession } from '../../contract/wire'
import * as schema from '../../node/schema'
import { mapAgentSession } from './rowMapping'

type Transaction = Parameters<Parameters<PluginDatabase['transaction']>[0]>[0]
export type SessionSearchFilter = { taskId?: string; workspaceId?: string; limit?: number }

const ftsTerms = (query: string): string => query.split(/\s+/)
.map((term) => term.replace(/"/g, '')).filter(Boolean).map((term) => `"${term}"`).join(' ')

export function searchSessions(db: Transaction, query: string, filter: SessionSearchFilter, taskIds: string[] | null): AgentSession[] {
  const bounded = Math.min(Math.max(filter.limit ?? 50, 1), 100)
  const terms = ftsTerms(query)
  if (!terms) return []
  const escapedLike = `%${query.replace(/[%_]/g, '\\$&')}%`
  if (taskIds?.length === 0) return []
  // A reusable `task_id IN (…)` chunk for the one query that has to be raw SQL: FTS5 MATCH has no
  // Drizzle expression, so `agent_events_fts` is only reachable through sql``. Values are still bound
  // parameters, never interpolated text.
  const taskIdFilter = taskIds
    ? sql` AND agent_sessions.task_id IN (${sql.join(taskIds.map((id) => sql`${id}`), sql`, `)})`
    : sql``
  const eventMatches =
    taskIds
      ? // The join to `agent_sessions` stays: it is this plugin's own table, and it is what carries
        // the task id the filter needs. What left is the pair of core tables behind it.
        db.all<{ sessionId: string; rank: number }>(sql`
          SELECT agent_events_fts.session_id AS sessionId, min(agent_events_fts.rank) AS rank
          FROM agent_events_fts
          INNER JOIN agent_sessions ON agent_sessions.id = agent_events_fts.session_id
          WHERE agent_events_fts MATCH ${terms}${taskIdFilter}
          GROUP BY agent_events_fts.session_id
          ORDER BY rank
          LIMIT 200
        `)
      : db.all<{ sessionId: string; rank: number }>(sql`
          SELECT session_id AS sessionId, min(rank) AS rank
          FROM agent_events_fts
          WHERE agent_events_fts MATCH ${terms}
          GROUP BY session_id
          ORDER BY rank
          LIMIT 200
        `)
  const artifactMatches = taskIds
      ? db
          .selectDistinct({ sessionId: schema.agentArtifacts.sessionId })
          .from(schema.agentArtifacts)
          .innerJoin(schema.agentSessions, eq(schema.agentSessions.id, schema.agentArtifacts.sessionId))
          .where(and(
            inArray(schema.agentSessions.taskId, taskIds),
            or(
              like(schema.agentArtifacts.title, escapedLike),
              like(schema.agentArtifacts.metadataJson, escapedLike),
            ),
          ))
          .limit(200).all()
      : db
          .selectDistinct({ sessionId: schema.agentArtifacts.sessionId })
          .from(schema.agentArtifacts)
          .where(or(
            like(schema.agentArtifacts.title, escapedLike),
            like(schema.agentArtifacts.metadataJson, escapedLike),
          ))
          .limit(200).all()
  const rankBySession = new Map(eventMatches.map((match) => [match.sessionId, match.rank]))
  const matchedIds = [...new Set([
    ...eventMatches.map((match) => match.sessionId),
    ...artifactMatches.map((match) => match.sessionId),
  ])]
  const textMatch = matchedIds.length
    ? or(like(schema.agentSessions.title, escapedLike), inArray(schema.agentSessions.id, matchedIds))
    : like(schema.agentSessions.title, escapedLike)
  // One query now, not two. The workspace-scoped branch existed only to reach core workspace membership
  // through `tasks`; with the ids in hand the filter is an ordinary predicate on this plugin's own
  // column, so the join, the `{ session: … }` projection and the `.map` that unwrapped it all go.
  const rows = db
    .select()
    .from(schema.agentSessions)
    .where(and(
      isNull(schema.agentSessions.archivedAt),
      filter.taskId ? eq(schema.agentSessions.taskId, filter.taskId) : undefined,
      taskIds ? inArray(schema.agentSessions.taskId, taskIds) : undefined,
      textMatch,
    ))
    .limit(200).all()
  return rows
    .sort((a, b) => {
      const aRank = rankBySession.get(a.id) ?? Number.POSITIVE_INFINITY
      const bRank = rankBySession.get(b.id) ?? Number.POSITIVE_INFINITY
      return aRank - bRank || b.updatedAt - a.updatedAt
    })
    .slice(0, bounded)
    .map(mapAgentSession)
}

// The search provider's answer (server/pluginHost/search.ts in node-core): one hit per session in the
// given tasks, best match first, with an excerpt of the event that matched. Archived sessions and
// sessions retired with their task count, because the caller already chose the tasks.
//
// Three reads rather than one grouped query, because FTS5 cannot compute `snippet()` inside an
// aggregate. The ranked read is capped, and excerpts are built only for the rows that become hits.
export function searchTaskSessions(db: Transaction, query: string, taskIds: readonly string[], limit: number): SearchHit[] {
  const terms = ftsTerms(query)
  if (!terms || !taskIds.length) return []
  const inTasks = sql.join(taskIds.map((id) => sql`${id}`), sql`, `)
  const ranked = db.all<{ rowid: number; sessionId: string }>(sql`
    SELECT rowid, session_id AS sessionId
    FROM agent_events_fts
    WHERE agent_events_fts MATCH ${terms}
      AND session_id IN (SELECT id FROM agent_sessions WHERE task_id IN (${inTasks}))
    ORDER BY rank
    LIMIT 200
  `)
  const best = new Map<string, number>()
  for (const row of ranked) if (!best.has(row.sessionId) && best.size < limit) best.set(row.sessionId, row.rowid)
  const escapedLike = `%${query.replace(/[%_]/g, '\\$&')}%`
  const titled = db
    .select({ id: schema.agentSessions.id })
    .from(schema.agentSessions)
    .where(and(inArray(schema.agentSessions.taskId, [...taskIds]), like(schema.agentSessions.title, escapedLike)))
    .limit(limit).all()
  const ids = [...new Set([...best.keys(), ...titled.map((row) => row.id)])].slice(0, limit)
  if (!ids.length) return []
  const rowids = [...best.values()]
  const excerpts =
    rowids.length
      ? db.all<{ rowid: number; preview: string }>(sql`
          SELECT rowid, snippet(agent_events_fts, -1, '', '', '…', 16) AS preview
          FROM agent_events_fts
          WHERE agent_events_fts MATCH ${terms} AND rowid IN (${sql.join(rowids.map((id) => sql`${id}`), sql`, `)})
        `)
      : []
  const sessions = db
      .select({ id: schema.agentSessions.id, taskId: schema.agentSessions.taskId, title: schema.agentSessions.title })
      .from(schema.agentSessions)
      .where(inArray(schema.agentSessions.id, ids)).all()
  const previewByRow = new Map(excerpts.map((row) => [row.rowid, row.preview]))
  const sessionById = new Map(sessions.map((row) => [row.id, row]))
  return ids.flatMap((id) => {
    const session = sessionById.get(id)
    if (!session) return []
    const rowid = best.get(id)
    return [{
      taskId: session.taskId,
      title: session.title,
      preview: rowid === undefined ? '' : previewByRow.get(rowid) ?? '',
      target: { kind: 'managed-agent', resourceId: session.id },
    }]
  })
}
