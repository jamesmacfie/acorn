// The rail marker while an agent streams: which rows run again per event.
//
// A `.tsx` for the reason ./sessions/managedStore.test.tsx gives: the rows are reactive, and only the
// `hosts` project runs Solid's browser build, where a computation re-runs at all.
import { describe, expect, it, vi } from 'vitest'
import { createComputed, createRoot } from 'solid-js'
import type { AgentEventRecord, AgentSession, AgentWsFrame } from '../contract/wire.ts'

let deliver: (frame: AgentWsFrame) => void = () => {}
vi.mock('./sessions/wsChannel', () => ({
  wsOnAgentFrame: (cb: (frame: AgentWsFrame) => void) => {
    deliver = cb
    return () => {}
  },
}))

const { managedAgentStore } = await import('./sessions/managedStore')
const { agentRailMarkerContribution } = await import('./railMarkerContribution')

const row = (id: string, taskId: string, over: Partial<AgentSession> = {}): AgentSession => ({
  id, taskId, title: id, providerId: 'claude', config: {}, createdAt: 1, updatedAt: 1, lastEventSeq: 0, lastReadSeq: 0,
  attention: 'none', controller: 'acorn', runtimeState: 'ready', subagents: [], queuedTurns: 0, kind: 'interactive',
  ...over,
} as unknown as AgentSession)

const event = (sessionId: string, seq: number): AgentEventRecord => ({
  id: `${sessionId}-e${seq}`, sessionId, turnId: 'turn', seq, schemaVersion: 1, searchText: null, createdAt: 5_000 + seq,
  event: { type: 'assistant_message', text: 'more' },
} as unknown as AgentEventRecord)

describe('the agent rail marker while a session streams', () => {
  // One case, because the store is a module singleton and the rows below outlive it.
  it('runs no row per event, and keeps the session’s live sequence off the roster', () => {
    managedAgentStore.activate()
    const TASKS = 30
    managedAgentStore.upsertSessions(Array.from({ length: 100 }, (_, index) =>
      row(`s${index}`, `t${index % TASKS}`, { updatedAt: 1_000 - index })))
    managedAgentStore.upsertSession(row('s99', 't9', { updatedAt: 1_000, runtimeState: 'working' }))
    const runs = new Map<string, number>()
    const markers = new Map<string, readonly { id: string }[]>()
    createRoot(() => {
      for (let index = 0; index < TASKS; index++) {
        const id = `t${index}`
        createComputed(() => {
          runs.set(id, (runs.get(id) ?? 0) + 1)
          markers.set(id, agentRailMarkerContribution.markers({ kind: 'task', id }))
        })
      }
    })
    expect(markers.get('t9')?.map((marker) => marker.id)).toEqual(['working'])
    runs.clear()
    const roster = managedAgentStore.sessions()

    // What the node sends per streamed event now: the event, and no row unless the event changed it
    // (server/sessions/runtimeEngine.ts § record). s0 is in t0.
    for (let seq = 1; seq <= 25; seq++) deliver({ channel: 'agent:event', event: event('s0', seq) })

    // No row runs at all: an event frame leaves the roster alone, and the live sequence the pane
    // marks read up to is its own per-session signal (sessions/managedStore.ts § eventSeqs).
    expect([...runs.keys()]).toEqual([])
    // Nor anything that reads the whole roster, such as Agent Center.
    expect(managedAgentStore.sessions()).toBe(roster)
    const streamed = managedAgentStore.sessionsForTask('t0').find((session) => session.id === 's0')!
    expect(streamed).toMatchObject({ lastEventSeq: 0, updatedAt: 1_000 })
    expect(managedAgentStore.lastEventSeq(streamed)).toBe(25)

    // And a row that did change still lands, on its task's rows alone.
    runs.clear()
    deliver({ channel: 'agent:session', session: row('s1', 't1', { updatedAt: 6_000, lastEventSeq: 3, attention: 'permission' }) })
    expect([...runs.keys()]).toEqual(['t1'])
    expect(markers.get('t1')?.map((marker) => marker.id)).toEqual(['attention'])
  })
})

describe('the Workflows pane button', () => {
  it('spins only for a working workflow agent, so the Agent button can spin while it stays still', () => {
    managedAgentStore.activate()
    const workflowsButton = (taskId: string) => agentRailMarkerContribution.markers({ kind: 'pane', id: 'workflows', taskId })
    const agentButton = (taskId: string) => agentRailMarkerContribution.markers({ kind: 'pane', id: 'agents', taskId })

    managedAgentStore.upsertSession(row('chat', 'wf-a', { runtimeState: 'working' }))
    expect(agentButton('wf-a').map((marker) => marker.id)).toEqual(['working'])
    expect(workflowsButton('wf-a')).toEqual([])

    managedAgentStore.upsertSession(row('step', 'wf-b', { runtimeState: 'working', kind: 'workflow' }))
    expect(workflowsButton('wf-b')).toMatchObject([{ id: 'working', busy: true, placements: ['top-end'] }])
  })
})
