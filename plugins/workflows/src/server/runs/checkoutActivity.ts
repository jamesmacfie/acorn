/** A durable nonterminal run owns its checkout through gates, cancellation, and restart. */
export function workflowCheckoutActivity(row: {
  taskId: string
  status: string
}): Array<{ taskId: string; description: string }> {
  if (['done', 'completed-with-failures', 'failed', 'safety-rail', 'cancelled'].includes(row.status)) return []
  return [{ taskId: row.taskId, description: `workflow ${row.status}` }]
}

export async function readWorkflowCheckoutActivity(store: PluginDatabase, taskIds: readonly string[]) {
  if (!taskIds.length) return []
  const rows = await store
    .select({ taskId: workflowRuns.taskId, status: workflowRuns.status })
    .from(workflowRuns)
    .where(inArray(workflowRuns.taskId, [...taskIds]))
  return rows.flatMap(workflowCheckoutActivity)
}
import { inArray } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import { workflowRuns } from '../../node/schema'
