import { randomUUID } from 'node:crypto'
import type { AgentProviderDescriptor } from '../../contract/wire.ts'
import type {
  AgentDriver,
  AgentDriverSession,
  AgentDriverStartOptions,
  AgentDriverSteerOptions,
  AgentDriverTurnOptions,
} from './types'

/** Test switches. `holdTurns` keeps each turn running until `finishTurns()`, so a test can steer into
 *  it. `steering` is what `steer` answers, so the runtime tests cover both outcomes without a harness. */
export type FakeAgentDriverOptions = { holdTurns?: boolean; steering?: 'taken' | 'missed' }

export class FakeAgentDriver implements AgentDriver {
  readonly providerId = 'fake'
  readonly profileId = 'fake'
  steering: 'taken' | 'missed'
  private readonly holdTurns: boolean
  private readonly held = new Set<() => void>()

  constructor(options: FakeAgentDriverOptions = {}) {
    this.holdTurns = options.holdTurns ?? false
    this.steering = options.steering ?? 'taken'
  }

  /** Ends every turn `holdTurns` is keeping open. */
  finishTurns(): void {
    for (const finish of this.held) finish()
    this.held.clear()
  }

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
      capabilities: ['streaming_messages', 'tool_calls', 'permissions', 'questions', 'resume', 'usage', 'steering'],
      configOptions: [],
      commands: [],
      skills: [],
      diagnostics: [],
    }
  }

  async start(options: AgentDriverStartOptions): Promise<AgentDriverSession> {
    const held = this.held
    const holdTurns = this.holdTurns
    const steering = () => this.steering
    const providerSessionRef = options.session.providerSessionRef ?? `fake-${randomUUID()}`
    let active = false
    let stopped = false
    await options.onEvent({
      type: 'session_state',
      state: options.session.providerSessionRef ? 'replaying' : 'connecting',
    })
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
        if (holdTurns) await new Promise<void>((finish) => held.add(finish))
        await options.onEvent({ type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } })
        await options.onEvent({ type: 'turn_completed', stopReason: 'end_turn' })
        active = false
        return { providerTurnRef: `fake-turn-${turn.turn.id}` }
      },
      async steer(steered: AgentDriverSteerOptions) {
        if (!active || steering() === 'missed') return 'missed'
        await options.onEvent({ type: 'steer_taken', turnId: steered.turn.id })
        await options.onEvent({ type: 'assistant_message', text: `Fake response for ${steered.turn.id}` })
        return 'taken'
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
