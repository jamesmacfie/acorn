/** Durable turns cover queued, waiting, retry, and cancellation settlement across restarts. */
export function agentCheckoutActivity(row: {
  taskId: string
  runtimeState: string
  status: string | null
}): Array<{ taskId: string; description: string }> {
  if (row.status && !['completed', 'failed', 'cancelled', 'interrupted', 'steered'].includes(row.status)) {
    return [{ taskId: row.taskId, description: `agent turn ${row.status}` }]
  }
  if (!['ready', 'stopped', 'failed', 'archived'].includes(row.runtimeState)) {
    return [{ taskId: row.taskId, description: `agent session ${row.runtimeState}` }]
  }
  return []
}

export async function readAgentCheckoutActivity(store: PluginDatabase, taskIds: readonly string[]) {
  if (!taskIds.length) return []
  const rows = await store
    .select({
      taskId: schema.agentSessions.taskId,
      runtimeState: schema.agentSessions.runtimeState,
      status: schema.agentTurns.status,
    })
    .from(schema.agentSessions)
    .leftJoin(schema.agentTurns, eq(schema.agentSessions.id, schema.agentTurns.sessionId))
    .where(inArray(schema.agentSessions.taskId, [...taskIds]))
  return rows.flatMap(agentCheckoutActivity)
}
import { eq, inArray } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import * as schema from '../../node/schema'
