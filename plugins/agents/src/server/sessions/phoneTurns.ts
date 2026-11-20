import type { AgentRequest, AgentSession, AgentTurn } from '../../contract/wire.ts'
import { executionPolicyOptionId, executionPolicyRank, executionPolicyValueRank } from './executionPolicy'

// What a phone that a computer hasn't given shell access may ask of an agent
// (docs/relay/phone-channel/phone-devices.md § Shell access). The phone app runs on the account website's origin, so
// whoever controls that website can send what the phone sends. Such a phone drives an agent only while a
// person approves each of the agent's commands, and it approves none of them itself.
//
// `fromPhoneWithoutShell` on a turn's `effectivePolicy` marks a turn such a phone sent. Only the turn
// route writes it. The engine reads it again before it sends the turn or steers it into a running one,
// because the session's mode can change while the turn waits.

/** Thrown for something a phone needs shell access to do. The bridge answers it 403 `phone_refused`. */
export class PhoneShellRequiredError extends Error {
  override name = 'PhoneShellRequiredError'
}

const ASK_FIRST =
  'From a phone without shell access, an agent takes work only while it asks before each command. Set the agent to ask first, or give this phone shell access from Settings → Nodes on a computer.'
const APPROVE_ON_COMPUTER =
  'Approving this runs commands on the Node, and this phone doesn’t have shell access. Answer it on a computer, or give this phone shell access from Settings → Nodes.'

/** True when a person approves each of this session's commands: execution-policy rank 0. */
const asksBeforeCommands = (session: Pick<AgentSession, 'providerId' | 'config'>): boolean =>
  executionPolicyRank(session.providerId, session.config.configOptions) === 0

/** Why the engine can't send or steer this turn at the session's current mode, or null. */
export function phoneTurnRefusal(
  session: Pick<AgentSession, 'providerId' | 'config'>,
  turn: Pick<AgentTurn, 'effectivePolicy'>,
): string | null {
  return turn.effectivePolicy.fromPhoneWithoutShell === true && !asksBeforeCommands(session) ? ASK_FIRST : null
}

/**
 * Refuses a phone's answer to a request. A permission or a workflow gate is an approval, and the rest
 * are answers an agent acts on, so those stand only in a session that asks before each command.
 */
export function assertPhoneMayAnswer(
  session: Pick<AgentSession, 'providerId' | 'config'>,
  request: Pick<AgentRequest, 'kind'>,
): void {
  if (request.kind === 'permission' || request.kind === 'workflow_gate')
    throw new PhoneShellRequiredError(APPROVE_ON_COMPUTER)
  if (!asksBeforeCommands(session)) throw new PhoneShellRequiredError(ASK_FIRST)
}

/** Refuses a phone's change of a session's mode to one that runs commands without asking. */
export function assertPhoneKeepsAsking(providerId: string, changed: readonly { id: string; value: string }[]): void {
  const optionId = executionPolicyOptionId(providerId)
  const widened = changed.find(
    (option) => option.id === optionId && executionPolicyValueRank(providerId, option.value) !== 0,
  )
  if (widened) throw new PhoneShellRequiredError(ASK_FIRST)
}
