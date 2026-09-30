import { rememberWorkflowRun } from './runs/runStore'
import { workflowApi } from './workflowsClient'

// A confirmed start makes the task's pane available immediately. The node-wide run read and
// run-changed frame still reconcile the durable list, but either can arrive after navigation.
export async function startWorkflow(...args: Parameters<typeof workflowApi.start>): ReturnType<typeof workflowApi.start> {
  const result = await workflowApi.start(...args)
  if (result.runId) rememberWorkflowRun(args[0])
  return result
}
