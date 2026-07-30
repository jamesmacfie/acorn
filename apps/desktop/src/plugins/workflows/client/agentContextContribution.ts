import type { AgentContextContribution } from '../../../core/shared/agentContext'
import { contextSnapshot } from '../../../core/client/agent/contextSnapshot'
import { readJson } from '../../../core/client/apiClient'
import { workflowRunsRoute, workflowStepsRoute } from '../../../core/shared/api'
import type { WorkflowRunRow, WorkflowStepRow } from '../../../core/shared/workflow'

const workflowHistoryApi = {
  runs: (taskId: string) => readJson<WorkflowRunRow[]>(workflowRunsRoute(taskId)),
  steps: (runId: string) => readJson<WorkflowStepRow[]>(workflowStepsRoute(runId)),
}

export const workflowAgentContextContribution: AgentContextContribution = {
  id: 'acorn-workflows',
  label: 'Workflow runs',
  description: 'Capture recent workflow runs, steps, gates and managed-session lineage.',
  async capture(scope) {
    const runs = (await workflowHistoryApi.runs(scope.taskId)).slice(0, 20)
    const steps = (await Promise.all(runs.map(async (run) => ({
      run,
      steps: await workflowHistoryApi.steps(run.id),
    })))).flatMap(({ run, steps: runSteps }) =>
      runSteps.map((step) => ({
        run: run.name,
        runStatus: run.status,
        step: step.name,
        status: step.status,
        agentSessionId: step.agentSessionId,
      })))
    const content = [
      '# Workflow history',
      ...steps.slice(0, 200).map((row) =>
        `- ${row.run} (${row.runStatus}) · ${row.step}: ${row.status}${row.agentSessionId ? ` · agent ${row.agentSessionId}` : ''}`),
    ].join('\n')
    return [contextSnapshot({
      contextId: `workflows:${scope.taskId}:${Date.now()}`,
      label: `Workflows · ${runs.length} recent run${runs.length === 1 ? '' : 's'}`,
      content,
      source: 'workflows',
      resourceId: scope.taskId,
      provenance: 'Durable workflow run and step projections',
      deepLink: { pane: 'agents', intent: { kind: 'workflows:reveal' } },
      freshness: 'live',
      sensitivity: 'workspace',
    })]
  },
}
