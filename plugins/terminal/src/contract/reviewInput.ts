import { capabilityId } from '@acorn/protocol/plugin/ids.ts'

export type TerminalCompletedEvent = {
  taskId: string
  sessionId: string
  exitCode: number | null
  completedAt: number
}

export type TerminalReviewInput = TerminalCompletedEvent & {
  availability: 'available' | 'unavailable'
  output: string | null
  unavailableReason: string | null
}

export type TerminalReviewInputCapability = {
  read(taskId: string, sessionId: string): Promise<TerminalReviewInput>
}

export const TERMINAL_REVIEW_INPUT = capabilityId<TerminalReviewInputCapability>('terminal.reviewInput.v1')
