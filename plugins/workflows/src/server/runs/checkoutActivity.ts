/** A durable nonterminal run owns its checkout through gates, cancellation, and restart. */
export function workflowCheckoutActivity(row: { taskId: string; status: string }): Array<{ taskId: string; description: string }> {
  if (['done', 'completed-with-failures', 'failed', 'safety-rail', 'cancelled'].includes(row.status)) return []
  return [{ taskId: row.taskId, description: `workflow ${row.status}` }]
}
