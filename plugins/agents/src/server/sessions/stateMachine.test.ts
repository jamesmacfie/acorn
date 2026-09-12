import { describe, expect, it } from 'vitest'
import type { AgentSubagent } from '@acorn/protocol/managedAgents.ts'
import {
  decideAgentCommand,
  evolveAgentState,
  foldSubagentRoster,
  initialAgentMachineState,
  projectAgentEvent,
} from './stateMachine'

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

describe('subagent roster projection', () => {
  const fold = (
    roster: AgentSubagent[],
    update: Parameters<typeof foldSubagentRoster>[1],
    at = 1_000,
  ): AgentSubagent[] => foldSubagentRoster(roster, update, 'turn-1', at)

  it('creates a row and then only fills what a later update carries', () => {
    const started = fold([], { id: 's1', title: 'Read alpha', status: 'running' })
    expect(started).toHaveLength(1)
    expect(started[0]).toMatchObject({ id: 's1', title: 'Read alpha', status: 'running', turnId: 'turn-1', startedAt: 1_000 })

    const summarised = fold(started, { id: 's1', status: 'completed', model: 'opus', durationMs: 1_538 }, 2_000)
    // The title survives an update that never mentions it, which is the whole point of the convention:
    // Claude only learns the model at completion and reports no title in the same breath.
    expect(summarised[0]).toMatchObject({
      id: 's1',
      title: 'Read alpha',
      status: 'completed',
      model: 'opus',
      durationMs: 1_538,
      startedAt: 1_000,
      updatedAt: 2_000,
    })
  })

  it('lets a completion create the row and a late registration name it', () => {
    // Order-robust in both directions is a requirement, not a nicety: on Codex a child thread’s own
    // traffic reaches us BEFORE the parent item that names it.
    const anonymous = fold([], { id: 's1', status: 'running' })
    expect(anonymous[0].title).toBe('Subagent')
    const named = fold(anonymous, { id: 's1', title: 'alpha', role: 'alpha' }, 2_000)
    expect(named[0]).toMatchObject({ title: 'alpha', role: 'alpha', status: 'running', startedAt: 1_000 })
  })

  it('keeps spawn order when it drops the oldest settled rows', () => {
    // Every in-flight row plus the last 20 settled ones. Filtered rather than rebuilt, so a fan-out
    // reads in the order it was launched and rows that update in place do not jump.
    let roster: AgentSubagent[] = []
    for (let index = 0; index < 25; index++) {
      roster = fold(roster, { id: `done-${index}`, title: `done-${index}`, status: 'completed' }, 1_000 + index)
    }
    roster = fold(roster, { id: 'live', title: 'live', status: 'running' }, 2_000)
    expect(roster).toHaveLength(21)
    expect(roster[0].id).toBe('done-5')
    expect(roster.map((entry) => entry.id)).toContain('live')
  })

  it('never drops a row that is still working', () => {
    let roster: AgentSubagent[] = [
      { id: 'live', turnId: null, title: 'live', status: 'running', startedAt: 0, updatedAt: 0 },
    ]
    for (let index = 0; index < 30; index++) {
      roster = fold(roster, { id: `idle-${index}`, status: 'idle' }, 1_000 + index)
    }
    expect(roster.map((entry) => entry.id)).toContain('live')
    expect(roster).toHaveLength(21)
  })

  it('keeps a subagent\u2019s progress out of the session\u2019s own state', () => {
    // A child that settles after the parent’s turn_completed would otherwise drag the session back
    // out of ready, and Codex allows exactly that ordering.
    expect(projectAgentEvent({ type: 'subagent', subagent: { id: 's1', status: 'running' } }, 'turn-1')).toEqual({})
    const ready = evolveAgentState(initialAgentMachineState(), { type: 'turn_completed' }, 'turn-1')
    expect(evolveAgentState(ready, { type: 'subagent', subagent: { id: 's1', status: 'idle' } }, null))
      .toMatchObject({ runtimeState: 'ready' })
  })

  it('keeps a turnless stream event out of the session’s runtime state', () => {
    // A harness can stream after the prompt call it was answering returned. turn_completed only fires
    // as sendTurn's return value, so a trailing message that projected 'working' would strand the
    // session there: nothing left to complete it, and 'working' blocks the next dispatch.
    const stray = { type: 'assistant_message', text: 'One more thing' } as const
    expect(projectAgentEvent(stray, null)).toEqual({ attention: 'unread' })
    expect(projectAgentEvent(stray, 'turn-1')).toEqual({ runtimeState: 'working', attention: 'unread' })

    const ready = evolveAgentState(initialAgentMachineState(), { type: 'turn_completed' }, 'turn-1')
    expect(evolveAgentState(ready, stray, null)).toMatchObject({
      runtimeState: 'ready',
      attention: 'unread',
      activeTurnId: null,
    })
  })
})
