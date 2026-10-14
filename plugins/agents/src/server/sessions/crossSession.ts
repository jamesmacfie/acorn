import { sql, type SQL } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import type { AgentNormalizedEvent, AgentToolCall } from '../../contract/wire'
import { continuesStream } from './durableEventBuffer'
import { parseStoredEvent } from './ledgerFold'
import { ftsTerms } from './sessionSearch'

// The SQL behind agent_session_list, agent_session_search and agent_session_read. The caller has
// already resolved which tasks it may see through core, so every read here takes that set as its
// filter and never runs without one (docs/managed-agents/cross-session-reads.md).

type Transaction = Parameters<Parameters<PluginDatabase['transaction']>[0]>[0]

export type ContentRole = 'user' | 'assistant' | 'tool'
export type ThreadView = 'conversation' | 'with_tools'

export type ScopedSessionRow = {
  id: string
  taskId: string
  title: string
  kind: string
  providerId: string
  profileId: string
  runtimeState: string
  createdAt: number
  lastActivityAt: number
  lastEventSeq: number
  archivedAt: number | null
  historyRemovedAt: number | null
}

/** Which sessions a list or search may reach. `taskIds` is never empty here; the caller answers an
 *  empty scope itself, so an empty set can't fall through to an unfiltered query. */
export type SessionScope = {
  taskIds: readonly string[]
  sessionId?: string
  excludeSessionId?: string
  includeArchived: boolean
}

// A JSON array parameter rather than one bound value per id, so a large project can't reach
// SQLite's bound-parameter limit.
const inJson = (values: readonly string[]) => sql`(SELECT value FROM json_each(${JSON.stringify(values)}))`
const likeTerm = (term: string) => `%${term.replace(/[\\%_]/g, '\\$&')}%`
const activity = sql`coalesce(s.last_event_at, s.created_at)`

function scopeFilter(scope: SessionScope): SQL {
  if (!scope.taskIds.length) throw new Error('A session scope needs at least one task.')
  return sql.join(
    [
      sql`s.task_id IN ${inJson(scope.taskIds)}`,
      scope.sessionId === undefined ? undefined : sql`s.id = ${scope.sessionId}`,
      scope.excludeSessionId === undefined ? undefined : sql`s.id != ${scope.excludeSessionId}`,
      scope.includeArchived ? undefined : sql`s.archived_at IS NULL`,
    ].filter((part): part is SQL => part !== undefined),
    sql` AND `,
  )
}

const sessionColumns = sql`s.id, s.task_id AS taskId, s.title, s.kind, s.provider_id AS providerId,
  s.profile_id AS profileId, s.runtime_state AS runtimeState, s.created_at AS createdAt,
  ${activity} AS lastActivityAt, s.last_event_seq AS lastEventSeq, s.archived_at AS archivedAt, s.history_removed_at AS historyRemovedAt`

/** Latest activity first, ties broken by id, resuming after `after`. `titleTaskIds` are tasks whose
 *  own title matched, so every session in them matches too. */
export function listScopedSessions(
  tx: Transaction,
  scope: SessionScope,
  filter: { titleQuery?: string; titleTaskIds?: readonly string[]; after?: { activity: number; id: string } },
  limit: number,
): ScopedSessionRow[] {
  const title = filter.titleQuery
    ? sql`AND (s.title LIKE ${likeTerm(filter.titleQuery)} ESCAPE '\\' OR s.task_id IN ${inJson(filter.titleTaskIds ?? [])})`
    : sql``
  const after = filter.after
    ? sql`AND (${activity} < ${filter.after.activity} OR (${activity} = ${filter.after.activity} AND s.id < ${filter.after.id}))`
    : sql``
  return tx.all<ScopedSessionRow>(sql`
    SELECT ${sessionColumns} FROM agent_sessions s
    WHERE ${scopeFilter(scope)} ${title} ${after}
    ORDER BY ${activity} DESC, s.id DESC
    LIMIT ${limit}
  `)
}

export function scopedSession(tx: Transaction, sessionId: string): ScopedSessionRow | undefined {
  return tx.get<ScopedSessionRow>(sql`SELECT ${sessionColumns} FROM agent_sessions s WHERE s.id = ${sessionId}`)
}

const roleSql = sql<string>`CASE json_extract(e.event_json, '$.type')
  WHEN 'user_message' THEN 'user'
  WHEN 'assistant_message' THEN 'assistant'
  WHEN 'tool' THEN 'tool' END`

export type ScopedHit =
  | { match: 'title'; sessionId: string }
  | { match: ContentRole; sessionId: string; seq: number; time: number; excerpt: string }

/**
 * Title hits first, by latest activity, then content hits by rank. One offset walks both lists, so a
 * page can start in either. Session titles match when they hold every query word.
 *
 * shortcut: offset paging, so a page can repeat or skip a hit when new events change the ranking
 * between calls. Switch to a keyset on (rank, session, seq) if agents report it.
 */
