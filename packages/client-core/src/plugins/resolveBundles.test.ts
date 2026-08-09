import { describe, expect, it } from 'vitest'
import { compareVersions, resolveActiveBundles, type BundleCandidate } from './resolveBundles'

const candidate = (over: Partial<BundleCandidate> = {}): BundleCandidate => ({
  pluginId: 'sparkline',
  version: '1.0.0',
  apiVersion: '1',
  hash: 'a'.repeat(64),
  nodeId: 'node-a',
  ...over,
})

const resolve = (candidates: BundleCandidate[]) => resolveActiveBundles(candidates, { apiVersion: '1' })

describe('comparing versions', () => {
  it('orders numerically, not lexically', () => {
    // The case a string compare gets wrong, and the reason this function exists at all.
    expect(compareVersions('2.10.0', '2.9.0')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
    expect(compareVersions('0.9.9', '1.0.0')).toBeLessThan(0)
  })
})

// Contribution ids are un-namespaced persisted layout keys (registries/plugin.ts), so two versions of
// one plugin registering at once would collide on ids a user's saved layout points at. Exactly one
// bundle per plugin id may win.
describe('picking one bundle per plugin', () => {
  it('takes the highest version across the fleet', () => {
    const winners = resolve([
      candidate({ version: '1.0.0', hash: 'a'.repeat(64), nodeId: 'node-a' }),
      candidate({ version: '2.10.0', hash: 'b'.repeat(64), nodeId: 'node-b' }),
      candidate({ version: '2.9.0', hash: 'c'.repeat(64), nodeId: 'node-c' }),
    ])
    expect(winners.get('sparkline')).toEqual({ pluginId: 'sparkline', version: '2.10.0', hash: 'b'.repeat(64), nodeIds: ['node-b'] })
  })

  it('treats the same bytes from two nodes as one bundle with two sources', () => {
    // The plugin's UI renders against every node that has it, whatever version each carries — so the
    // node list is plural, and it is what phase 3 instantiates a frame per.
    const winners = resolve([candidate({ nodeId: 'node-a' }), candidate({ nodeId: 'node-b' })])
    expect(winners.get('sparkline')?.nodeIds).toEqual(['node-a', 'node-b'])
  })

  it('drops a bundle built for a plugin API this client does not speak', () => {
    // Dropped rather than deferred: a bundle for another API major cannot be run, and pretending
    // otherwise moves the failure from here to an import that throws.
    const winners = resolve([candidate({ version: '9.0.0', apiVersion: '2', hash: 'b'.repeat(64) }), candidate({ version: '1.0.0' })])
    expect(winners.get('sparkline')?.version).toBe('1.0.0')
  })

  it('has no winner when every candidate is for another API major', () => {
    expect(resolve([candidate({ apiVersion: '2' })]).size).toBe(0)
  })

  it('resolves two builds of one version the same way every boot', () => {
    // Arbitrary but STABLE is the requirement: a fleet that picked differently on each boot would
    // move a user's panes between machines for no visible reason.
    const forward = resolve([candidate({ hash: 'a'.repeat(64), nodeId: 'node-a' }), candidate({ hash: 'f'.repeat(64), nodeId: 'node-b' })])
    const reversed = resolve([candidate({ hash: 'f'.repeat(64), nodeId: 'node-b' }), candidate({ hash: 'a'.repeat(64), nodeId: 'node-a' })])
    expect(forward.get('sparkline')?.hash).toBe(reversed.get('sparkline')?.hash)
  })

  it('resolves each plugin independently', () => {
    const winners = resolve([
      candidate({ pluginId: 'sparkline', version: '1.0.0' }),
      candidate({ pluginId: 'ntfy', version: '3.0.0', hash: 'b'.repeat(64) }),
    ])
    expect([...winners.keys()].sort()).toEqual(['ntfy', 'sparkline'])
  })

  it('has nothing to resolve for an empty fleet', () => {
    expect(resolve([]).size).toBe(0)
  })
})
