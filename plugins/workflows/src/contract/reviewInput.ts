import { capabilityId } from '@acorn/protocol/plugin/ids.ts'

export type WorkflowCompletedEvent = {
  taskId: string
  runId: string
  status: string
  completedAt: number
}

export type WorkflowReviewInput = WorkflowCompletedEvent & {
  availability: 'available' | 'unavailable'
  handoff: string | null
  unavailableReason: string | null
}

export type WorkflowReviewInputCapability = {
  listCompleted(taskId: string): Promise<WorkflowCompletedEvent[]>
  read(taskId: string, runId: string): Promise<WorkflowReviewInput>
}

export const WORKFLOW_REVIEW_INPUT = capabilityId<WorkflowReviewInputCapability>('workflows.reviewInput.v1')
