import { describe, expect, it } from 'vitest'
import type { AgentController, AgentRuntimeState } from '../../../core/shared/managedAgents'
import { agentComposerDisabledMessage } from './agentComposerState'

function message(controller: AgentController, runtimeState: AgentRuntimeState, disabled = true) {
  return agentComposerDisabledMessage({ controller, runtimeState }, disabled)
}

describe('agentComposerDisabledMessage', () => {
  it('explains that terminal handoff owns input and how to return', () => {
    expect(message('terminal', 'stopped')).toBe(
      'This session is controlled from the terminal. Choose “Return to managed mode” in the session menu to continue here.',
    )
  })

  it('keeps external and archived ownership states distinct', () => {
    expect(message('external', 'stopped')).toBe(
      'This session is controlled by an external client and cannot accept messages in Acorn.',
    )
    expect(message('terminal', 'archived')).toBe(
      'This session is archived and cannot accept new messages.',
    )
  })

  it('returns no message while the composer is enabled', () => {
    expect(message('acorn', 'ready', false)).toBeUndefined()
  })
})
