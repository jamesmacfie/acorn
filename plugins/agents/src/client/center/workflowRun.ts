import type { AgentSession } from '../../contract/wire.ts'

// The run behind a workflow-started session, read off the row. The node writes `workflowRunId` and
// `workflowStepId` onto the session's config when a step starts it (`createSessionExecute`) and
// broadcasts the row whenever it changes, so this answers while the step is still running and costs
// no request.
//
// Its own module rather than a function in `AgentCenter`, because a `.tsx` file cannot be imported
// from a node-environment test.
export const workflowRunOf = (session: AgentSession): { runId: string; stepId?: string } | undefined => {
  const runId = session.config.workflowRunId
  if (session.kind !== 'workflow' || typeof runId !== 'string' || !runId) return undefined
  const stepId = session.config.workflowStepId
  return { runId, stepId: typeof stepId === 'string' && stepId ? stepId : undefined }
}
