import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeRecord, NodeStatus } from '@acorn/protocol/broker.ts'
import { clientFor, refreshFleet, _resetFleet } from './fleet'
import { fetchFleet } from './fanout'

// The fan-out is what makes "a slow or offline node yields a partial-result banner, never a failed page"
// (architecture.md § Fleet semantics) true once instead of four times. These cases are the three
// properties it exists to provide.

const record = (nodeId: string, label: string, local = false): NodeRecord => ({
  nodeId,
  label,
  endpoint: `https://127.0.0.1:1${nodeId.length}000`,
  local,
})

// Fleet membership is main's, projected by refreshFleet(). Faking `window.acorn` is how every other
// client-core suite reaches it.
function installFleet(nodes: NodeRecord[], statuses: NodeStatus[]): void {
  ;(globalThis as { window?: unknown }).window = {
    acorn: {
      desktop: true,
      fleetList: () => Promise.resolve({ nodes, statuses }),
      onNodeStatus: () => () => {},
    },
  }
}

const KEY = ['fanout', 'test'] as const

beforeEach(async () => {
  _resetFleet()
  installFleet(
    [record('a', 'Node A', true), record('b', 'Node B')],
    [
      { nodeId: 'a', state: 'online' },
      { nodeId: 'b', state: 'online' },
    ],
  )
  await refreshFleet()
})

afterEach(() => {
  _resetFleet()
  delete (globalThis as { window?: unknown }).window
})

describe('fetchFleet', () => {
  it('merges every node in fleet order, not completion order', async () => {
    // Node B answers first. Rows must still come back A then B: a list that reshuffles because one node
    // was quicker this time is unusable.
    const result = await fetchFleet(KEY, async (nodeId) => {
      if (nodeId === 'a') await new Promise((resolve) => setTimeout(resolve, 20))
      return `from-${nodeId}`
    })
    expect(result.rows.map((row) => [row.nodeId, row.data, row.freshness])).toEqual([
      ['a', 'from-a', 'live'],
      ['b', 'from-b', 'live'],
    ])
    expect(result.unavailable).toEqual([])
  })

  it('does not reject when one node fails; it reports it as unavailable', async () => {
    const result = await fetchFleet(KEY, (nodeId) =>
      nodeId === 'b' ? Promise.reject(new Error('connect ECONNREFUSED')) : Promise.resolve('ok'),
    )
    expect(result.rows.map((row) => row.nodeId)).toEqual(['a'])
    expect(result.unavailable).toEqual([{ nodeId: 'b', label: 'Node B', reason: 'connect ECONNREFUSED' }])
  })

  it('bounds a hanging node by the deadline rather than the connection state', async () => {
    // Node B's socket still reads `online` — a dropped VPN takes a while to surface — so the timeout is
    // the only thing that stops the page spinning forever. ui.md: "No infinite spinners."
    vi.useFakeTimers()
    try {
      const pending = fetchFleet(
        KEY,
        (nodeId) => (nodeId === 'b' ? new Promise<string>(() => {}) : Promise.resolve('ok')),
        { timeoutMs: 50 },
      )
      await vi.advanceTimersByTimeAsync(60)
      const result = await pending
      expect(result.rows.map((row) => row.nodeId)).toEqual(['a'])
      // Milliseconds below a second. `Math.round(ms/1000)` rendered every sub-second deadline as
      // "no answer within 0s" — a string the partial-result banner shows the owner verbatim.
      expect(result.unavailable[0]).toMatchObject({ nodeId: 'b', reason: 'no answer within 50ms' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders a failed node from ITS OWN cache, marked stale', async () => {
    // The payoff of the per-node QueryClient partition: there is exactly one place node B's last answer
    // lives, so a row can be served from it instead of disappearing.
    clientFor('b').client.setQueryData(KEY, 'remembered')
    const result = await fetchFleet(KEY, (nodeId) =>
      nodeId === 'b' ? Promise.reject(new Error('offline')) : Promise.resolve('fresh'),
    )
    expect(result.unavailable).toEqual([])
    expect(result.rows.map((row) => [row.nodeId, row.data, row.freshness])).toEqual([
      ['a', 'fresh', 'live'],
      ['b', 'remembered', 'stale'],
    ])
  })

  it('marks a cached row from a disconnected node offline, not stale', async () => {
    _resetFleet()
    installFleet(
      [record('a', 'Node A', true), record('b', 'Node B')],
      [
        { nodeId: 'a', state: 'online' },
        { nodeId: 'b', state: 'offline' },
      ],
    )
    await refreshFleet()
    clientFor('b').client.setQueryData(KEY, 'remembered')
    const result = await fetchFleet(KEY, (nodeId) =>
      nodeId === 'b' ? Promise.reject(new Error('offline')) : Promise.resolve('fresh'),
    )
    expect(result.rows.find((row) => row.nodeId === 'b')?.freshness).toBe('offline')
  })

  it('writes through each node\'s own cache, so a later single-node read is warm', async () => {
    await fetchFleet(KEY, (nodeId) => Promise.resolve(`from-${nodeId}`))
    expect(clientFor('a').client.getQueryData(KEY)).toBe('from-a')
    expect(clientFor('b').client.getQueryData(KEY)).toBe('from-b')
    // And the two caches are genuinely separate — the collision hazard the partition exists for.
    expect(clientFor('a').client.getQueryData(KEY)).not.toBe(clientFor('b').client.getQueryData(KEY))
  })

  it('honours an explicit node subset', async () => {
    const asked: string[] = []
    const result = await fetchFleet(KEY, (nodeId) => {
      asked.push(nodeId)
      return Promise.resolve('ok')
    }, { nodeIds: ['b'] })
    expect(asked).toEqual(['b'])
    expect(result.rows.map((row) => row.nodeId)).toEqual(['b'])
  })

  it('answers empty for an empty fleet rather than throwing', async () => {
    _resetFleet()
    installFleet([], [])
    await refreshFleet()
    expect(await fetchFleet(KEY, () => Promise.reject(new Error('never called')))).toEqual({ rows: [], unavailable: [] })
  })
})
