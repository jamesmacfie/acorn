import { clientCapabilityId } from '@acorn/plugin-api/client'
import type { WorkflowRunRow, WorkflowStepRow } from '@acorn/protocol/workflow.ts'

// The slice of workflow control the agent task sidebar needs, declared by the consumer.
//
// The sidebar's roster merges agent sessions with workflow steps, so it needs three reads from
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
}

export const WORKFLOW_CONTROL = clientCapabilityId<WorkflowControl>('workflows.control')
