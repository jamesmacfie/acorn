import { rememberWorkflowRun } from './runs/runStore'
import { workflowApi } from './workflowsClient'

// A confirmed start makes the task's pane available immediately. The node-wide run read and
// run-changed frame still reconcile the durable list, but either can arrive after navigation.
export async function startWorkflow(
  taskId: string, body: Parameters<typeof workflowApi.start>[1], inputs?: Parameters<typeof workflowApi.start>[2],
  onTrusted?: (runId: string) => void, launchId?: string, api = workflowApi,
): ReturnType<typeof workflowApi.start> {
  const result = await api.start(taskId, body, inputs, (runId) => {
    rememberWorkflowRun(taskId)
    onTrusted?.(runId)
  }, launchId)
  if (result.runId) rememberWorkflowRun(taskId)
  return result
}
