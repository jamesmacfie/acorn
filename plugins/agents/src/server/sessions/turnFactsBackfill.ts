import { sql } from 'drizzle-orm'
import { createLogger, describeError, type PluginDatabase } from '@acorn/plugin-api/node'
import { TURN_FACTS_VERSION } from './turnFacts'
import { writeTurnFacts } from './turnFactsWriter'

// Facts for finished turns that have none, or whose row an older version of the rules wrote
// (docs/managed-agents/turn-facts.md). It runs in the background after the ledger compaction, a step of
// turns per transaction with a yield between steps, as compactLedgers does. A turn the retention pass
// removed has no row in agent_turns, so it gets no facts. No frame goes out for a backfilled row: a
// pass over a large history would send thousands, and a reader reads the rows when it opens.

export type TurnFactsBackfill = { turns: number; steps: number; longestStepMs: number }

const log = createLogger('agents:turn-facts', 'agents')

const yieldToNode = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

// A step ends early once its writes have held the database this long, so one long turn doesn't bring
// the rest of its batch with it. A single turn can't be split.
const STEP_MS = 100

export async function backfillTurnFacts(
  db: PluginDatabase,
  options: {
    projectOf(taskId: string): Promise<string | null>
    signal?: AbortSignal
    /** Turns per step. A test passes fewer to cross the step boundaries with a handful of rows. */
    batch?: number
  },
): Promise<TurnFactsBackfill> {
  const batch = options.batch ?? 50
  const totals: TurnFactsBackfill = { turns: 0, steps: 0, longestStepMs: 0 }
  const projects = new Map<string, string | null>()
  // Oldest first, by the turns' insertion order, so a pass that stops part-way has done the old ones.
  for (let after = 0; !options.signal?.aborted;) {
    let started = performance.now()
    const turns = db.all<{ at: number; id: string; taskId: string }>(sql`
      SELECT t.rowid AS at, t.id, s.task_id AS taskId
      FROM agent_turns t
      JOIN agent_sessions s ON s.id = t.session_id
      LEFT JOIN agent_turn_facts f ON f.turn_id = t.id
      WHERE t.rowid > ${after}
        AND t.status IN ('completed', 'failed', 'cancelled', 'interrupted')
        AND t.started_at IS NOT NULL AND t.completed_at IS NOT NULL
        AND (f.turn_id IS NULL OR f.version < ${TURN_FACTS_VERSION})
      ORDER BY t.rowid
      LIMIT ${batch}
    `)
    let held = performance.now() - started
    if (!turns.length) break
    for (const { taskId } of turns) if (!projects.has(taskId)) projects.set(taskId, await options.projectOf(taskId))
    if (options.signal?.aborted) break
    started = performance.now()
    let done = 0
    try {
      totals.turns += db.transaction((tx) => {
        let written = 0
        for (const turn of turns) {
          if (writeTurnFacts(tx, turn.id, projects.get(turn.taskId) ?? null)) written++
          done++
          if (performance.now() - started >= STEP_MS) break
        }
        return written
      })
    } catch (error) {
      // The next boot tries these turns again.
      log.warn(`could not backfill turn facts: ${describeError(error).message}`)
      done = turns.length
    }
    after = turns[done - 1]!.at
    held += performance.now() - started
    totals.steps += 1
    totals.longestStepMs = Math.max(totals.longestStepMs, held)
    await yieldToNode()
  }
  if (totals.turns) {
    log.info(
      `backfilled the facts of ${totals.turns} turns in ${totals.steps} steps, the longest ${Math.round(totals.longestStepMs)} ms`,
    )
  }
  return totals
}
