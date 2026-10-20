import { desc, inArray, notInArray } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import { terminalRuns } from '../node/schema'

type RunRecord = typeof terminalRuns.$inferInsert

// The host reads at most 5,000 records a run (docs/data-sources.md § Completeness and limits), so a
// cap at that budget lets every read see the whole table.
export const RUN_RECORD_CAP = 5_000

/** Records a finished run and drops the oldest rows past the cap. */
export async function recordRun(db: PluginDatabase, run: RunRecord): Promise<void> {
  await db.insert(terminalRuns).values(run).onConflictDoNothing()
  const newest = db
    .select({ id: terminalRuns.id })
    .from(terminalRuns)
    .orderBy(desc(terminalRuns.finishedAt), desc(terminalRuns.id))
    .limit(RUN_RECORD_CAP)
  await db.delete(terminalRuns).where(notInArray(terminalRuns.id, newest))
}

/** Removes deleted tasks' runs. */
export const deleteTaskRuns = async (db: PluginDatabase, taskIds: readonly string[]): Promise<number> =>
  (await db.delete(terminalRuns).where(inArray(terminalRuns.taskId, [...taskIds]))).changes
