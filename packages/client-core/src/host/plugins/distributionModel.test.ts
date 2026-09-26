import { describe, expect, it } from 'vitest'
import { PLUGIN_API_MAJOR, type InstalledPluginRow, type NodePluginRow, type PluginRuntimeIdentity } from '@acorn/protocol/api.ts'
import type { PluginHostState } from '../../infra/platform'
import { decisionKey, derivePluginDistribution, type DevicePluginEntry, type NodePluginObservation } from './distributionModel'

const identity = (version: string, hash: string): PluginRuntimeIdentity => ({
  version,
  apiVersion: PLUGIN_API_MAJOR,
  permissions: { api: [], events: [], node: { core: [], capabilities: [], secrets: false, exec: false, net: [], sockets: false } },
  contributions: { frames: [] } as PluginRuntimeIdentity['contributions'],
  client: { hash, bytes: 10 },
  activation: 'node',
})

const installed = (runtime: PluginRuntimeIdentity): InstalledPluginRow => ({ ...runtime })
const row = (name: string, active: PluginRuntimeIdentity | null, candidate?: InstalledPluginRow): NodePluginRow => ({
  name,
  required: false,
  disabled: false,
  running: active !== null,
  state: active ? 'active' : 'pending-restart',
  active,
  ...(candidate ? { installed: candidate } : {}),
})
const observation = (nodeId: string, rows: NodePluginRow[], reachable = true): NodePluginObservation => ({
  nodeId, rows, reachable, stale: !reachable, generation: 1, observedAt: 1,
})
const host = (hashes: string[], decisions: { pluginId: string; hash: string; decision: 'accepted' | 'rejected' }[] = []): PluginHostState => ({
  cached: Object.fromEntries(hashes.map((hash) => [hash, { pluginId: 'cached', version: '1', bytes: 10 }])),
  acks: decisions.map((decision, index) => ({
    ...decision, nodeId: 'a', version: '1', decidedAt: index + 1,
    permissions: identity('1', decision.hash).permissions,
    webviews: [], keyClaims: [], navigationDestinations: [], extensions: [], schedules: [], taskChecks: [], harnesses: [], agentTools: [], contextSections: [],
  })),
  devGrants: [],
})
const selected = (result: ReturnType<typeof derivePluginDistribution>, nodeId: string, pluginId: string) =>
  result.selectionsByNode.get(nodeId)?.get(pluginId)?.hash

