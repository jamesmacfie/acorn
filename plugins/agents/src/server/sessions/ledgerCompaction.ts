import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import * as schema from '../../node/schema'
import { agentEventSearchText } from '../../contract/wire.ts'
import { cardKeyColumns, cardKeyOf, foldCard, parseStoredEvent, type CardKeyFields } from './ledgerFold'

// The one-off half of ./ledgerFold.ts: puts the tool calls and file changes stored before that fold
// existed into the shape it writes. Each card keeps its opening row and its last row, which now holds
// the folded state, and loses every row between. The opener gives up its search text, so the index
// holds each card once.
//
// It runs in the background after boot (runtimeEngine.ts § reconcile), because the database it was
// written for is 1.3 GB and boot must not wait on it. It reads and writes in small steps and yields
// between them, so the node keeps serving. A session is marked when it is done, and a pass reads only
// unmarked sessions, so a restart part-way through picks up where it stopped. Running a session again
// changes nothing.
//
// Rewriting a card's last row in place is safe where rewriting the opener would not be. Any reader
// already holds the opener and some prefix of the updates, and the folded row replaces every field it
// could hold, so it folds to the same card whichever prefix that is.
//
// The space it frees stays inside the file, because the database has no auto-vacuum and turning it
// on takes a full VACUUM. New rows reuse the pages. docs/data-layer.md § Retention says why nothing
// here runs a VACUUM.

export type LedgerCompaction = { sessions: number; deleted: number; rewritten: number }

// How much each synchronous step takes on: rows read while finding the cards, rows folded per
// transaction, and pages of search-index merging. On a 1.3 GB database these kept the median step to a
// few milliseconds. The longest was one card of about a thousand rows, which cannot be split, at about
// 120 ms. A test passes smaller ones to cross the step boundaries with a handful of rows.
export type LedgerCompactionSteps = { scanRows: number; writeRows: number; mergePages: number }
const STEPS: LedgerCompactionSteps = { scanRows: 500, writeRows: 30, mergePages: 50 }

const yieldToNode = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

type Transaction = Parameters<Parameters<PluginDatabase['transaction']>[0]>[0]

// One card, given the sequences the scan found for it.
function compactCard(tx: Transaction, sessionId: string, seqs: number[]): { deleted: number; rewritten: number } {
  const unchanged = { deleted: 0, rewritten: 0 }
  const rows = tx
    .select({
      id: schema.agentEvents.id,
      seq: schema.agentEvents.seq,
      eventJson: schema.agentEvents.eventJson,
      searchText: schema.agentEvents.searchText,
    })
    .from(schema.agentEvents)
    .where(and(eq(schema.agentEvents.sessionId, sessionId), inArray(schema.agentEvents.seq, seqs)))
    .all()
    .sort((left, right) => left.seq - right.seq)
  // A row gone since the scan means an update arrived and recordEvent folded this card itself.
  if (rows.length !== seqs.length) return unchanged
  const head = rows[0]!
  const last = rows.at(-1)!
  // An opener without search text is one a fold already wrote.
  if (rows.length === 2 && head.searchText === null) return unchanged
  const events = rows.map((row) => parseStoredEvent(row.eventJson))
  // A row that cannot be read stays, and so does its card, rather than fold into something else.
  if (events.some((event) => event === null)) return unchanged
  const stored = foldCard(events as NonNullable<(typeof events)[number]>[])
  const middle = rows.slice(1, -1).map((row) => row.id)
  if (middle.length) tx.delete(schema.agentEvents).where(inArray(schema.agentEvents.id, middle)).run()
  const storedJson = JSON.stringify(stored)
  const rewrite = storedJson !== last.eventJson
  if (rewrite) {
    tx.update(schema.agentEvents)
      .set({ eventJson: storedJson, searchText: agentEventSearchText(stored) })
      .where(eq(schema.agentEvents.id, last.id))
      .run()
  }
  if (head.searchText !== null) {
    tx.update(schema.agentEvents).set({ searchText: null }).where(eq(schema.agentEvents.id, head.id)).run()
  }
  return { deleted: middle.length, rewritten: rewrite ? 1 : 0 }
}

