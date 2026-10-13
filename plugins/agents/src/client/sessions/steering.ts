import type { AgentProviderDescriptor, AgentSession, AgentTurn } from '../../contract/wire.ts'

/** Whether a person can hand a queued message to the turn this session is running. Both clients'
 *  composer and queue read this, so they offer the action under the same conditions
 *  (docs/managed-agents/steering.md § In the clients). */
export const canSteer = (session: AgentSession, provider: AgentProviderDescriptor | undefined): boolean =>
  session.kind === 'interactive' &&
  session.controller === 'acorn' &&
  !session.archivedAt &&
  session.runtimeState === 'working' &&
  !!provider?.capabilities.includes('steering')

/** A queued row the Node will steer: one a person sent. */
export const steerableTurn = (turn: AgentTurn): boolean => turn.source === 'interactive' && turn.status === 'queued'
