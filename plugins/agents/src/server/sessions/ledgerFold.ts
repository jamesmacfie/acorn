import { inArray, sql } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import * as schema from '../../node/schema'
import type { AgentNormalizedEvent } from '../../contract/wire.ts'
import { mergeToolCall } from '../../shared/toolFold'

// A tool call or a file change is stored as two rows: the one that opened its card, and one that
// holds its whole latest state. docs/managed-agents/transcript-store.md § How the ledger stores a tool call says why.
//
// A harness reports a tool call as a run of updates on one id, and each used to stay in the ledger as
// its own row. On this developer's database that was 196,000 tool rows for 39,000 calls, 300 MB of
// JSON for cards every reader folds into one. So when an update arrives, the node folds the card's
// rows and the update into one state, writes it at the next sequence, and deletes the rows it
// supersedes, all in the event's own transaction.
//
// Why a new row and not an update in place: a client that holds a session reads on from its mark,
// because nothing below the mark can change. A row rewritten below the mark would never reach it.
// Why keep the opener: every reader places a card where its first row landed and keys it by that
// row's id, including the subagent stream it belongs to. Deleting it would move a call to where its
// last update landed on the next reload, which is not where it was drawn live.
//
// The socket still carries each update as the provider reported it. The stored row at that sequence
// holds the folded state, which folds to the same card on top of anything a reader already held.

type Transaction = Parameters<Parameters<PluginDatabase['transaction']>[0]>[0]

/** What a stored row needs to say to name its card, as SQL reads it out of `event_json`. */
export type CardKeyFields = {
  type: string | null
  toolId: string | null
  changeId: string | null
  path: string | null
}

/**
 * Which card a row updates, within its turn, or `null` for a row that is a moment of its own.
 *
 * The same keys the transcript folds on (client/sessions/conversationItems.ts): a tool call by its id,
 * and a file change by its change id and path. A file change with no change id is never folded there,
 * so it is not folded here either.
 */
export function cardKeyOf(fields: CardKeyFields): string | null {
  if (fields.type === 'tool' && fields.toolId != null) return `tool\n${fields.toolId}`
  if (fields.type === 'file_change' && fields.changeId != null) return `change\n${fields.changeId}\n${fields.path ?? ''}`
  return null
}

export const eventCardKey = (event: AgentNormalizedEvent): string | null => cardKeyOf({
  type: event.type,
  toolId: event.type === 'tool' ? event.tool.id : null,
  changeId: event.type === 'file_change' ? event.changeId ?? null : null,
  path: event.type === 'file_change' ? event.path ?? null : null,
})

/** The SQL that reads a row's card fields. Kept beside `cardKeyOf` so the two cannot drift. */
export const cardKeyColumns = sql`
  json_extract(event_json, '$.type') AS type,
  json_extract(event_json, '$.tool.id') AS toolId,
  json_extract(event_json, '$.changeId') AS changeId,
  json_extract(event_json, '$.path') AS path`

/**
 * One card's rows, in sequence order, as the single state a reader would fold them to.
 *
 * A tool call merges field by field, as the transcript does. The result carries no `outputAppend`, so
 * it replaces whatever output a reader already held rather than adding to it. A file change is a whole
 * report each time, so the last one is the state.
 */
export function foldCard(events: readonly AgentNormalizedEvent[]): AgentNormalizedEvent {
  return events.reduce((card, next) => card.type === 'tool' && next.type === 'tool'
    ? { type: 'tool', tool: mergeToolCall(card.tool, next.tool) }
    : next)
}

export const parseStoredEvent = (json: string): AgentNormalizedEvent | null => {
  try {
    return JSON.parse(json) as AgentNormalizedEvent
  } catch {
    return null
  }
}

type Card = { head: string; rest: string[] }

/** What recordEvent writes for an event: the row's stored state, and which rows it supersedes. */
export type LedgerFoldPlan = {
  /** The card's opening row. `null` when this event opens the card. */
  head: string | null
  stored: AgentNormalizedEvent
  superseded: string[]
  commit(eventId: string): void
}

// Turns whose cards are held. One per streaming session is the working set; a few more cover a late
// update to the turn before. Dropping one costs a seed read if it is written to again.
const KEPT_TURNS = 64

/**
 * The live half: which rows each open card has, so an update knows what to fold and delete without
 * searching the ledger.
 *
 * Held per turn, because a card is keyed by turn. A turn this process has not written to yet is read
 * from the ledger once, which also covers a call that was running when the node last stopped. The map
 * is a cache of what the ledger says. A row it names that has since gone, because the background pass
 * (./ledgerCompaction.ts) folded it, is skipped.
 */
export class LedgerFold {
  readonly #turns = new Map<string, Map<string, Card>>()

  plan(tx: Transaction, sessionId: string, turnId: string | null, event: AgentNormalizedEvent): LedgerFoldPlan | null {
    const key = eventCardKey(event)
    if (!key) return null
    const cards = this.#cards(tx, sessionId, turnId)
    const card = cards.get(key)
    const open = (): LedgerFoldPlan => ({
      head: null,
      stored: event,
      superseded: [],
      commit: (eventId) => cards.set(key, { head: eventId, rest: [] }),
    })
    if (!card) return open()
    // Only a tool call needs its rows' contents. A file change's latest report is its whole state.
    const rows = tx
      .select({
        id: schema.agentEvents.id,
        seq: schema.agentEvents.seq,
        eventJson: event.type === 'tool' ? schema.agentEvents.eventJson : sql<string>`''`,
      })
      .from(schema.agentEvents)
      .where(inArray(schema.agentEvents.id, [card.head, ...card.rest]))
      .all()
      .sort((left, right) => left.seq - right.seq)
    // The opener has the lowest sequence, so it comes first if it is still there. It goes only with its
    // session, and then this event has no session to land in either.
    if (rows[0]?.id !== card.head) return open()
    const stored = event.type === 'tool'
      ? foldCard([...rows.flatMap((row) => parseStoredEvent(row.eventJson) ?? []), event])
      : event
    return {
      head: card.head,
      stored,
      superseded: rows.slice(1).map((row) => row.id),
      commit: (eventId) => cards.set(key, { head: card.head, rest: [eventId] }),
    }
  }

  /** Drop what is held for a session, when the session goes. */
  forget(sessionId: string): void {
    for (const turnKey of this.#turns.keys()) if (turnKey.startsWith(`${sessionId}\n`)) this.#turns.delete(turnKey)
  }

  #cards(tx: Transaction, sessionId: string, turnId: string | null): Map<string, Card> {
    const turnKey = `${sessionId}\n${turnId ?? ''}`
    const held = this.#turns.get(turnKey)
    if (held) {
      this.#turns.delete(turnKey)
      this.#turns.set(turnKey, held)
      return held
    }
    const cards = new Map<string, Card>()
    const rows = tx.all<CardKeyFields & { id: string }>(sql`
      SELECT id, ${cardKeyColumns}
      FROM agent_events
      WHERE session_id = ${sessionId} AND turn_id IS ${turnId}
        AND json_extract(event_json, '$.type') IN ('tool', 'file_change')
      ORDER BY seq
    `)
    for (const row of rows) {
      const key = cardKeyOf(row)
      if (!key) continue
      const card = cards.get(key)
      if (card) card.rest.push(row.id)
      else cards.set(key, { head: row.id, rest: [] })
    }
    this.#turns.set(turnKey, cards)
    if (this.#turns.size > KEPT_TURNS) this.#turns.delete(this.#turns.keys().next().value as string)
    return cards
  }
}
