import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodePluginPermissions } from '@acorn/protocol/api.ts'
import { PluginTrustStore, type PluginAck } from './pluginTrustStore'

// The dev trust grant (docs/security.md § The dev grant): one decision that replaces the per-hash prompt
// for one plugin while the owner is developing it. Everything below tests the two properties that make it
// a bounded grant rather than a hole — it covers exactly one (plugin, node) pair, and ending it puts the
// plugin back where it was.

const NONE: NodePluginPermissions = { api: [], events: [], node: { core: [], capabilities: [], secrets: false, exec: false, net: [] } }
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)

let dir = ''
const store = () => new PluginTrustStore(dir)
const handAck = (over: Partial<PluginAck> = {}): PluginAck => ({
  pluginId: 'sparkline',
  hash: HASH_A,
  nodeId: 'node-a',
  version: '1.0.0',
  permissions: NONE,
  webviews: [],
  keyClaims: [],
  extensions: [],
  schedules: [],
  taskChecks: [],
  decision: 'accepted',
  decidedAt: 1_700_000_000_000,
  ...over,
})
const bundle = (over: Partial<{ pluginId: string; hash: string; nodeId: string; version: string }> = {}) => ({
  pluginId: 'sparkline',
  hash: HASH_B,
  nodeId: 'node-a',
  version: '1.0.1',
  ...over,
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'acorn-plugin-dev-'))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

describe('without a grant', () => {
  it('records nothing, so a bundle nobody granted still prompts', () => {
    const trust = store()
    expect(trust.recordDevAccept(bundle())).toBe(false)
    expect(trust.decisionFor('sparkline', HASH_B)).toBeUndefined()
    expect(trust.list()).toEqual([])
  })
})

describe('a dev grant auto-trusts new bundles', () => {
  it('accepts a hash this device has never seen, for that plugin on that node', () => {
    const trust = store()
    trust.grantDev({ pluginId: 'sparkline', nodeId: 'node-a', path: '/src/sparkline', grantedAt: 1 })
    expect(trust.recordDevAccept(bundle())).toBe(true)
    expect(trust.decisionFor('sparkline', HASH_B)?.decision).toBe('accepted')
    // …and the next save, and the one after that. This is the whole point of the grant.
    expect(trust.recordDevAccept(bundle({ hash: HASH_C, version: '1.0.2' }))).toBe(true)
    expect(trust.decisionFor('sparkline', HASH_C)?.decision).toBe('accepted')
  })

  it('survives the process, like every other decision in this file', () => {
    store().grantDev({ pluginId: 'sparkline', nodeId: 'node-a', grantedAt: 1 })
    expect(store().recordDevAccept(bundle())).toBe(true)
    expect(store().devGrantFor('sparkline', 'node-a')?.path).toBeUndefined()
    expect(store().listDevGrants()).toHaveLength(1)
  })

  it('covers that plugin only', () => {
    const trust = store()
    trust.grantDev({ pluginId: 'sparkline', nodeId: 'node-a', grantedAt: 1 })
    expect(trust.recordDevAccept(bundle({ pluginId: 'other' }))).toBe(false)
    expect(trust.decisionFor('other', HASH_B)).toBeUndefined()
  })

  it('covers that node only — a second node offering the same name gets nothing', () => {
    // The design note says "per (pluginId, device)". The node half is an addition, and it matters: fleet
    // resolution picks the highest version across every paired node, so a grant keyed on the name alone
    // would auto-trust a bundle a DIFFERENT node started serving under it.
    const trust = store()
    trust.grantDev({ pluginId: 'sparkline', nodeId: 'node-a', grantedAt: 1 })
    expect(trust.recordDevAccept(bundle({ nodeId: 'node-b' }))).toBe(false)
    expect(trust.decisionFor('sparkline', HASH_B)).toBeUndefined()
  })

  it('marks what it wrote, and marks it partial so it can never become a diff baseline', () => {
    const trust = store()
    trust.grantDev({ pluginId: 'sparkline', nodeId: 'node-a', grantedAt: 1 })
    trust.recordDevAccept(bundle())
    const row = trust.decisionFor('sparkline', HASH_B)!
    expect(row.dev).toBe(true)
    expect(row.partial).toBe(true)
    // Nobody read a disclosure, so a later "what changed" prompt must not diff against one.
    expect(trust.previousFor('sparkline', HASH_C)).toBeUndefined()
  })

  it('re-granting does not stack rows', () => {
    const trust = store()
    trust.grantDev({ pluginId: 'sparkline', nodeId: 'node-a', grantedAt: 1 })
    trust.grantDev({ pluginId: 'sparkline', nodeId: 'node-a', path: '/src/sparkline', grantedAt: 2 })
    expect(trust.listDevGrants()).toHaveLength(1)
    expect(trust.devGrantFor('sparkline', 'node-a')?.path).toBe('/src/sparkline')
  })
})

