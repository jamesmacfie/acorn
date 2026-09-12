import type { AgentSession } from '@acorn/protocol/managedAgents.ts'

// The run behind a workflow-started session, read off the row.
//
// The node writes `workflowRunId` and `workflowStepId` onto the session's config when a step starts it
// (../../server/sessions/sessionExecute.ts) and re-broadcasts the row after every event it records, so
// this answers while the step is still running and costs no request.
//
// Its own module rather than a function in ./AgentCenter.tsx, because a `.tsx` file cannot be imported
// from a node-environment test and this is the judgement worth testing: which sessions get a way back
// to the run, and where it points. The navigation underneath is `open`'s own three calls.
export const workflowRunOf = (session: AgentSession): { runId: string; stepId?: string } | undefined => {
  const runId = session.config.workflowRunId
  if (session.kind !== 'workflow' || typeof runId !== 'string' || !runId) return undefined
  const stepId = session.config.workflowStepId
  return { runId, stepId: typeof stepId === 'string' && stepId ? stepId : undefined }
}