export function searchScopedSessions(
  tx: Transaction,
  scope: SessionScope,
  query: string,
  roles: readonly ContentRole[],
  offset: number,
  limit: number,
): { hits: ScopedHit[]; more: boolean } {
  const terms = ftsTerms(query)
  if (!terms) return { hits: [], more: false }
  const words = query.split(/\s+/).filter(Boolean)
  const titles = tx
    .all<{ id: string }>(sql`
      SELECT s.id FROM agent_sessions s
      WHERE ${scopeFilter(scope)} AND ${sql.join(
        words.map((word) => sql`s.title LIKE ${likeTerm(word)} ESCAPE '\\'`),
        sql` AND `,
      )}
      ORDER BY ${activity} DESC, s.id DESC
    `)
    .map((row): ScopedHit => ({ match: 'title', sessionId: row.id }))
  const titlePage = titles.slice(offset, offset + limit + 1)
  const wanted = limit + 1 - titlePage.length
  const content =
    wanted > 0
      ? tx.all<{ sessionId: string; seq: number; time: number; role: ContentRole; excerpt: string }>(sql`
          SELECT e.session_id AS sessionId, e.seq, e.created_at AS time, ${roleSql} AS role,
            snippet(agent_events_fts, -1, '', '', '…', 64) AS excerpt
          FROM agent_events_fts
          JOIN agent_events e ON e.rowid = agent_events_fts.rowid AND e.id = agent_events_fts.event_id
          JOIN agent_sessions s ON s.id = e.session_id
          WHERE agent_events_fts MATCH ${terms} AND ${scopeFilter(scope)}
            AND ${roleSql} IN ${inJson(roles)}
          ORDER BY agent_events_fts.rank, e.session_id, e.seq
          LIMIT ${wanted} OFFSET ${Math.max(0, offset - titles.length)}
        `)
      : []
  const hits = [
    ...titlePage,
    ...content.map(({ role, ...hit }): ScopedHit => ({ match: role, ...hit, excerpt: hit.excerpt.slice(0, 600) })),
  ]
  return { hits: hits.slice(0, limit), more: hits.length > limit }
}

// ─── Reading a thread ────────────────────────────────────────────────────────────────────────────

export type ThreadItem = {
  role: 'user' | 'assistant' | 'tool' | 'status' | 'error' | 'diagnostic'
  time: number
  fromSeq: number
  toSeq: number
  text: string
  tool?: { name: string; status?: AgentToolCall['status']; exitCode?: number }
  subagentId?: string
}

const json = (path: string) => sql.raw(`json_extract(e.event_json, '$.${path}')`)
const STOPPED_STATES = sql`('failed', 'stopped')`

/** The rows that begin an item. A streamed reply's continuation has no search text once the search
 *  projection has caught up, and a tool call's superseded opener has none either, so neither starts
 *  one. The caller catches the session up first. */
const itemStart = (view: ThreadView) => sql`(
  (e.search_text IS NOT NULL AND ${json('type')} IN ('user_message', 'assistant_message', 'error', 'diagnostic'))
  OR (${json('type')} = 'session_state' AND ${json('state')} IN ${STOPPED_STATES})
  ${view === 'with_tools' ? sql`OR (${json('type')} = 'tool' AND e.search_text IS NOT NULL)` : sql``}
)`

/** Up to `count` item starts at or below `atOrBefore`, latest first. */
export function itemStartsBefore(
  tx: Transaction,
  sessionId: string,
  view: ThreadView,
  atOrBefore: number,
  count: number,
): number[] {
  return tx
    .all<{ seq: number }>(sql`
      SELECT e.seq FROM agent_events e
      WHERE e.session_id = ${sessionId} AND e.seq <= ${atOrBefore} AND ${itemStart(view)}
      ORDER BY e.seq DESC LIMIT ${count}
    `)
    .map((row) => row.seq)
}

type ThreadRow = { seq: number; turnId: string | null; eventJson: string; textless: number; time: number }

const BATCH = 128

/**
 * Fold rows from `fromSeq` through `boundary` into up to `maxItems` readable items. A streamed reply
 * becomes one message by the rule the search index joins it on. A tool call appears once, at its
 * latest row inside the boundary. `nextSeq` is where the next item starts, or null at the boundary.
 */
