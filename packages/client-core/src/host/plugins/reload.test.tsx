import { createSignal } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'
import type { NodeConnectionState, NodeRecord } from '@acorn/protocol/broker.ts'

// The first plugin pass is owned by the watcher and fired by a node becoming reachable, because every
// host can start before the node it just spawned is up: fired at boot it asked nobody, found no roster, and
// left a session with no loaded plugins in it.
//
// A `.tsx` so it runs in the jsdom project, which is the only one with Solid's browser build; under the
// server build an effect never re-runs and this suite would pass on a world with no reactivity in it.

const [nodes, setNodes] = createSignal<readonly NodeRecord[]>([])
const [states, setStates] = createSignal<Record<string, NodeConnectionState>>({})

vi.mock('../../infra/node/fleet', () => ({
  nodes: () => nodes(),
  nodeState: (nodeId: string) => states()[nodeId] ?? 'offline',
}))
vi.mock('../../infra/node/nodePlugins', () => ({ refreshNodePlugins: async () => null }))
vi.mock('../../infra/node/wsClient', () => ({ wsOnPluginsChanged: () => () => {} }))
vi.mock('./distribution', () => ({ syncPluginDistribution: vi.fn(async () => {}) }))
vi.mock('./syncContributions', () => ({ syncPluginContributions: vi.fn() }))

const { watchPluginChanges, reconcileDevicePluginChange } = await import('./reload')
const { syncPluginDistribution } = await import('./distribution')
const passes = () => vi.mocked(syncPluginDistribution).mock.calls.length

const node = (nodeId: string): NodeRecord => ({ nodeId, label: nodeId, local: true }) as NodeRecord

describe('the first pass', () => {
  // One watcher for the whole sequence, because the real one is never disposed: it holds a root for the
  // life of the host, so a second `watchPluginChanges()` in a second test would still be watching.
  it('reads device bundles before a node arrives, then asks each node once', async () => {
    watchPluginChanges()
    expect(passes()).toBe(1)
    expect(syncPluginDistribution).toHaveBeenLastCalledWith({ repin: true, deviceOnly: true })

    // Membership lands before the connection does, which is the boot order this used to fire in.
    setNodes([node('a')])
    expect(passes()).toBe(1)
    setStates({ a: 'online' })
    await vi.waitFor(() => expect(passes()).toBe(2))

    // A connection that flaps is not news: the bundles were hashed on the pass above.
    setStates({ a: 'degraded' })
    setStates({ a: 'offline' })
    setStates({ a: 'online' })
    expect(passes()).toBe(2)

    // A node paired later is, and it carries plugins of its own.
    setNodes([node('a'), node('b')])
    setStates({ a: 'online', b: 'online' })
    await vi.waitFor(() => expect(passes()).toBe(3))
  })
})

it('reconciles device changes without requesting node rosters', async () => {
  await reconcileDevicePluginChange()
  expect(syncPluginDistribution).toHaveBeenLastCalledWith({ repin: true, deviceOnly: true })
})
