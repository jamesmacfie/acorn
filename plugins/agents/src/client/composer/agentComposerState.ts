import type { AgentSession } from '@acorn/protocol/managedAgents.ts'

const STARTING_STATES: ReadonlySet<AgentSession['runtimeState']> = new Set([
  'creating',
  'connecting',
  'replaying',
  'reconnecting',
])

/** The provider is still establishing an input-ready protocol session. Drafting remains local and
 * available during these states, but submitting would race startup metadata and saved defaults. */
export function agentSessionIsStarting(
  session: Pick<AgentSession, 'runtimeState'>,
): boolean {
  return STARTING_STATES.has(session.runtimeState)
}

export function agentComposerDisabledMessage(
  session: Pick<AgentSession, 'controller' | 'runtimeState'>,
  disabled = false,
): string | undefined {
  if (!disabled) return undefined
  if (session.runtimeState === 'archived') {
    return 'This session is archived and cannot accept new messages.'
  }
  if (session.controller === 'terminal') {
    return 'This session is controlled from the terminal. Choose “Return to managed mode” in the session menu to continue here.'
  }
  if (session.controller === 'external') {
    return 'This session is controlled by an external client and cannot accept messages in Acorn.'
  }
  return 'This session cannot accept messages right now.'
}