/** Compact one session's cards. Returns `null` when the signal stopped it part-way. */
export async function compactSessionLedger(
  db: PluginDatabase,
  sessionId: string,
  signal?: AbortSignal,
  steps: LedgerCompactionSteps = STEPS,
): Promise<{ deleted: number; rewritten: number } | null> {
  // Every card's sequences first, because a card is only safe to fold whole: folding part of one would
  // make a later update the opener of the rest.
  const cards = new Map<string, number[]>()
  for (let after = 0; ;) {
    if (signal?.aborted) return null
    const rows = db.all<CardKeyFields & { seq: number; turnId: string | null }>(sql`
      SELECT seq, turn_id AS turnId, ${cardKeyColumns}
      FROM agent_events
      WHERE session_id = ${sessionId} AND seq > ${after}
      ORDER BY seq
      LIMIT ${steps.scanRows}
    `)
    for (const row of rows) {
      const key = cardKeyOf(row)
      if (!key) continue
      const card = `${row.turnId ?? ''}\n${key}`
      const seqs = cards.get(card)
      if (seqs) seqs.push(row.seq)
      else cards.set(card, [row.seq])
    }
    if (rows.length < steps.scanRows) break
    after = rows.at(-1)!.seq
    await yieldToNode()
  }
  const pending = [...cards.values()].filter((seqs) => seqs.length > 1)
  const done = { deleted: 0, rewritten: 0 }
  for (let at = 0; at < pending.length;) {
    if (signal?.aborted) return null
    const batch: number[][] = []
    for (let rows = 0; at < pending.length && (!batch.length || rows + pending[at]!.length <= steps.writeRows); at++) {
      batch.push(pending[at]!)
      rows += pending[at]!.length
    }
    db.transaction((tx) => {
      for (const seqs of batch) {
        const result = compactCard(tx, sessionId, seqs)
        done.deleted += result.deleted
        done.rewritten += result.rewritten
      }
    })
    await yieldToNode()
  }
  db.update(schema.agentSessions)
    .set({ ledgerCompactedAt: Date.now() })
    .where(eq(schema.agentSessions.id, sessionId))
    .run()
  return done
}

/**
 * Compact every session not yet marked. Returns what it did, and stops early when the signal fires.
 * A session that fails is left unmarked for the next boot, and the pass moves on.
 */
export async function compactLedgers(
  db: PluginDatabase,
  options: { signal?: AbortSignal; onError?: (sessionId: string, error: unknown) => void; steps?: LedgerCompactionSteps } = {},
): Promise<LedgerCompaction> {
  const steps = options.steps ?? STEPS
  const totals: LedgerCompaction = { sessions: 0, deleted: 0, rewritten: 0 }
  const sessions = db
    .select({ id: schema.agentSessions.id })
    .from(schema.agentSessions)
    .where(isNull(schema.agentSessions.ledgerCompactedAt))
    .orderBy(asc(schema.agentSessions.createdAt))
    .all()
  for (const { id } of sessions) {
    if (options.signal?.aborted) break
    try {
      const result = await compactSessionLedger(db, id, options.signal, steps)
      if (!result) break
      totals.sessions += 1
      totals.deleted += result.deleted
      totals.rewritten += result.rewritten
    } catch (error) {
      options.onError?.(id, error)
    }
  }
  if (totals.deleted) await mergeSearchIndex(db, steps.mergePages, options.signal)
  return totals
}

// A deleted row leaves a tombstone in the search index until its segments merge. The first pass
// deleted 118,000 indexed rows on the measured database, and merging took the index from 132 MB to
// 63 MB. FTS5 would merge them on its own as rows are written, but slowly. A negative page count
// merges every level, and a step that changes fewer than two rows means there is nothing left. The
// history retention pass calls it too (runtime.ts § removeArchivedHistory).
export async function mergeSearchIndex(db: PluginDatabase, pages = STEPS.mergePages, signal?: AbortSignal): Promise<void> {
  const changes = () => db.get<{ n: number }>(sql`SELECT total_changes() AS n`)?.n ?? 0
  while (!signal?.aborted) {
    const before = changes()
    db.run(sql`INSERT INTO agent_events_fts (agent_events_fts, rank) VALUES ('merge', ${-pages})`)
    if (changes() - before < 2) return
    await yieldToNode()
  }
}
