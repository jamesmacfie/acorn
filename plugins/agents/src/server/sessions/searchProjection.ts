import { sql } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import type { AgentNormalizedEvent } from '../../contract/wire'
import { agentEventSearchText } from '../../contract/wire'
import { continuesStream, isAppendDelta } from './durableEventBuffer'
import { eventCardKey, parseStoredEvent } from './ledgerFold'
import { searchDirtySchema, searchFtsTriggers } from './searchSchema'

type Transaction = Parameters<Parameters<PluginDatabase['transaction']>[0]>[0]
type Row = { id: string; seq: number; turnId: string | null; eventJson: string; searchText: string | null }
type Head = { row: Row; fragments: string[] }

/** SQLite owns dirty progress; this owner holds only one canonical page and one complete message.
 * A synchronous transaction couples materialization, FTS replacement, and clearing dirty progress.
 * There is no retained message cache, timer, or asynchronous task that can revive deleted history. */
export class AgentSearchProjection {
  constructor(private readonly db: PluginDatabase) {
    this.recover()
  }

  flush(sessionId?: string): void {
    this.db.transaction((tx) => this.catchUp(tx, sessionId))
  }

  catchUp(tx: Transaction, sessionId?: string): void {
    for (;;) {
      const dirty = tx.get<{ sessionId: string; fromSeq: number }>(sql`
        SELECT session_id AS sessionId, from_seq AS fromSeq FROM agent_search_dirty
        ${sessionId === undefined ? sql`` : sql`WHERE session_id = ${sessionId}`} LIMIT 1
      `)
      if (!dirty) return
      this.materialize(tx, dirty.sessionId, dirty.fromSeq)
      tx.run(sql`DELETE FROM agent_search_dirty WHERE session_id = ${dirty.sessionId}`)
    }
  }

  private materialize(tx: Transaction, sessionId: string, fromSeq: number): void {
    // A continuation has null search_text; revisit its head preceding the earliest mutation.
    const start = tx.get<{ seq: number }>(sql`
      SELECT seq FROM agent_events WHERE session_id = ${sessionId} AND seq < ${fromSeq}
        AND search_text IS NOT NULL ORDER BY seq DESC LIMIT 1
    `)?.seq ?? 0
    let after = start - 1
    let previous: { seq: number; turnId: string | null; event: AgentNormalizedEvent } | null = null
    let head: Head | null = null
    const finish = () => {
      if (!head) return
      this.write(tx, head.row, head.fragments.join(''))
      head = null
    }
    for (;;) {
      const rows = tx.all<Row>(sql`
        SELECT id, seq, turn_id AS turnId, event_json AS eventJson, search_text AS searchText
        FROM agent_events WHERE session_id = ${sessionId} AND seq > ${after} ORDER BY seq LIMIT 128
      `)
      if (!rows.length) break
      for (const row of rows) {
        const event = parseStoredEvent(row.eventJson)
        if (!event) {
          finish()
          previous = null
          continue
        }
        if (isAppendDelta(event)) {
          if (previous && previous.seq === row.seq - 1 && continuesStream(previous, { turnId: row.turnId, event }) && head) {
            head.fragments.push(event.text)
            this.write(tx, row, null)
          } else {
            finish()
            head = { row, fragments: [event.text] }
          }
        } else {
          finish()
          // A folded card's opener deliberately has no search text. Its latest canonical row owns
          // the complete state. Keep that exclusion while rebuilding text from canonical JSON.
          const text = eventCardKey(event) && row.searchText === null ? null : agentEventSearchText(event)
          this.write(tx, row, text)
        }
        previous = { seq: row.seq, turnId: row.turnId, event }
      }
      after = rows.at(-1)!.seq
    }
    finish()
  }

  private write(tx: Transaction, row: Row, text: string | null): void {
    const indexed = text === null || text !== row.searchText || tx.get(sql`
      SELECT 1 FROM agent_events_fts f JOIN agent_events e ON e.rowid = f.rowid AND e.id = f.event_id
      WHERE e.id = ${row.id} AND
        CASE WHEN json_extract(e.event_json, '$.type') = 'tool' THEN f.tool ELSE f.content END IS ${text}
    `)
    if (text !== row.searchText || !indexed) tx.run(sql`UPDATE agent_events SET search_text = ${text} WHERE id = ${row.id}`)
  }

  private recover(): void {
    for (const statement of searchDirtySchema) this.db.run(sql.raw(statement))
    for (const statement of searchFtsTriggers) this.db.run(sql.raw(statement))
    // Restart reconciliation also detects lost dirty markers and stale materializations. It only
    // records work here; the first read or runtime shutdown performs the canonical scan.
    this.db.run(sql`INSERT INTO agent_search_dirty SELECT DISTINCT session_id, 0 FROM agent_events WHERE true
      ON CONFLICT (session_id) DO UPDATE SET from_seq = 0`)
    let repair = false
    try {
      this.db.run(sql`INSERT INTO agent_events_fts (agent_events_fts) VALUES ('integrity-check')`)
      repair = !!this.db.get(sql`
        SELECT 1 FROM agent_events_fts f LEFT JOIN agent_events e ON e.rowid = f.rowid AND e.id = f.event_id
        WHERE e.id IS NULL OR e.search_text IS NULL OR
          CASE WHEN json_extract(e.event_json, '$.type') = 'tool' THEN f.tool ELSE f.content END IS NOT e.search_text
        UNION ALL
        SELECT 1 FROM agent_events e LEFT JOIN agent_events_fts f ON f.rowid = e.rowid AND f.event_id = e.id
        WHERE e.search_text IS NOT NULL AND f.event_id IS NULL LIMIT 1
      `)
      this.db.run(sql`INSERT INTO agent_events_fts (agent_events_fts, rank) VALUES ('rank', 'bm25(0, 0, 1.0, 0.3)')`)
    } catch {
      repair = true
    }
    if (repair) this.rebuildIndex()
  }

  private rebuildIndex(): void {
    this.db.transaction((tx) => {
      tx.run(sql`DROP TABLE IF EXISTS agent_events_fts`)
      tx.run(sql`CREATE VIRTUAL TABLE agent_events_fts USING fts5(event_id UNINDEXED, session_id UNINDEXED, content, tool, tokenize = 'porter unicode61')`)
      tx.run(sql`INSERT INTO agent_events_fts (agent_events_fts, rank) VALUES ('rank', 'bm25(0, 0, 1.0, 0.3)')`)
      this.catchUp(tx)
      tx.run(sql`
        INSERT OR REPLACE INTO agent_events_fts (rowid, event_id, session_id, content, tool)
        SELECT rowid, id, session_id,
          CASE WHEN json_extract(event_json, '$.type') = 'tool' THEN NULL ELSE search_text END,
          CASE WHEN json_extract(event_json, '$.type') = 'tool' THEN search_text END
        FROM agent_events WHERE search_text IS NOT NULL
      `)
    })
  }
}
