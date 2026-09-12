import { clientCapabilityId } from '@acorn/plugin-api/client'
import type { WorkflowRunRow, WorkflowStepRow } from '@acorn/protocol/workflow.ts'

// The slice of workflow control the agent pane needs, declared by the consumer.
//
// The pane's header names the workflow that started a session, so it needs a read from
// plugins/workflows. Importing them directly closes a package cycle, because workflows' node half
// already imports this plugin's AGENTS_SESSION_EXECUTE to run a step. Declaring the interface here and
// letting workflows provide it (client/index.ts) keeps the one package edge that already existed.
//
// The row types come from @acorn/protocol/workflow.ts, which both sides share, so none of workflows'
// HTTP surface leaks in.
export type WorkflowControl = {
  runs(taskId: string): Promise<WorkflowRunRow[]>
  steps(runId: string): Promise<WorkflowStepRow[]>
  gate(runId: string, stepId: string, approved: boolean): Promise<{ ok: boolean }>
  retry(runId: string, stepId: string, prompt?: string): Promise<{ ok: boolean; error?: string }>
  // The run and step behind a managed session, for the chip the pane's header draws. `null` when the
  // session was started by a person rather than by a run.
  runForSession(sessionId: string): Promise<{ run: WorkflowRunRow; step: WorkflowStepRow } | null>
}

export const WORKFLOW_CONTROL = clientCapabilityId<WorkflowControl>('workflows.control')