export function foldThread(
  tx: Transaction,
  sessionId: string,
  view: ThreadView,
  fromSeq: number,
  boundary: number,
  maxItems: number,
): { items: ThreadItem[]; nextSeq: number | null } {
  const types =
    view === 'with_tools'
      ? sql`('user_message', 'assistant_message', 'error', 'diagnostic', 'session_state', 'tool')`
      : sql`('user_message', 'assistant_message', 'error', 'diagnostic', 'session_state')`
  const items: ThreadItem[] = []
  let previous: { seq: number; turnId: string | null; event: AgentNormalizedEvent } | null = null
  let after = fromSeq - 1
  for (;;) {
    const rows = tx.all<ThreadRow>(sql`
      SELECT e.seq, e.turn_id AS turnId, e.event_json AS eventJson, e.search_text IS NULL AS textless,
        e.created_at AS time
      FROM agent_events e
      WHERE e.session_id = ${sessionId} AND e.seq > ${after} AND e.seq <= ${boundary} AND ${json('type')} IN ${types}
      ORDER BY e.seq LIMIT ${BATCH}
    `)
    if (!rows.length) return { items, nextSeq: null }
    const superseded = view === 'with_tools' ? supersededOpeners(tx, sessionId, rows, boundary) : new Set<number>()
    for (const row of rows) {
      const event = parseStoredEvent(row.eventJson)
      const current = event && { seq: row.seq, turnId: row.turnId, event }
      const last = items.at(-1)
      if (
        current &&
        previous &&
        previous.seq === row.seq - 1 &&
        continuesStream(previous, current) &&
        last?.role === 'assistant' &&
        last.toSeq === previous.seq
      ) {
        last.text += (current.event as { text: string }).text
        last.toSeq = row.seq
      } else {
        const item = event && !superseded.has(row.seq) ? readableItem(event, row) : null
        if (item) {
          if (items.length === maxItems) return { items, nextSeq: row.seq }
          items.push(item)
        }
      }
      previous = current
    }
    after = rows.at(-1)!.seq
  }
}

function readableItem(event: AgentNormalizedEvent, row: ThreadRow): ThreadItem | null {
  const at = { time: row.time, fromSeq: row.seq, toSeq: row.seq }
  const subagent = (id: string | undefined) => (id ? { subagentId: id } : {})
  switch (event.type) {
    case 'user_message':
      return { role: 'user', ...at, text: event.text, ...subagent(event.subagentId) }
    case 'assistant_message':
      return { role: 'assistant', ...at, text: event.text, ...subagent(event.subagentId) }
    case 'error':
      return { role: 'error', ...at, text: `${event.code}: ${event.message}` }
    case 'diagnostic':
      return { role: 'diagnostic', ...at, text: event.message }
    case 'session_state':
      return event.state === 'failed' || event.state === 'stopped'
        ? { role: 'status', ...at, text: `Session ${event.state}${event.detail ? `: ${event.detail}` : ''}` }
        : null
    case 'tool': {
      const { tool } = event
      return {
        role: 'tool',
        ...at,
        tool: {
          name: tool.name ?? tool.title,
          ...(tool.status ? { status: tool.status } : {}),
          ...(tool.exitCode === undefined ? {} : { exitCode: tool.exitCode }),
        },
        text: [`Title: ${tool.title}`, tool.input && `Input:\n${tool.input}`, tool.output && `Output:\n${tool.output}`]
          .filter(Boolean)
          .join('\n\n'),
        ...subagent(tool.subagentId),
      }
    }
    default:
      return null
  }
}

/** A tool call keeps its opener and its latest row. The opener gives up its search text when a later
 *  row arrives; it is skipped here only when that later row falls inside the boundary, so a call
 *  updated after the read began still appears once, as it stood at the boundary. */
function supersededOpeners(tx: Transaction, sessionId: string, rows: ThreadRow[], boundary: number): Set<number> {
  const openers = rows.flatMap((row) => {
    if (!row.textless) return []
    const event = parseStoredEvent(row.eventJson)
    return event?.type === 'tool' ? [{ seq: row.seq, turnId: row.turnId, toolId: event.tool.id }] : []
  })
  if (!openers.length) return new Set()
  const turnIds = [...new Set(openers.flatMap((opener) => (opener.turnId === null ? [] : [opener.turnId])))]
  const nullTurn = openers.some((opener) => opener.turnId === null) ? sql`OR e.turn_id IS NULL` : sql``
  const later = tx.all<{ turnId: string | null; toolId: string }>(sql`
    SELECT e.turn_id AS turnId, ${json('tool.id')} AS toolId FROM agent_events e
    WHERE e.session_id = ${sessionId} AND e.seq > ${openers[0]!.seq} AND e.seq <= ${boundary}
      AND (e.turn_id IN ${inJson(turnIds)} ${nullTurn})
      AND ${json('type')} = 'tool' AND e.search_text IS NOT NULL
  `)
  const key = (turnId: string | null, toolId: string) => `${turnId ?? ''}\n${toolId}`
  const updated = new Set(later.map((row) => key(row.turnId, row.toolId)))
  return new Set(openers.filter((opener) => updated.has(key(opener.turnId, opener.toolId))).map((o) => o.seq))
}
