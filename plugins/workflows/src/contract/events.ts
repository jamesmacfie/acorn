import { capabilityId } from '@acorn/protocol/plugin/ids.ts'

export type WorkflowRunStatus = 'running' | 'gated' | 'cancelling' | 'done' | 'failed' | 'safety-rail' | 'cancelled'
export type WorkflowGateStatus = 'waiting-gate' | 'done' | 'failed' | 'cancelled'

export type WorkflowRunChangedEvent = {
  taskId: string
  runId: string
  status: WorkflowRunStatus
}

export type WorkflowGateChangedEvent = {
  taskId: string
  runId: string
  stepId: string
  status: WorkflowGateStatus
}

export type WorkflowGateRecord = WorkflowGateChangedEvent & { name: string }

/** Rebuild a task's approval inbox after reconnecting or missing a gate event. */
export type WorkflowGatesCapability = {
  list(taskId: string): Promise<WorkflowGateRecord[]>
}

export const WORKFLOW_GATES = capabilityId<WorkflowGatesCapability>('workflows.gates')
