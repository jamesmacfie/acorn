import { describe, expect, it } from 'vitest'
import { PLUGIN_API_MAJOR, type NodePluginRow, type PluginRuntimeIdentity } from '@acorn/protocol/api.ts'
import { clientDeclaration } from '@acorn/protocol/plugin/declaration.ts'
import type { PluginHostState } from '../../infra/platform'
import { contributionAvailability, nodePluginServiceAvailable } from './availabilityModel'
import { derivePluginDistribution, type NodePluginObservation } from './distributionModel'

const runtime: PluginRuntimeIdentity = {
  version: '1.0.0', apiVersion: PLUGIN_API_MAJOR, activation: 'node',
  permissions: { api: [], events: [], node: { core: [], capabilities: [], secrets: false, exec: false, net: [], sockets: false } },
  contributions: { frames: [] } as PluginRuntimeIdentity['contributions'],
  client: { hash: 'accepted-hash', bytes: 10 },
}
const active = (change: Partial<NodePluginRow> = {}): NodePluginRow => ({
  name: 'reports', required: false, disabled: false, running: true, state: 'active', active: runtime,
  installed: runtime, ...change,
})
const host = (decision?: 'accepted' | 'rejected'): PluginHostState => ({
  cached: { 'accepted-hash': { pluginId: 'reports', version: '1.0.0', bytes: 10 } },
  acks: decision ? [{
    pluginId: 'reports', hash: 'accepted-hash', nodeId: 'a', version: '1.0.0', decision, decidedAt: 1,
    declaration: clientDeclaration(runtime),
    permissions: runtime.permissions, webviews: [], keyClaims: [], navigationDestinations: [],
    extensions: [], schedules: [], taskChecks: [], harnesses: [], agentTools: [], contextSections: [], customAgents: [],
  }] : [],
  devGrants: [],
})
const result = (rows: NodePluginRow[], decision?: 'accepted' | 'rejected', reachable = true) => {
  const observation: NodePluginObservation = { nodeId: 'a', rows, reachable, stale: !reachable, generation: 1, observedAt: 1 }
  return derivePluginDistribution(new Map([['a', observation]]), host(decision), 1, PLUGIN_API_MAJOR)
}

describe('contribution availability', () => {
  it('requires an observed, reachable, active node service for compiled contributions', () => {
    // Built-in node plugins have a roster outcome but no installed client declaration. A failed
    // disk package with the same id can leave that built-in serving, so both forms must pass.
    const compiled = active({ active: null, installed: undefined })
    expect(nodePluginServiceAvailable(result([compiled]), 'a', 'reports')).toBe(true)
    expect(nodePluginServiceAvailable(result([active({ active: undefined, installed: undefined })]), 'a', 'reports')).toBe(true)
    expect(nodePluginServiceAvailable(result([active({ active: null })]), 'a', 'reports')).toBe(true)
    expect(nodePluginServiceAvailable(result([active({ active: null, state: 'pending-restart' })]), 'a', 'reports')).toBe(true)
    expect(contributionAvailability(result([compiled]), 'a', 'reports', PLUGIN_API_MAJOR).available).toBe(false)
    expect(nodePluginServiceAvailable(result([active()], 'accepted'), 'a', 'reports')).toBe(true)
    expect(nodePluginServiceAvailable(result([active({ installed: { ...runtime, version: '2.0.0' }, disabled: true, state: 'pending-restart' })], 'accepted'), 'a', 'reports')).toBe(true)
    for (const rows of [[], [active({ active: null, state: 'failed' })], [active({ active: null, state: 'disabled', disabled: true })], [active({ active: null, state: 'pending-restart', running: false })]]) {
      expect(nodePluginServiceAvailable(result(rows), 'a', 'reports')).toBe(false)
    }
    expect(nodePluginServiceAvailable(result([active()], 'accepted', false), 'a', 'reports')).toBe(false)
  })

  it('keeps the old accepted runtime available while an installed update waits for restart', () => {
    const snapshot = result([active({ installed: { ...runtime, version: '2.0.0', client: { hash: 'new-hash', bytes: 10 } }, state: 'pending-restart' })], 'accepted')
    const availability = contributionAvailability(snapshot, 'a', 'reports', PLUGIN_API_MAJOR)
    expect(availability.available).toBe(true)
    expect(availability.runtime.kind).toBe('active')
    if (availability.runtime.kind === 'active') expect(availability.runtime.pendingCandidate?.version).toBe('2.0.0')
  })

  it('distinguishes trust pending, rejection, failure, and offline state', () => {
    expect(contributionAvailability(result([active()]), 'a', 'reports', PLUGIN_API_MAJOR).reason).toBe('pending-trust')
    expect(contributionAvailability(result([active()], 'rejected'), 'a', 'reports', PLUGIN_API_MAJOR).reason).toBe('rejected')
    expect(contributionAvailability(result([active({ active: null, state: 'failed', reason: 'init failed' })]), 'a', 'reports', PLUGIN_API_MAJOR).reason).toBe('failed')
    expect(contributionAvailability(result([active()], 'accepted', false), 'a', 'reports', PLUGIN_API_MAJOR).reason).toBe('unreachable')
    expect(contributionAvailability(result([]), 'a', 'reports', PLUGIN_API_MAJOR).reason).toBe('absent')
  })

  it('retains a previous active identity after failed reload with a warning', () => {
    const availability = contributionAvailability(result([active({ state: 'failed', reason: 'candidate init failed' })], 'accepted'), 'a', 'reports', PLUGIN_API_MAJOR)
    expect(availability.available).toBe(true)
    expect(availability.runtime.kind === 'active' && availability.runtime.warning).toBe('candidate init failed')
  })
})