describe('ending dev mode', () => {
  it('re-withholds every bundle the grant trusted, so the current one prompts again', () => {
    const trust = store()
    trust.grantDev({ pluginId: 'sparkline', nodeId: 'node-a', grantedAt: 1 })
    trust.recordDevAccept(bundle())
    trust.recordDevAccept(bundle({ hash: HASH_C, version: '1.0.2' }))

    trust.revokeDev('sparkline', 'node-a')

    expect(trust.devGrantFor('sparkline', 'node-a')).toBeUndefined()
    // Undecided is the prompt condition (see decisionFor). This is "promoting out of dev mode re-enters
    // per-hash trust at the current bundle", stated as the only thing that can make it true.
    expect(trust.decisionFor('sparkline', HASH_B)).toBeUndefined()
    expect(trust.decisionFor('sparkline', HASH_C)).toBeUndefined()
    expect(trust.list()).toEqual([])
  })

  it('leaves decisions the owner actually made', () => {
    const trust = store()
    trust.record(handAck())
    trust.record(handAck({ pluginId: 'other', hash: HASH_C, decision: 'rejected' }))
    trust.grantDev({ pluginId: 'sparkline', nodeId: 'node-a', grantedAt: 1 })
    trust.recordDevAccept(bundle())

    trust.revokeDev('sparkline', 'node-a')

    // The bundle they read and accepted by hand is still accepted; the one they turned away is still
    // turned away. Only what the grant wrote goes.
    expect(trust.decisionFor('sparkline', HASH_A)?.decision).toBe('accepted')
    expect(trust.decisionFor('other', HASH_C)?.decision).toBe('rejected')
    expect(trust.decisionFor('sparkline', HASH_B)).toBeUndefined()
  })

  it('does not touch another node’s grant for the same plugin', () => {
    const trust = store()
    trust.grantDev({ pluginId: 'sparkline', nodeId: 'node-a', grantedAt: 1 })
    trust.grantDev({ pluginId: 'sparkline', nodeId: 'node-b', grantedAt: 1 })
    trust.recordDevAccept(bundle({ nodeId: 'node-b' }))

    trust.revokeDev('sparkline', 'node-a')

    expect(trust.devGrantFor('sparkline', 'node-b')).toBeDefined()
    expect(trust.decisionFor('sparkline', HASH_B)?.decision).toBe('accepted')
  })

  it('goes with the plugin when the plugin is forgotten', () => {
    const trust = store()
    trust.grantDev({ pluginId: 'sparkline', nodeId: 'node-a', grantedAt: 1 })
    trust.forgetPlugin('sparkline')
    expect(trust.listDevGrants()).toEqual([])
  })
})

describe('the file', () => {
  it('reads a trust file written before dev mode existed as "nothing is in development"', () => {
    // Not a migration: the schema defaults, so an older file keeps every acknowledgement it holds and
    // simply has no grants. The alternative — an unreadable file — would erase every decision on the
    // device, which is the failure this store is most careful about.
    const trust = store()
    trust.record(handAck())
    const path = join(dir, 'plugin-trust.json')
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    delete raw.devGrants
    writeFileSync(path, JSON.stringify(raw))

    const reread = store()
    expect(reread.listDevGrants()).toEqual([])
    expect(reread.decisionFor('sparkline', HASH_A)?.decision).toBe('accepted')
  })
})
