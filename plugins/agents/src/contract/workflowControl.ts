import { clientCapabilityId } from '@acorn/client-core/clientCapabilities.ts'
import type { WorkflowRunRow, WorkflowStepRow } from '@acorn/protocol/workflow.ts'

// The slice of workflow control the agent task sidebar needs, declared by the CONSUMER.
//
// The sidebar's roster merges agent sessions with workflow steps, so it genuinely needs three reads
// from plugins/workflows. Importing them directly would close a package cycle: workflows' node half
// already imports this plugin's AGENTS_SESSION_EXECUTE to run a step. So the direction is inverted —
// agents declares the interface it wants, workflows provides it (client/index.ts), and the only
// package edge stays the one that already existed.
//
// The row types come from @acorn/protocol/workflow.ts, which both sides already share; nothing about
// workflows' HTTP surface leaks in here.
export type WorkflowControl = {
  runs(taskId: string): Promise<WorkflowRunRow[]>
  steps(runId: string): Promise<WorkflowStepRow[]>
  gate(runId: string, stepId: string, approved: boolean): Promise<{ ok: boolean }>
}

export const WORKFLOW_CONTROL = clientCapabilityId<WorkflowControl>('workflows.control')
