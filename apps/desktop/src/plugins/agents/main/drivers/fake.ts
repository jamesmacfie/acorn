import { randomUUID } from 'node:crypto'
import type { AgentProviderDescriptor } from '../../../../core/shared/managedAgents'
import type { AgentDriver, AgentDriverSession, AgentDriverStartOptions, AgentDriverTurnOptions } from './types'

export class FakeAgentDriver implements AgentDriver {
  readonly providerId = 'fake'
  readonly profileId = 'fake'

  async probe(): Promise<AgentProviderDescriptor> {
    return {
      id: this.providerId,
      profileId: this.profileId,
      label: 'Fake managed agent',
      driverKind: 'acp',
      driverVersion: 'test-1',
      installed: true,
      authenticated: true,
      statusAuthority: 'protocol',
      capabilities: ['streaming_messages', 'tool_calls', 'permissions', 'questions', 'resume', 'usage'],
      configOptions: [],
      commands: [],
      skills: [],
      diagnostics: [],
    }
  }

  async start(options: AgentDriverStartOptions): Promise<AgentDriverSession> {
    const providerSessionRef = options.session.providerSessionRef ?? `fake-${randomUUID()}`
    let active = false
    let stopped = false
    await options.onEvent({ type: 'session_state', state: options.session.providerSessionRef ? 'replaying' : 'connecting' })
    await options.onEvent({ type: 'session_metadata', providerSessionRef })
    await options.onEvent({ type: 'session_state', state: 'ready' })
    return {
      providerSessionRef,
      get ready() {
        return !active && !stopped
      },
      async sendTurn(turn: AgentDriverTurnOptions) {
        active = true
        await options.onEvent({ type: 'assistant_message', text: `Fake response for ${turn.turn.id}` })
        await options.onEvent({ type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } })
        await options.onEvent({ type: 'turn_completed', stopReason: 'end_turn' })
        active = false
        return { providerTurnRef: `fake-turn-${turn.turn.id}` }
      },
      async cancel() {
        active = false
      },
      async resolveRequest(providerRequestId, resolution) {
        await options.onEvent({ type: 'request_resolved', requestId: providerRequestId, resolution })
      },
      async stop() {
        stopped = true
        await options.onEvent({ type: 'session_state', state: 'stopped' })
      },
    }
  }
}
