import { describe, expect, it } from 'vitest'
import { decideAgentCommand, evolveAgentState, initialAgentMachineState } from './stateMachine'

describe('managed agent state machine', () => {
  it('dispatches only from protocol-ready state', () => {
    const initial = initialAgentMachineState()
    expect(decideAgentCommand(initial, { type: 'dispatch_turn', turnId: 't1' })).toMatchObject({ ok: false, code: 'not_ready' })
    const ready = evolveAgentState(initial, { type: 'session_state', state: 'ready' }, null)
    expect(decideAgentCommand(ready, { type: 'dispatch_turn', turnId: 't1' })).toEqual({ ok: true })
  })

  it('keeps request identity and clears it exactly once', () => {
    const ready = evolveAgentState(initialAgentMachineState(), { type: 'session_state', state: 'ready' }, null)
    const waiting = evolveAgentState(ready, {
      type: 'request',
      requestId: 'permission-1',
      kind: 'permission',
      title: 'Run command?',
    }, 'turn-1')
    expect(waiting).toMatchObject({ runtimeState: 'waiting', attention: 'permission' })
    expect(decideAgentCommand(waiting, { type: 'resolve_request', requestId: 'permission-1' })).toEqual({ ok: true })

    const working = evolveAgentState(waiting, {
      type: 'request_resolved',
      requestId: 'permission-1',
      resolution: { optionId: 'allow_once' },
    }, 'turn-1')
    expect(working).toMatchObject({ runtimeState: 'working', attention: 'none', pendingRequestIds: [] })
    expect(decideAgentCommand(working, { type: 'resolve_request', requestId: 'permission-1' })).toMatchObject({
      ok: false,
      code: 'request_not_pending',
    })
  })

  it('separates completion attention from runtime readiness', () => {
    const working = evolveAgentState(initialAgentMachineState(), { type: 'user_message', text: 'Fix it' }, 'turn-1')
    const complete = evolveAgentState(working, { type: 'turn_completed', stopReason: 'end_turn' }, 'turn-1')
    expect(complete).toMatchObject({ runtimeState: 'ready', attention: 'completed', activeTurnId: null })
  })
})
