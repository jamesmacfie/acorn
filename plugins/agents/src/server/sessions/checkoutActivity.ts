/** Durable turns cover queued, waiting, retry, and cancellation settlement across restarts. */
export function agentCheckoutActivity(row: { taskId: string; runtimeState: string; status: string | null }): Array<{ taskId: string; description: string }> {
  if (row.status && !['completed', 'failed', 'cancelled', 'interrupted'].includes(row.status)) {
    return [{ taskId: row.taskId, description: `agent turn ${row.status}` }]
  }
  if (!['ready', 'stopped', 'failed', 'archived'].includes(row.runtimeState)) {
    return [{ taskId: row.taskId, description: `agent session ${row.runtimeState}` }]
  }
  return []
}
