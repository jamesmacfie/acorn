import { capabilityId } from '@acorn/protocol/plugin/ids.ts'
import type { WorkflowChildRunSummary } from '../shared/api'

export type WorkflowRunStatus =
  | 'running'
  | 'gated'
  | 'cancelling'
  | 'done'
  | 'completed-with-failures'
  | 'failed'
  | 'safety-rail'
  | 'cancelled'
export type WorkflowGateStatus = 'waiting-gate' | 'done' | 'failed' | 'cancelled'

type WorkflowGateChangedEvent = {
  taskId: string
  runId: string
  stepId: string
  status: WorkflowGateStatus
}

export type WorkflowChildChangedEvent = WorkflowChildRunSummary & {
  /** Parent task whose run surface should refresh. */
  ownerTaskId: string
}

type WorkflowGateRecord = WorkflowGateChangedEvent & { name: string }

/** Rebuild a task's approval inbox after reconnecting or missing a gate event. */
export type WorkflowGatesCapability = {
  list(taskId: string): Promise<WorkflowGateRecord[]>
}

export const WORKFLOW_GATES = capabilityId<WorkflowGatesCapability>('workflows.gates')
