import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NodeRecord, NodeStatus } from '@acorn/protocol/broker.ts'

// The device's memory of which node this window talks to, and what it buys: a cache partition on the
// first tick.
//
// The window opens before the node does now (docs/performance.md § Every host draws
// first), so `activeNodeId()` has to answer before the fleet does. If it does not, the shell mounts on
// the `origin` partition, the fleet answers, and the whole first paint is thrown away and remounted on
// the real one.
//
// The store is installed before the import below rather than in a `beforeEach`, because the signal
// reads it once, at module evaluation, which is the only moment that matters here.

vi.mock('idb-keyval', () => ({ get: vi.fn(), set: vi.fn(), del: vi.fn(async () => {}) }))

const store = new Map<string, string>([['acorn.last-node', 'node-remembered']])
;(globalThis as { localStorage?: unknown }).localStorage = {
  get length() { return store.size },
  key: (index: number) => [...store.keys()][index] ?? null,
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
}

const { activeCacheId, activeNodeId, nodeGateHolds, nodeReadiness, nodeReady, selectActiveNode, setActiveNode } = await import('./activeNode')
const { _resetFleet, cacheKeyFor, clientFor, ORIGIN_NODE_ID, refreshFleet } = await import('./fleet')

const record = (nodeId: string, local = true): NodeRecord => ({
  nodeId,
  label: nodeId,
  endpoint: `https://127.0.0.1:1/${nodeId}`,
  local,
})

const stubBridge = (nodes: NodeRecord[], statuses: NodeStatus[] = []): void => {
  vi.stubGlobal('window', {
    acorn: {
      nodeFetch: () => Promise.reject(new Error('this suite makes no requests')),
      fleetList: async () => ({ nodes, statuses }),
      onNodeStatus: () => () => {},
    },
  })
}

afterEach(() => {
  _resetFleet()
  vi.unstubAllGlobals()
})

describe('the remembered node', () => {
  it('answers before the fleet does, so the cache partition is right on the first tick', async () => {
    // No bridge stubbed and nothing called: this is the state the module is in when index.tsx picks
    // the partition the shell mounts on.
    expect(activeNodeId()).toBe('node-remembered')
    expect(activeCacheId()).toBe('node-remembered')
    const guessed = clientFor(activeCacheId())

    // …and the fleet, when it answers, produces the same partition rather than a second one.
    stubBridge([record('node-remembered')])
    await selectActiveNode()
    expect(activeCacheId()).toBe('node-remembered')
    expect(clientFor(activeCacheId())).toBe(guessed)
    expect(cacheKeyFor(activeCacheId())).toBe('acorn-cache:node-remembered')
    // The failure this is here to catch: without the memory it would have been the origin partition,
    // and the shell would have remounted onto a different cache.
    expect(cacheKeyFor(activeCacheId())).not.toBe(cacheKeyFor(ORIGIN_NODE_ID))
  })

  it('is corrected when the fleet no longer has that node', async () => {
    stubBridge([record('node-fresh')])
    await selectActiveNode()
    expect(activeNodeId()).toBe('node-fresh')
    expect(store.get('acorn.last-node')).toBe('node-fresh')
  })

  it('is forgotten when there is nothing to select', async () => {
    stubBridge([])
    await selectActiveNode()
    expect(activeNodeId()).toBeNull()
    expect(store.has('acorn.last-node')).toBe(false)
  })
})

describe('nodeGateHolds', () => {
  it('lets the shell draw as soon as there is a node to address', async () => {
    // Start from the state that used to be a wall: no node, and a readiness that is not `ready`.
    stubBridge([])
    await selectActiveNode()
    expect(nodeGateHolds()).toBe(true)

    // A remembered node is enough. The fleet has still confirmed nothing, and the shell draws anyway.
    setActiveNode('node-a')
    expect(nodeReady()).toBe(false)
    expect(nodeGateHolds()).toBe(false)
  })

  it('holds the screen on a launch with no node, which is the onboarding path', async () => {
    setActiveNode(null)
    stubBridge([])
    await selectActiveNode()
    expect(nodeReadiness().kind).toBe('unpaired')
    expect(nodeGateHolds()).toBe(true)
  })

  it('holds the screen when the broker itself could not answer, remembered node or not', async () => {
    setActiveNode('node-a')
    vi.stubGlobal('window', {
      acorn: {
        nodeFetch: () => Promise.reject(new Error('no')),
        fleetList: () => Promise.reject(new Error('the helper is gone')),
        onNodeStatus: () => () => {},
      },
    })
    await selectActiveNode()
    expect(nodeReadiness().kind).toBe('failed')
    // Nothing in the window will work, so a shell drawn over stale data would be a lie.
    expect(activeNodeId()).toBe('node-a')
    expect(nodeGateHolds()).toBe(true)
  })

  it('lets a renderer served by the node itself draw, since it has no fleet to ask', async () => {
    setActiveNode(null)
    vi.stubGlobal('window', {})
    await selectActiveNode()
    expect(nodeReadiness().kind).toBe('ready')
    expect(activeNodeId()).toBeNull()
    expect(nodeGateHolds()).toBe(false)
  })
})

describe('membership that arrives after the first paint', () => {
  it('re-reads the fleet when a status names a node the list does not have', async () => {
    // A first-ever launch: the helper is listening, its fleet file is empty, and the local node is
    // adopted a few hundred milliseconds later. Its first status is the only news that it exists.
    let push: (status: NodeStatus) => void = () => {}
    let listed: NodeRecord[] = []
    vi.stubGlobal('window', {
      acorn: {
        nodeFetch: () => Promise.reject(new Error('this suite makes no requests')),
        fleetList: async () => ({ nodes: listed, statuses: [] }),
        onNodeStatus: (cb: (status: NodeStatus) => void) => {
          push = cb
          return () => {}
        },
      },
    })
    await refreshFleet()
    const { nodes } = await import('./fleet')
    expect(nodes()).toHaveLength(0)

    listed = [record('node-adopted')]
    push({ nodeId: 'node-adopted', state: 'online' })
    // The re-read is not awaited by the pusher, so let its microtasks run.
    await vi.waitFor(() => expect(nodes()).toHaveLength(1))
    expect(nodes()[0]?.nodeId).toBe('node-adopted')
  })
})
