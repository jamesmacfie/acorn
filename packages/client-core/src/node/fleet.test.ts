import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeRecord, NodeStatus } from '@acorn/protocol/broker.ts'

// idb-keyval is the persister's storage and dropNode's delete. There is no IndexedDB in the node
// environment the suite runs in (docs/testing.md), so it is mocked — and the mock is also how the
// "dropNode clears the IndexedDB key" assertion below observes the call.
const idb = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), del: vi.fn(async () => {}) }))
vi.mock('idb-keyval', () => idb)

const { _resetFleet, cacheKeyFor, clientFor, dropNode, homeNodeId, homeNodeTarget, nodeState, nodes, refreshFleet } =
  await import('./fleet')
const { activeCacheId, activeNodeId, nodeReadiness, selectActiveNode, setActiveNode } = await import('./activeNode')

const record = (nodeId: string, local = false): NodeRecord => ({
  nodeId,
  label: nodeId,
  endpoint: `https://127.0.0.1:1/${nodeId}`,
  local,
})

// The preload bridge, as the renderer sees it. Only the three members the fleet store touches.
function stubBridge(nodes: NodeRecord[], statuses: NodeStatus[] = []): (status: NodeStatus) => void {
  let push: (status: NodeStatus) => void = () => {}
  const acorn = {
    fleetList: async () => ({ nodes, statuses }),
    onNodeStatus: (cb: (status: NodeStatus) => void) => {
      push = cb
      return () => {}
    },
  }
  vi.stubGlobal('window', { acorn })
  return (status: NodeStatus) => push(status)
}

beforeEach(() => {
  _resetFleet()
  setActiveNode(null)
  idb.del.mockClear()
  vi.unstubAllGlobals()
})

describe('per-node cache partitioning', () => {
  it('does not collide when two nodes hold the same resource UUID', () => {
    // docs/architecture-overview.md § Fleet semantics: "Two nodes may coincidentally hold the same UUID;
    // that must never collide in the client." This is the whole reason the partition is a QueryClient
    // per node rather than a nodeId prefix on 34 query-option factories.
    const sharedId = 'f6a1c0de-0000-4000-8000-000000000000'
    const key = ['task', sharedId]
    clientFor('node-a').client.setQueryData(key, { title: 'from A' })
    clientFor('node-b').client.setQueryData(key, { title: 'from B' })

    expect(clientFor('node-a').client.getQueryData(key)).toEqual({ title: 'from A' })
    expect(clientFor('node-b').client.getQueryData(key)).toEqual({ title: 'from B' })
  })

  it('hands back the same client and a per-node persister key for a given node', () => {
    expect(clientFor('node-a')).toBe(clientFor('node-a'))
    expect(clientFor('node-a').client).not.toBe(clientFor('node-b').client)
    expect(cacheKeyFor('node-a')).toBe('acorn-cache:node-a')
  })

  it('keeps the origin partition when there is no broker to name a node', () => {
    // `dev:node` in a browser: the serving origin IS the node, so there is no nodeId — but the
    // persisted cache still needs a stable key.
    expect(activeCacheId()).toBe('origin')
    expect(cacheKeyFor(activeCacheId())).toBe('acorn-cache:origin')
  })
})

describe('fleet projection', () => {
  it('hydrates nodes and statuses from the broker and prefers the local node as home', async () => {
    stubBridge([record('remote'), record('local-node', true)], [{ nodeId: 'remote', state: 'degraded' }])
    await refreshFleet()

    expect(nodes().map((node) => node.nodeId)).toEqual(['remote', 'local-node'])
    expect(homeNodeId()).toBe('local-node')
    expect(homeNodeTarget()).toEqual({ nodeId: 'local-node' })
    expect(nodeState('remote')).toBe('degraded')
    // A node the broker has not reported on reads as offline, not as a sixth "unknown" state.
    expect(nodeState('local-node')).toBe('offline')
  })

  it('tracks pushed status changes', async () => {
    const push = stubBridge([record('remote')])
    await refreshFleet()
    expect(nodeState('remote')).toBe('offline')
    push({ nodeId: 'remote', state: 'online' })
    expect(nodeState('remote')).toBe('online')
  })

  it('addresses the home node only when one is known', () => {
    expect(homeNodeId()).toBe(null)
    // Absent rather than `{ nodeId: undefined }`: an own undefined property would override
    // apiClient's active-node default instead of falling through to it.
    expect(homeNodeTarget()).toEqual({})
  })
})

describe('selectActiveNode', () => {
  it('sets the active node before it reports ready, so the provider never swaps first', async () => {
    // The invariant the per-node partition rests on. index.tsx awaits this before the first render and
    // the provider is keyed on the result, so a node must be selected by the time anything can fetch.
    stubBridge([record('local-node', true)])
    const seen: (string | null)[] = []
    await selectActiveNode()
    seen.push(activeNodeId())

    expect(nodeReadiness()).toEqual({ kind: 'ready' })
    expect(seen).toEqual(['local-node'])
    expect(activeCacheId()).toBe('local-node')
  })

  it('keeps a still-known selection across a refresh', async () => {
    stubBridge([record('remote'), record('local-node', true)])
    setActiveNode('remote')
    await selectActiveNode()
    expect(activeNodeId()).toBe('remote')
  })

  it('re-homes when the selected node is gone', async () => {
    stubBridge([record('local-node', true)])
    setActiveNode('forgotten')
    await selectActiveNode()
    expect(activeNodeId()).toBe('local-node')
  })

  it('reports unpaired when the broker knows no nodes, and drops the selection with it', async () => {
    stubBridge([])
    setActiveNode('was-here')
    await selectActiveNode()
    expect(nodeReadiness()).toEqual({ kind: 'unpaired' })
    // `readiness !== ready ⇒ no active node`: a leftover id would leave apiClient ambiently addressed
    // at a node that no longer exists.
    expect(activeNodeId()).toBe(null)
  })
})

describe('dropNode', () => {
  it('clears the node cache, its IndexedDB key, and the projection row', async () => {
    stubBridge([record('remote'), record('local-node', true)], [{ nodeId: 'remote', state: 'online' }])
    await refreshFleet()
    const client = clientFor('remote').client
    client.setQueryData(['tasks'], [{ id: 'gone' }])

    dropNode('remote')

    expect(client.getQueryData(['tasks'])).toBeUndefined()
    expect(idb.del).toHaveBeenCalledWith('acorn-cache:remote')
    expect(nodes().map((node) => node.nodeId)).toEqual(['local-node'])
    expect(nodeState('remote')).toBe('offline')
    // A fresh client, not the cleared one: the removed node's cache is gone, not reusable.
    expect(clientFor('remote').client).not.toBe(client)
  })
})
