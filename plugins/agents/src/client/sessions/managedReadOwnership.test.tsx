import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setActiveNode, refreshFleet } from '@acorn/plugin-api/testkit/client'
import { managedAgentStore } from './managedStore'
import type { AgentSession, AgentSessionSnapshot } from '../../contract/wire.ts'

vi.mock('./wsChannel', () => ({ wsOnAgentFrame: () => () => {} }))
const requests: { nodeId: string; path: string; resolve: (body: unknown) => void }[] = []
const snapshot = (node: string, seq = 1, id = 'same'): AgentSessionSnapshot => ({
  session: { id, taskId: 'task', title: node, updatedAt: 1, lastEventSeq: seq, subagents: [], attention: 'none' } as unknown as AgentSession,
  events: [{ id: `${node}-1`, sessionId: id, seq: 1, event: { type: 'assistant_message', text: node }, createdAt: 1 } as AgentSessionSnapshot['events'][number]],
  turns: [], requests: [],
})
const reply = (body: unknown) => ({ status: 200, headers: {}, body: new TextEncoder().encode(JSON.stringify(body)) })
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const switchTo = (node: string) => { setActiveNode(node); managedAgentStore.clear() }
beforeEach(async () => {
  requests.length = 0
  Object.assign(window, { acorn: { desktop: true, fleetList: async () => ({ nodes: ['A', 'B'].map(nodeId => ({ nodeId, label: nodeId, endpoint: 'https://localhost', local: true })), statuses: ['A', 'B'].map(nodeId => ({ nodeId, state: 'online' })) }), onNodeStatus: () => () => {},
    nodeFetch: (nodeId: string, request: { path: string }) => new Promise(resolve => requests.push({
      nodeId, path: request.path, resolve: body => resolve(reply(body)),
    })),
  } })
  await refreshFleet()
  switchTo('A')
})
afterEach(() => { managedAgentStore.clear(); setActiveNode(null); delete window.acorn })

it.each(['loadTask', 'loadAll', 'loadAttention'] as const)('rejects stale %s publication across colliding Node ids', async (method) => {
  const old = method === 'loadTask' ? managedAgentStore.loadTask('task') : managedAgentStore[method]()
  const rejected = expect(old).rejects.toThrow(/no longer owns/)
  switchTo('B')
  managedAgentStore.upsertSession(snapshot('B').session)
  requests[0].resolve({ sessions: [snapshot('A').session], delegations: [] })
  await rejected
  expect(managedAgentStore.sessions().map(row => row.title)).toEqual(['B'])
  expect(requests[0].nodeId).toBe('A')
})

it('keeps pages on their origin and stops after deletion while a page is pending', async () => {
  const reading = managedAgentStore.loadSnapshot('same')
  const rejected = expect(reading).rejects.toThrow(/no longer owns/)
  requests[0].resolve(snapshot('A', 3))
  await vi.waitFor(() => expect(requests).toHaveLength(2))
  expect(requests[1].nodeId).toBe('A')
  managedAgentStore.removeSession('same')
  requests[1].resolve({ events: [{ ...snapshot('A').events[0], id: 'A-2', seq: 2 }] })
  await rejected
  expect(requests).toHaveLength(2)
  expect(managedAgentStore.snapshots()).toEqual({})
  expect(managedAgentStore.sessions()).toEqual([])
})

it('preserves the incoming read and hold when an outgoing read finally settles', async () => {
  const releaseA = managedAgentStore.hold('same')
  const old = managedAgentStore.loadSnapshot('same')
  const rejected = expect(old).rejects.toThrow(/no longer owns/)
  switchTo('B')
  const releaseB = managedAgentStore.hold('same')
  const incoming = managedAgentStore.loadSnapshot('same')
  requests[0].resolve(snapshot('A'))
  await rejected
  expect(managedAgentStore.loadSnapshot('same')).toBe(incoming)
  expect(requests).toHaveLength(2)
  requests[1].resolve(snapshot('B'))
  await incoming
  releaseA()
  for (let i = 0; i < 4; i++) {
    const run = managedAgentStore.loadSnapshot(`other-${i}`)
    requests.at(-1)!.resolve(snapshot('B', 1, `other-${i}`))
    await run
  }
  expect(managedAgentStore.snapshots().same.events[0].id).toBe('B-1')
  releaseB()
  expect(Object.keys(managedAgentStore.snapshots())).toHaveLength(3)
})

it('does not start another page or resurrect a created row after switching Node', async () => {
  const reading = managedAgentStore.loadSnapshot('same')
  const rejected = expect(reading).rejects.toThrow(/no longer owns/)
  switchTo('B')
  requests[0].resolve(snapshot('A', 3))
  await rejected
  expect(requests).toHaveLength(1)
  switchTo('A')
  const starting = managedAgentStore.startSession('task', { id: 'provider', profileId: 'profile' })
  const rejectedStart = expect(starting).rejects.toThrow(/no longer owns/)
  switchTo('B')
  requests[1].resolve(snapshot('A').session)
  await rejectedStart
  await tick()
  expect(managedAgentStore.sessions()).toEqual([])
})
