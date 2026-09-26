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
let pluginChange: ((nodeId: string) => void) | undefined
vi.mock('../../infra/node/wsClient', () => ({
  wsOnFleetPluginsChanged: (callback: (nodeId: string) => void) => {
    pluginChange = callback
    return () => { pluginChange = undefined }
  },
}))
const forgetPluginNode = vi.fn()
const markPluginNodeStale = vi.fn()
vi.mock('./distribution', () => ({
  distribution: () => ({ byNode: new Map() }),
  forgetPluginNode: (...args: unknown[]) => forgetPluginNode(...args),
  markPluginNodeStale: (...args: unknown[]) => markPluginNodeStale(...args),
  notifyActivePluginNodeChanged: vi.fn(),
  onPluginDistributionCommit: () => () => {},
  syncPluginDistribution: vi.fn(async () => {}),
}))
vi.mock('./syncContributions', () => ({ syncPluginContributions: vi.fn() }))

const { watchPluginChanges, reconcileDevicePluginChange } = await import('./reload')
const { syncPluginDistribution } = await import('./distribution')
const passes = () => vi.mocked(syncPluginDistribution).mock.calls.length

const node = (nodeId: string): NodeRecord => ({ nodeId, label: nodeId, local: true }) as NodeRecord

describe('the first pass', () => {
  // One watcher for the whole sequence, because the real one is never disposed: it holds a root for the
  // life of the host, so a second `watchPluginChanges()` in a second test would still be watching.
  it('reads first arrival, reconnect, inactive change, and removes unpaired observations', async () => {
    const off = watchPluginChanges()
    expect(passes()).toBe(1)
    expect(syncPluginDistribution).toHaveBeenLastCalledWith({ deviceOnly: true })

    // Membership lands before the connection does, which is the boot order this used to fire in.
    setNodes([node('a')])
    expect(passes()).toBe(1)
    setStates({ a: 'online' })
    await vi.waitFor(() => expect(passes()).toBe(2))

    // A reconnect is news: the node may have changed while offline.
    setStates({ a: 'degraded' })
    setStates({ a: 'offline' })
    setStates({ a: 'online' })
    expect(passes()).toBe(4)
    expect(markPluginNodeStale).toHaveBeenCalledWith('a')

    // A node paired later is, and it carries plugins of its own.
    setNodes([node('a'), node('b')])
    setStates({ a: 'online', b: 'online' })
    expect(passes()).toBe(5)
    pluginChange?.('b')
    expect(passes()).toBe(6)
    setNodes([node('a')])
    expect(forgetPluginNode).toHaveBeenCalledWith('b')
    off()
  })
})

it('reconciles device changes without requesting node rosters', async () => {
  await reconcileDevicePluginChange()
  expect(syncPluginDistribution).toHaveBeenLastCalledWith({ deviceOnly: true })
})
