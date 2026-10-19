import { and, asc, eq, sql } from 'drizzle-orm'
import { createLogger, describeError, type PluginDatabase } from '@acorn/plugin-api/node'
import * as schema from '../../node/schema'
import type { AgentUsage } from '../../contract/wire.ts'
import { parseStoredEvent } from './ledgerFold'
import { computeTurnFacts, type TurnFacts, type TurnFactsInput } from './turnFacts'

const log = createLogger('agents:turn-facts', 'agents')

type Transaction = Parameters<Parameters<PluginDatabase['transaction']>[0]>[0]

// The fields the rules never read, dropped in SQLite so a long turn's text and tool output never reach
// JavaScript. Tool input stays, because repeats compare it.
const slimEvent = sql<string>`json_remove(${schema.agentEvents.eventJson}, '$.text', '$.tool.output', '$.tool.title', '$.tool.web', '$.patch', '$.summary', '$.entries', '$.questions', '$.options', '$.subagent.usage')`

/** The turn's events through the `(turn_id, seq)` index, never the rest of its session. */
export const turnEventsQuery = (tx: Transaction | PluginDatabase, turnId: string) =>
  tx
    .select({ seq: schema.agentEvents.seq, createdAt: schema.agentEvents.createdAt, eventJson: slimEvent })
    .from(schema.agentEvents)
    .where(eq(schema.agentEvents.turnId, turnId))
    .orderBy(asc(schema.agentEvents.seq))

// Codex's tokens and every harness's cost count from the session's start, so a turn's share is what it
// adds to the last total before it. Each turn row keeps its last usage report, so the baseline is the
// newest earlier turn whose report carries a total, found among the session's turns, not its events.
const usageBefore = (tx: Transaction, sessionId: string, ordinal: number): AgentUsage | null => {
  const row = tx.get<{ usage: string }>(sql`
    SELECT usage_json AS usage
    FROM agent_turns
    WHERE session_id = ${sessionId} AND ordinal < ${ordinal}
      AND (json_extract(usage_json, '$.cost') IS NOT NULL OR json_extract(usage_json, '$.inputTokens') IS NOT NULL)
    ORDER BY ordinal DESC
    LIMIT 1
  `)
  if (!row) return null
  try {
    return JSON.parse(row.usage) as AgentUsage
  } catch {
    return null
  }
}

/**
 * Reads one turn, works out its facts, and stores them in the caller's transaction. Returns the row,
 * or null when the turn is gone or never ran.
 */
export function writeTurnFacts(tx: Transaction, turnId: string, projectId: string | null): TurnFacts | null {
  const head = tx
    .select({
      turn: {
        id: schema.agentTurns.id,
        sessionId: schema.agentTurns.sessionId,
        ordinal: schema.agentTurns.ordinal,
        source: schema.agentTurns.source,
        status: schema.agentTurns.status,
        startedAt: schema.agentTurns.startedAt,
        completedAt: schema.agentTurns.completedAt,
        effectivePolicyJson: schema.agentTurns.effectivePolicyJson,
      },
      taskId: schema.agentSessions.taskId,
      provider: schema.agentSessions.providerId,
    })
    .from(schema.agentTurns)
    .innerJoin(schema.agentSessions, eq(schema.agentTurns.sessionId, schema.agentSessions.id))
    .where(eq(schema.agentTurns.id, turnId))
    .get()
  if (!head) return null
  const events: TurnFactsInput['events'] = turnEventsQuery(tx, turnId)
    .all()
    .flatMap((row) => {
      const event = parseStoredEvent(row.eventJson)
      return event ? [{ seq: row.seq, createdAt: row.createdAt, event }] : []
    })
  const requests = tx
    .select({
      kind: schema.agentRequests.kind,
      createdAt: schema.agentRequests.createdAt,
      resolvedAt: schema.agentRequests.resolvedAt,
      blocked: sql<number>`json_extract(${schema.agentRequests.resolutionJson}, '$.blocked') IS NOT NULL`,
    })
    .from(schema.agentRequests)
    .where(and(eq(schema.agentRequests.sessionId, head.turn.sessionId), eq(schema.agentRequests.turnId, turnId)))
    .all()
  const facts = computeTurnFacts({
    ...head,
    projectId,
    events,
    requests: requests.map((request) => ({ ...request, blocked: Boolean(request.blocked) })),
    usageBefore: usageBefore(tx, head.turn.sessionId, head.turn.ordinal),
  })
  if (facts)
    tx.insert(schema.agentTurnFacts)
      .values(facts)
      .onConflictDoUpdate({ target: schema.agentTurnFacts.turnId, set: facts })
      .run()
  return facts
}

export type TurnFactsPorts = {
  db: PluginDatabase
  /** The task's project, read from core. Null when core no longer knows the task. */
  projectOf(taskId: string): Promise<string | null>
  /** After a row commits. */
  written(facts: TurnFacts): void
}

/**
 * Writes the facts of each turn that settles, one at a time and outside the turn's own transaction.
 * A failure is logged and left to the backfill pass, and never reaches the turn.
 */
export class TurnFactsWriter {
  readonly #pending = new Set<string>()
  #draining: Promise<void> | null = null

  constructor(private readonly ports: TurnFactsPorts) {}

  enqueue(turnId: string): void {
    this.#pending.add(turnId)
    this.#draining ??= this.#drain()
  }

  /** Resolves once every queued turn is written. */
  idle(): Promise<void> {
    return this.#draining ?? Promise.resolve()
  }

  async #drain(): Promise<void> {
    try {
      // A turn queued again while it is being written is visited again, because a Set's iterator sees
      // what is added after it starts.
      for (const turnId of this.#pending) {
        this.#pending.delete(turnId)
        try {
          await this.#write(turnId)
        } catch (error) {
          log.warn(`could not write the facts of turn ${turnId}: ${describeError(error).message}`)
        }
      }
    } finally {
      this.#draining = null
    }
  }

  async #write(turnId: string): Promise<void> {
    const { db } = this.ports
    const row = db
      .select({ taskId: schema.agentSessions.taskId })
      .from(schema.agentTurns)
      .innerJoin(schema.agentSessions, eq(schema.agentTurns.sessionId, schema.agentSessions.id))
      .where(eq(schema.agentTurns.id, turnId))
      .get()
    if (!row) return
    const projectId = await this.ports.projectOf(row.taskId)
    const facts = db.transaction((tx) => writeTurnFacts(tx, turnId, projectId))
    if (facts) this.ports.written(facts)
  }
}
