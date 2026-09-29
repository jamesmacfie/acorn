import { describe, expect, it } from 'vitest'
import type { AgentSession, AgentSubagent } from '../../contract/wire.ts'
import { agentSessionRoster } from './sessionRoster'
import { compareSessions, compareSubagents, sessionOrderFor, sessionOrderSlice, setSessionOrder } from './sessionOrder'

const session = (id: string, over: Partial<AgentSession>): AgentSession => ({
  id, taskId: 'task-1', providerId: 'codex', profileId: 'codex', kind: 'interactive', driverKind: 'codex',
  driverVersion: '1', providerSessionRef: null, controller: 'acorn', runtimeState: 'ready', attention: 'none',
  statusAuthority: 'protocol', title: id, model: null, config: {}, parentSessionId: null, parentTurnId: null,
  subagents: [], queuedTurns: 0, lastEventSeq: 0, lastReadSeq: 0, archivedAt: null, createdAt: 1, updatedAt: 1,
  ...over,
})
const subagent = (id: string, over: Partial<AgentSubagent>): AgentSubagent => ({
  id, turnId: null, title: id, status: 'completed', startedAt: 1, updatedAt: 1, ...over,
})

// Old to new: a, b, c. `b` is the one working, `c` last heard from long ago, `a` renamed last.
const sessions = [
  session('a', { title: 'zeta', createdAt: 1, lastEventAt: 20, updatedAt: 99 }),
  session('b', { title: 'Alpha 10', createdAt: 2, lastEventAt: 30, runtimeState: 'working' }),
  session('c', { title: 'alpha 9', createdAt: 3, lastEventAt: 10 }),
]
const ids = (order: Parameters<typeof compareSessions>[0]) => [...sessions].sort(compareSessions(order)).map((s) => s.id)

describe('session order', () => {
  it('orders each way, with newest-created breaking ties', () => {
    expect(ids('created')).toEqual(['c', 'b', 'a'])
    expect(ids('status')).toEqual(['b', 'c', 'a'])
    expect(ids('name')).toEqual(['c', 'b', 'a'])
    // By the last event, not `updatedAt`, which a read or a rename also moves.
    expect(ids('activity')).toEqual(['b', 'a', 'c'])
  })

  it('orders a session\'s subagents the same way as its group', () => {
    const parent = session('p', { subagents: [
      subagent('x', { title: 'b', startedAt: 1 }),
      subagent('y', { title: 'a', startedAt: 2, status: 'running' }),
    ] })
    const keys = (order: Parameters<typeof compareSubagents>[0]) =>
      agentSessionRoster([parent], {}, compareSubagents(order)).map((row) => row.key)
    expect(keys('name')).toEqual(['p', 'p/y', 'p/x'])
    expect(keys('created')).toEqual(['p', 'p/y', 'p/x'])
    expect(agentSessionRoster([parent], {}).map((row) => row.key)).toEqual(['p', 'p/x', 'p/y'])
  })

  it('remembers a choice per task and per group, and drops what it cannot read', () => {
    setSessionOrder('task-1', 'inline', 'name')
    expect(sessionOrderFor('task-1', 'inline')).toBe('name')
    expect(sessionOrderFor('task-1', 'managed')).toBe('created')
    expect(sessionOrderFor('task-2', 'inline')).toBe('created')
    expect(sessionOrderSlice.codec.parse('{"managed":"status","inline":"sideways","other":"name"}'))
      .toEqual({ managed: 'status' })
    expect(sessionOrderSlice.codec.parse('not json')).toEqual({})
  })
})