describe('fleet selection policy', () => {
  it('prefers an older device bundle while retaining the newer node runtime observation', () => {
    const newer = identity('2.0.0', 'node-hash')
    const byNode = new Map([['a', observation('a', [row('reports', newer, installed(newer))])]])
    const deviceRuntime = identity('1.9.0', 'device-hash')
    const device: DevicePluginEntry = {
      hash: 'device-hash', sourceLabel: 'github:owner/reports', nodeIds: ['a'], sameHashNodeIds: [],
      row: { ...row('reports', null, installed(deviceRuntime)), running: true, state: 'active' },
    }
    const state = host(['node-hash', 'device-hash'], [
      { pluginId: 'reports', hash: 'node-hash', decision: 'accepted' },
      { pluginId: 'reports', hash: 'device-hash', decision: 'accepted' },
    ])
    const result = derivePluginDistribution(byNode, state, 1, PLUGIN_API_MAJOR, [device])
    expect(result.selectedDevice.get('reports')?.hash).toBe('device-hash')
    expect(selected(result, 'a', 'reports')).toBe('node-hash')

    const untrusted = derivePluginDistribution(byNode, host(['node-hash', 'device-hash']), 2, PLUGIN_API_MAJOR, [device])
    expect(untrusted.pendingTrust).toMatchObject([{ hash: 'device-hash', source: { kind: 'device' }, sourceLabel: 'github:owner/reports' }])
  })

  it('drops an incompatible device bundle so the node runtime remains available', () => {
    const runtime = identity('2.0.0', 'node-hash')
    const device: DevicePluginEntry = {
      hash: 'device-hash', sourceLabel: 'npm:reports', nodeIds: ['a'], sameHashNodeIds: [],
      row: { ...row('reports', null, installed({ ...identity('1.9.0', 'device-hash'), apiVersion: '99' })), running: true, state: 'active' },
    }
    const result = derivePluginDistribution(new Map([['a', observation('a', [row('reports', runtime, installed(runtime))])]]),
      host(['node-hash', 'device-hash'], [{ pluginId: 'reports', hash: 'node-hash', decision: 'accepted' }]),
      1, PLUGIN_API_MAJOR, [device])
    expect(result.selectedDevice.size).toBe(0)
    expect(selected(result, 'a', 'reports')).toBe('node-hash')
  })

  it('selects each node’s running identity without a fleet-wide version winner', () => {
    const one = identity('1.0.0', 'hash-one')
    const two = identity('2.0.0', 'hash-two')
    const byNode = new Map([
      ['a', observation('a', [row('reports', one, installed(one))])],
      ['b', observation('b', [row('reports', two, installed(two)), row('unique', one, installed(one))])],
    ])
    const result = derivePluginDistribution(byNode, host(['hash-one', 'hash-two'], [
      { pluginId: 'reports', hash: 'hash-one', decision: 'accepted' },
      { pluginId: 'reports', hash: 'hash-two', decision: 'accepted' },
      { pluginId: 'unique', hash: 'hash-one', decision: 'accepted' },
    ]), 1, PLUGIN_API_MAJOR)
    expect(selected(result, 'a', 'reports')).toBe('hash-one')
    expect(selected(result, 'b', 'reports')).toBe('hash-two')
    expect(selected(result, 'b', 'unique')).toBe('hash-one')
    expect(result.byNode.get('a')?.rows[0]?.active?.version).toBe('1.0.0')
  })

  it('keeps an accepted old runtime selected while a disk update awaits trust and restart', () => {
    const one = identity('1.0.0', 'hash-one')
    const two = identity('2.0.0', 'hash-two')
    const byNode = new Map([['a', observation('a', [row('reports', one, installed(two))])]])
    const result = derivePluginDistribution(byNode, host(['hash-one', 'hash-two'], [
      { pluginId: 'reports', hash: 'hash-one', decision: 'accepted' },
    ]), 1, PLUGIN_API_MAJOR)
    expect(selected(result, 'a', 'reports')).toBe('hash-one')
    expect(result.pendingTrust.map((request) => [request.hash, request.relation])).toEqual([['hash-two', 'installed']])
  })

  it('withholds a changed runtime until its exact bytes are accepted, including after rejection', () => {
    const two = identity('2.0.0', 'hash-two')
    const byNode = new Map([['a', observation('a', [row('reports', two, installed(two))])]])
    const pending = derivePluginDistribution(byNode, host(['hash-two']), 1, PLUGIN_API_MAJOR)
    expect(selected(pending, 'a', 'reports')).toBeUndefined()
    expect(pending.pendingTrust).toHaveLength(1)
    const rejected = derivePluginDistribution(byNode, host(['hash-two'], [
      { pluginId: 'reports', hash: 'hash-two', decision: 'rejected' },
    ]), 2, PLUGIN_API_MAJOR)
    expect(selected(rejected, 'a', 'reports')).toBeUndefined()
    expect(rejected.pendingTrust).toEqual([])
  })

  it('retains an offline observation for explanation but never selects it', () => {
    const one = identity('1.0.0', 'hash-one')
    const byNode = new Map([['a', observation('a', [row('reports', one, installed(one))], false)]])
    const result = derivePluginDistribution(byNode, host(['hash-one'], [
      { pluginId: 'reports', hash: 'hash-one', decision: 'accepted' },
    ]), 1, PLUGIN_API_MAJOR)
    expect(result.byNode.get('a')?.rows).toHaveLength(1)
    expect(selected(result, 'a', 'reports')).toBeUndefined()
  })

  it('withholds one hash claimed with conflicting enforced declarations', () => {
    const one = identity('1.0.0', 'shared-hash')
    const widened = { ...one, permissions: { ...one.permissions, api: ['/v1/private'] } }
    const byNode = new Map([
      ['a', observation('a', [row('reports', one, installed(one))])],
      ['b', observation('b', [row('reports', widened, installed(widened))])],
    ])
    const result = derivePluginDistribution(byNode, host(['shared-hash'], [
      { pluginId: 'reports', hash: 'shared-hash', decision: 'accepted' },
    ]), 1, PLUGIN_API_MAJOR)
    expect(result.conflictingKeys.has(decisionKey('reports', 'shared-hash'))).toBe(true)
    expect(selected(result, 'a', 'reports')).toBeUndefined()
    expect(selected(result, 'b', 'reports')).toBeUndefined()
  })

  it('detects a changed declaration even when an installed update reuses the active client bytes', () => {
    const one = identity('1.0.0', 'shared-hash')
    const widened = { ...one, version: '2.0.0', permissions: { ...one.permissions, api: ['/v1/private'] } }
    const byNode = new Map([['a', observation('a', [row('reports', one, installed(widened))])]])
    const result = derivePluginDistribution(byNode, host(['shared-hash'], [
      { pluginId: 'reports', hash: 'shared-hash', decision: 'accepted' },
    ]), 1, PLUGIN_API_MAJOR)
    expect(result.conflictingKeys.has(decisionKey('reports', 'shared-hash'))).toBe(true)
    expect(selected(result, 'a', 'reports')).toBeUndefined()
  })

  it('adapts only coherent old-node rows and treats explicit modern inactivity as unavailable', () => {
    const one = identity('1.0.0', 'hash-one')
    const legacy: NodePluginRow = { ...row('old', one, installed(one)), active: undefined }
    const modern: NodePluginRow = row('new', null, installed(one))
    const byNode = new Map([['a', observation('a', [legacy, modern])]])
    const result = derivePluginDistribution(byNode, host(['hash-one'], [
      { pluginId: 'old', hash: 'hash-one', decision: 'accepted' },
      { pluginId: 'new', hash: 'hash-one', decision: 'accepted' },
    ]), 1, PLUGIN_API_MAJOR)
    expect(selected(result, 'a', 'old')).toBe('hash-one')
    expect(selected(result, 'a', 'new')).toBeUndefined()
  })
})
