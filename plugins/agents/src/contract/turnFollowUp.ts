// The `agents:turn-follow-up` point: how a plugin reviews an unattended turn before its owner reports
// (docs/managed-agents/unattended-follow-ups.md).
import { extensionPointId } from '@acorn/protocol/plugin/ids.ts'

/**
 * One finished turn of a workflow step or a delegated job, offered to reviewers before the owner
 * publishes its result. The window carries the turn's address, not its transcript: read it with
 * `agents.reviewInput.v1`, and send a note with the messenger, naming `turnId` as `originTurnId`.
 */
export type TurnFollowUpWindow = {
  taskId: string
  sessionId: string
  turnId: string
  /** Who waits on the result: a workflow step, or the managed agent that delegated the turn. */
  owner: 'workflow' | 'delegation'
  /** Epoch milliseconds. The window closes then, and the host refuses this plugin's later notes. */
  deadline: number
  /** Aborts at the deadline, and when the owner cancels or stops. */
  signal: AbortSignal
}

/** The owner waits for `review` to settle, or for the deadline, before it finishes the operation. */
export type TurnFollowUpContribution = {
  review(window: TurnFollowUpWindow): Promise<void>
}

export const AGENTS_TURN_FOLLOW_UP = extensionPointId<TurnFollowUpContribution>('agents:turn-follow-up')

/** The shared review deadline. A workflow step with less of its timeout left gets what's left. */
export const TURN_FOLLOW_UP_DEADLINE_MS = 30_000
