import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PLUGIN_API_MAJOR, type NodePluginRow, type PluginRuntimeIdentity } from '@acorn/protocol/api.ts'
import { clientDeclaration } from '@acorn/protocol/plugin/declaration.ts'
import type { PluginHostState } from '../../infra/platform'

let paired = ['a', 'b']
const rosters = new Map<string, NodePluginRow[]>()
const reads: string[] = []
let readRoster: (nodeId: string) => Promise<NodePluginRow[]> = async (nodeId) => rosters.get(nodeId) ?? []

vi.mock('../../infra/node/fleet', () => ({
  nodes: () => paired.map((nodeId) => ({ nodeId })),
  nodeState: () => 'online',
}))
vi.mock('../../infra/node/activeNode', () => ({ activeNodeId: () => 'a' }))
vi.mock('../../infra/node/apiClient', () => ({
  readJson: async (_route: string, options: { nodeId: string }) => {
    reads.push(options.nodeId)
    return { plugins: await readRoster(options.nodeId) }
  },
}))
const hostState = (): PluginHostState => ({
  cached: Object.fromEntries(['one', 'two'].map((hash) => [hash, { pluginId: 'reports', version: hash, bytes: 10 }])),
  acks: ['one', 'two'].map((hash) => ({ pluginId: 'reports', hash, decision: 'accepted' as const, nodeId: 'a', version: hash,
    decidedAt: 1, permissions: { api: [], events: [], node: { core: [], capabilities: [], secrets: false, exec: false, net: [], sockets: false } },
    declaration: clientDeclaration(runtime(hash)),
    webviews: [], keyClaims: [], navigationDestinations: [], extensions: [], schedules: [], taskChecks: [], harnesses: [], agentTools: [], contextSections: [],
  })),
  devGrants: [],
})
vi.mock('./host', () => ({
  pluginHostAvailable: () => true,
  cachePluginBundle: async () => ({ hash: 'cached' }),
  readPluginHostState: async () => hostState(),
}))
vi.mock('../tree/workerHost', () => ({ stopTreeWorker: vi.fn() }))

const { distribution, forgetPluginNode, _resetPluginDistribution, syncPluginDistribution } = await import('./distribution')

const runtime = (hash: string): PluginRuntimeIdentity => ({
  version: hash,
  apiVersion: PLUGIN_API_MAJOR,
  permissions: { api: [], events: [], node: { core: [], capabilities: [], secrets: false, exec: false, net: [], sockets: false } },
  contributions: { frames: [] },
  client: { hash, bytes: 10 },
  activation: 'node',
})
const row = (hash: string): NodePluginRow => ({
  name: 'reports', required: false, disabled: false, running: true, state: 'active',
  active: runtime(hash), installed: runtime(hash),
})
const selected = (nodeId: string) => distribution().selectionsByNode.get(nodeId)?.get('reports')?.hash

beforeEach(() => {
  _resetPluginDistribution()
  paired = ['a', 'b']
  rosters.clear()
  rosters.set('a', [row('one')])
  rosters.set('b', [row('one')])
  reads.length = 0
  readRoster = async (nodeId) => rosters.get(nodeId) ?? []
})

describe('plugin distribution reconciliation', () => {
  it('re-reads only the event source and preserves another node selection', async () => {
    await syncPluginDistribution()
    expect(reads).toEqual(['a', 'b'])
    rosters.set('b', [row('two')])
    reads.length = 0
    await syncPluginDistribution({ nodeIds: ['b'] })
    expect(reads).toEqual(['b'])
    expect(selected('a')).toBe('one')
    expect(selected('b')).toBe('two')
  })

  it('retains an unreadable node as stale and withholds its selection', async () => {
    await syncPluginDistribution()
    readRoster = async (nodeId) => {
      if (nodeId === 'b') throw new Error('offline')
      return rosters.get(nodeId) ?? []
    }
    await syncPluginDistribution({ nodeIds: ['b'] })
    expect(distribution().byNode.get('b')?.rows).toHaveLength(1)
    expect(distribution().byNode.get('b')?.stale).toBe(true)
    expect(selected('b')).toBeUndefined()
    expect(selected('a')).toBe('one')
  })

  it('discards a response from a node unpaired during its read', async () => {
    await syncPluginDistribution()
    let release: ((rows: NodePluginRow[]) => void) | undefined
    readRoster = async (nodeId) => nodeId === 'b'
      ? new Promise<NodePluginRow[]>((resolve) => { release = resolve })
      : rosters.get(nodeId) ?? []
    const pending = syncPluginDistribution({ nodeIds: ['b'] })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    paired = ['a']
    forgetPluginNode('b')
    release!([row('two')])
    await pending
    expect(distribution().byNode.has('b')).toBe(false)
    expect(selected('a')).toBe('one')
  })

  it('serializes two events for one node so the newer roster wins', async () => {
    await syncPluginDistribution()
    let release: ((rows: NodePluginRow[]) => void) | undefined
    let first = true
    readRoster = async (nodeId) => {
      if (nodeId !== 'b') return rosters.get(nodeId) ?? []
      if (first) {
        first = false
        return new Promise<NodePluginRow[]>((resolve) => { release = resolve })
      }
      return rosters.get(nodeId) ?? []
    }
    const earlier = syncPluginDistribution({ nodeIds: ['b'] })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    rosters.set('b', [row('two')])
    const later = syncPluginDistribution({ nodeIds: ['b'] })
    release!([row('one')])
    await Promise.all([earlier, later])
    expect(selected('b')).toBe('two')
    expect(distribution().byNode.get('b')?.generation).toBeGreaterThan(1)
  })
})
