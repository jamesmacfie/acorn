import { inArray } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import { workflowRuns, workflowSteps } from '../../node/schema'
import { readPolicyWait } from '../../shared/policyWait'

const TERMINAL_RUN = new Set(['done', 'completed-with-failures', 'failed', 'safety-rail', 'cancelled'])
const LIVE_STEP = ['running', 'waiting-gate', 'waiting-children']

type StepActivity = { status: string; inputsJson: string | null }

/** True when everything the run has started is waiting and doing nothing: a person's gate, or a
 *  polling gate between polls. A step that is starting or settling has no waiting step beside it, so
 *  that moment still counts as busy. */
function onlyWaiting(steps: readonly StepActivity[]): boolean {
  let waiting = false
  for (const step of steps) {
    if (step.status === 'waiting-gate') waiting = true
    else if (step.status === 'running' && readPolicyWait(step.inputsJson)?.state === 'sleeping') waiting = true
    else if (LIVE_STEP.includes(step.status)) return false
  }
  return waiting
}

/** A durable nonterminal run owns its checkout through cancellation and restart. While it only waits,
 *  the checkout is free, so somebody can commit and push during a day-long wait for review
 *  (docs/workflows/polling-gates.md). */
export function workflowCheckoutActivity(
  run: { taskId: string; status: string },
  steps: readonly StepActivity[] = [],
): Array<{ taskId: string; description: string }> {
  if (TERMINAL_RUN.has(run.status)) return []
  if (run.status !== 'cancelling' && onlyWaiting(steps)) return []
  return [{ taskId: run.taskId, description: `workflow ${run.status}` }]
}

export async function readWorkflowCheckoutActivity(store: PluginDatabase, taskIds: readonly string[]) {
  if (!taskIds.length) return []
  const runs = (
    await store
      .select({ id: workflowRuns.id, taskId: workflowRuns.taskId, status: workflowRuns.status })
      .from(workflowRuns)
      .where(inArray(workflowRuns.taskId, [...taskIds]))
  ).filter((run) => !TERMINAL_RUN.has(run.status))
  if (!runs.length) return []
  const steps = await store
    .select({ runId: workflowSteps.runId, status: workflowSteps.status, inputsJson: workflowSteps.inputsJson })
    .from(workflowSteps)
    .where(
      inArray(
        workflowSteps.runId,
        runs.map((run) => run.id),
      ),
    )
  return runs.flatMap((run) =>
    workflowCheckoutActivity(
      run,
      steps.filter((step) => step.runId === run.id && LIVE_STEP.includes(step.status)),
    ),
  )
}
