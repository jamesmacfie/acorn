import { and, inArray, notInArray } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import {
  workflowAgentLaunches,
  workflowDispatches,
  workflowRuns,
  workflowSteps,
  workflowTurnAdmissions,
} from '../../node/schema'

// A deleted task's runs and what is keyed by them (docs/workspaces-and-tasks/archive.md § Deleting a
// task). Processing history stays: a selection records which source rows a scheduled workflow already
// handled, and dropping it would make the next run process them again.

// The runner holds these in memory. A later daily pass removes them once they settle.
const MOVING = ['running', 'cancelling']

export function purgeDeletedTaskRuns(db: PluginDatabase, taskIds: readonly string[]): number {
  const runIds = db
    .select({ id: workflowRuns.id })
    .from(workflowRuns)
    .where(and(inArray(workflowRuns.taskId, [...taskIds]), notInArray(workflowRuns.status, MOVING)))
    .all()
    .map((run) => run.id)
  // An agent's launch receipt shares its run's ID. One that never started has no run, and with its
  // task gone it never will, so it goes too (../agentTools/launches.ts).
  const moving = db
    .select({ id: workflowRuns.id })
    .from(workflowRuns)
    .where(and(inArray(workflowRuns.taskId, [...taskIds]), inArray(workflowRuns.status, MOVING)))
    .all()
    .map((run) => run.id)
  db.delete(workflowAgentLaunches)
    .where(and(inArray(workflowAgentLaunches.taskId, [...taskIds]), notInArray(workflowAgentLaunches.id, moving)))
    .run()
  if (!runIds.length) return 0
  return db.transaction((tx) => {
    tx.delete(workflowSteps).where(inArray(workflowSteps.runId, runIds)).run()
    tx.delete(workflowTurnAdmissions).where(inArray(workflowTurnAdmissions.runId, runIds)).run()
    tx.delete(workflowDispatches).where(inArray(workflowDispatches.runId, runIds)).run()
    return tx.delete(workflowRuns).where(inArray(workflowRuns.id, runIds)).run().changes
  })
}
