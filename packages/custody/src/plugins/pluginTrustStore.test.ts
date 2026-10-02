import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodePluginPermissions } from '@acorn/protocol/api.ts'
import { PluginTrustStore, type PluginAck } from './pluginTrustStore'
import { writePrivateAtomic } from '@acorn/node-core/server/storage/dataRoot.ts'

vi.mock('@acorn/node-core/server/storage/dataRoot.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@acorn/node-core/server/storage/dataRoot.ts')>()
  return { ...actual, writePrivateAtomic: vi.fn(actual.writePrivateAtomic) }
})

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, renameSync: vi.fn(actual.renameSync) }
})

const NONE: NodePluginPermissions = { api: [], events: [], node: { core: [], capabilities: [], secrets: false, exec: false, net: [], sockets: false } }
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

let dir = ''
const store = () => new PluginTrustStore(dir)
const ack = (over: Partial<PluginAck> = {}): PluginAck => ({
  pluginId: 'sparkline',
  hash: HASH_A,
  nodeId: 'node-a',
  source: { kind: 'node', nodeId: 'node-a' },
  version: '1.0.0',
  permissions: NONE,
  webviews: [],
  keyClaims: [],
  navigationDestinations: [],
  extensions: [],
  schedules: [],
  taskChecks: [],
  harnesses: [],
  agentTools: [],
  contextSections: [],
  customAgents: [],
  decision: 'accepted',
  decidedAt: 1_700_000_000_000,
  ...over,
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'acorn-plugin-trust-'))
  vi.mocked(writePrivateAtomic).mockClear()
  vi.mocked(renameSync).mockClear()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

describe('acknowledging a bundle', () => {
  it('commits valid disclosures together without changing an unrelated rejection or development grant', () => {
    const trust = store()
    const rejected = ack({ pluginId: 'refused', hash: HASH_B, decision: 'rejected' })
    trust.record(rejected)
    trust.grantDev({ pluginId: 'workbench', nodeId: 'node-a', grantedAt: 100 })
    vi.mocked(writePrivateAtomic).mockClear()
    const first = ack({ permissions: { ...NONE, api: ['core.tasks:read'] } })
    const last = ack({ pluginId: 'other', hash: 'c'.repeat(64) })

    const results = trust.recordBatch([first, ack({ hash: 'invalid' }), last])

    expect(results).toEqual([{ ack: first }, { ack: expect.anything(), error: expect.any(Error) }, { ack: last }])
    expect(writePrivateAtomic).toHaveBeenCalledTimes(1)
    const persisted = store()
    expect(persisted.decisionFor('sparkline', HASH_A)?.permissions.api).toEqual(['core.tasks:read'])
    expect(persisted.decisionFor('refused', HASH_B)).toEqual(rejected)
    expect(persisted.decisionFor('other', 'c'.repeat(64))).toEqual(last)
    expect(persisted.listDevGrants()).toEqual([{ pluginId: 'workbench', nodeId: 'node-a', source: { kind: 'node', nodeId: 'node-a' }, grantedAt: 100 }])

    vi.mocked(writePrivateAtomic).mockClear()
    trust.recordBatch([ack({ ...first, decidedAt: first.decidedAt + 1 }), last])
    expect(writePrivateAtomic).not.toHaveBeenCalled()
    expect(store().decisionFor('sparkline', HASH_A)?.decidedAt).toBe(first.decidedAt)
  })

  it('leaves remembered and durable decisions intact after a failed batch commit', () => {
    const trust = store()
    trust.record(ack({ decision: 'rejected' }))
    vi.mocked(writePrivateAtomic).mockImplementationOnce(() => { throw new Error('disk unavailable') })

    expect(() => trust.recordBatch([ack(), ack({ hash: HASH_B })])).toThrow('disk unavailable')
    expect(trust.decisionFor('sparkline', HASH_A)?.decision).toBe('rejected')
    expect(trust.decisionFor('sparkline', HASH_B)).toBeUndefined()
    expect(store().list()).toEqual(trust.list())
    trust.recordBatch([ack(), ack({ hash: HASH_B })])
    expect(store().list()).toHaveLength(2)
    expect(store().decisionFor('sparkline', HASH_A)?.decision).toBe('accepted')
  })

  it('keeps the prior trust file when atomic replacement fails after its successor is synced', () => {
    const trust = store()
    trust.record(ack({ decision: 'rejected' }))
    const path = join(dir, 'acorn-1-plugin-trust.json')
    const before = readFileSync(path, 'utf8')
    vi.mocked(renameSync).mockImplementationOnce(() => { throw new Error('replacement unavailable') })

    expect(() => trust.recordBatch([ack(), ack({ hash: HASH_B })])).toThrow('replacement unavailable')
    expect(readFileSync(path, 'utf8')).toBe(before)
    expect(trust.list()).toEqual(store().list())
    expect(trust.decisionFor('sparkline', HASH_A)?.decision).toBe('rejected')
    trust.recordBatch([ack(), ack({ hash: HASH_B })])
    expect(store().list()).toHaveLength(2)
    expect(store().decisionFor('sparkline', HASH_A)?.decision).toBe('accepted')
  })

  it('reads a pre-provenance acknowledgement as node sourced', () => {
    writeFileSync(join(dir, 'acorn-1-plugin-trust.json'), JSON.stringify({ version: 1, acks: [ack({ source: undefined })], devGrants: [] }))
    expect(store().decisionFor('sparkline', HASH_A)?.source).toEqual({ kind: 'node', nodeId: 'node-a' })
  })

  it('keeps one decision for identical bytes offered by a device and a node', () => {
    const first = store()
    first.record(ack({ source: { kind: 'device' }, nodeId: '' }))
    expect(first.decisionFor('sparkline', HASH_A)?.decision).toBe('accepted')
    expect(first.list()).toHaveLength(1)
  })

  it('limits a device development grant to device provenance', () => {
    const first = store()
    first.grantDev({ pluginId: 'sparkline', nodeId: '', source: { kind: 'device' }, grantedAt: Date.now() })
    expect(first.recordDevAccept({ pluginId: 'sparkline', nodeId: 'node-a', hash: HASH_A, version: '2.0.0' })).toBe(false)
    expect(first.recordDevAccept({ pluginId: 'sparkline', nodeId: '', source: { kind: 'device' }, hash: HASH_A, version: '2.0.0' })).toBe(true)
    expect(first.decisionFor('sparkline', HASH_A)).toMatchObject({ dev: true, partial: true, source: { kind: 'device' } })
  })

  it('does not overwrite a later manual decision when a development source is cached again', () => {
    const first = store()
    first.grantDev({ pluginId: 'sparkline', nodeId: 'node-a', source: { kind: 'node', nodeId: 'node-a' }, grantedAt: Date.now() })
    expect(first.recordDevAccept({ pluginId: 'sparkline', nodeId: 'node-a', hash: HASH_A, version: '1.0.0' })).toBe(true)
    first.record(ack({ decision: 'rejected', declaration: 'reviewed-declaration' }))
    expect(first.recordDevAccept({ pluginId: 'sparkline', nodeId: 'node-a', hash: HASH_A, version: '1.0.0' })).toBe(false)
    expect(first.decisionFor('sparkline', HASH_A)).toMatchObject({ decision: 'rejected', declaration: 'reviewed-declaration' })
  })

  it('keeps device acknowledgements after uninstall while ending future development trust', () => {
    const first = store()
    first.grantDev({ pluginId: 'sparkline', nodeId: '', source: { kind: 'device' }, grantedAt: Date.now() })
    first.recordDevAccept({ pluginId: 'sparkline', nodeId: '', source: { kind: 'device' }, hash: HASH_A, version: '1.0.0' })
    first.forgetDevGrant('sparkline', { kind: 'device' })
    expect(first.devGrantFor('sparkline', { kind: 'device' })).toBeUndefined()
    expect(first.decisionFor('sparkline', HASH_A)?.decision).toBe('accepted')
    expect(first.recordDevAccept({ pluginId: 'sparkline', nodeId: '', source: { kind: 'device' }, hash: HASH_B, version: '2.0.0' })).toBe(false)
  })

  it('withdraws only the named exact-hash decision', () => {
    const trust = store()
    trust.record(ack({ hash: HASH_A }))
    trust.record(ack({ hash: HASH_B }))
    trust.forgetDecision('sparkline', HASH_A)
    expect(trust.decisionFor('sparkline', HASH_A)).toBeUndefined()
    expect(trust.decisionFor('sparkline', HASH_B)?.decision).toBe('accepted')
  })
  it('has no decision on first sight, which is the prompt condition', () => {
    expect(store().decisionFor('sparkline', HASH_A)).toBeUndefined()
  })

  it('remembers an acceptance across processes', () => {
    store().record(ack())
    expect(store().decisionFor('sparkline', HASH_A)?.decision).toBe('accepted')
  })

  it('remembers a rejection too, so a refused plugin does not ask again every boot', () => {
    store().record(ack({ decision: 'rejected' }))
    expect(store().decisionFor('sparkline', HASH_A)?.decision).toBe('rejected')
  })

  it('asks again when the same plugin arrives with different bytes', () => {
    // The update case. Consent was given to a hash, not to a name, which is the whole point of
    // binding the acknowledgement to content.
    store().record(ack())
    expect(store().decisionFor('sparkline', HASH_B)).toBeUndefined()
  })

  it('offers the last accepted bundle as the thing to diff an update against', () => {
    const first = store()
    first.record(ack({ hash: HASH_A, version: '1.0.0', permissions: { ...NONE, api: ['tasks'] } }))
    expect(first.previousFor('sparkline', HASH_B)).toMatchObject({ hash: HASH_A, version: '1.0.0' })
    // Not itself: asked about the bundle it already covers, there is no "previous" to show.
    expect(first.previousFor('sparkline', HASH_A)).toBeUndefined()
  })

  it('never offers a rejected bundle as the previous one', () => {
    const first = store()
    first.record(ack({ hash: HASH_A, decision: 'rejected' }))
    expect(first.previousFor('sparkline', HASH_B)).toBeUndefined()
  })

  it('replaces a decision about the same bundle rather than appending', () => {
    const first = store()
    first.record(ack({ decision: 'rejected' }))
    first.record(ack({ decision: 'accepted', decidedAt: 1_700_000_001_000 }))
    expect(first.list()).toHaveLength(1)
    expect(first.decisionFor('sparkline', HASH_A)?.decision).toBe('accepted')
  })

  // Every launch re-records the bundled plugins (bundledPluginTrust.ts), and each write fsyncs the
  // whole file. Re-deciding the same bundle the same way is not a decision.
  it('does not rewrite the file when the stored decision is the same', () => {
    store().record(ack())
    const path = join(dir, 'acorn-1-plugin-trust.json')
    const before = statSync(path, { bigint: true }).mtimeNs

    // A fresh store, because a launch is a fresh process. The later `decidedAt` is deliberate: the
    // stored answer to "when did the owner decide this" is the first time, not the last.
    store().record(ack({ decidedAt: 1_700_000_009_000 }))
    expect(statSync(path, { bigint: true }).mtimeNs).toBe(before)
    expect(store().decisionFor('sparkline', HASH_A)?.decidedAt).toBe(1_700_000_000_000)

    // And it does write when anything else about the disclosure moved.
    store().record(ack({ permissions: { ...NONE, api: ['core.tasks:read'] } }))
    expect(statSync(path, { bigint: true }).mtimeNs).not.toBe(before)
    expect(store().decisionFor('sparkline', HASH_A)?.permissions.api).toEqual(['core.tasks:read'])
  })
})

describe('custody', () => {
  it('is per device: a fresh store knows nothing and prompts again', () => {
    store().record(ack())
    // A second machine, or a re-imaged one. Pairing a new laptop re-prompts by design: the decision
    // was this device's to make, exactly like its device token.
    const other = new PluginTrustStore(mkdtempSync(join(tmpdir(), 'acorn-plugin-trust-other-')))
    expect(other.decisionFor('sparkline', HASH_A)).toBeUndefined()
  })

  it('writes the file 0600', () => {
    store().record(ack())
    expect(statSync(join(dir, 'acorn-1-plugin-trust.json')).mode & 0o777).toBe(0o600)
  })

  it('fails closed on a file it cannot parse', () => {
    writeFileSync(join(dir, 'acorn-1-plugin-trust.json'), '{ not json')
    // Every plugin re-prompts, which is an annoyance. Guessing at a half-parsed row would mean
    // running code on the strength of it.
    expect(store().list()).toEqual([])
  })

  it('reads pre-webview version-1 acknowledgements as having no webview grants', () => {
    const { webviews: _webviews, keyClaims: _keyClaims, navigationDestinations: _navigationDestinations, ...legacy } = ack()
    writeFileSync(join(dir, 'acorn-1-plugin-trust.json'), JSON.stringify({ version: 1, acks: [legacy] }))
    expect(store().list()[0]?.webviews).toEqual([])
    expect(store().list()[0]?.keyClaims).toEqual([])
    expect(store().list()[0]?.navigationDestinations).toEqual([])
  })

  it('refuses a malformed acknowledgement rather than storing one nothing can match', () => {
    expect(() => store().record(ack({ hash: 'not-a-hash' }))).toThrow()
  })

  it('keeps the readable acknowledgements when one row cannot be parsed', () => {
    // The whole file used to be parsed as a unit, so one row written by a newer build condemned every
    // row beside it, and the empty result became the cache, so the next write erased them.
    const good = ack({ hash: HASH_A })
    const alsoGood = ack({ pluginId: 'board', hash: HASH_B, decision: 'rejected' })
    writeFileSync(
      join(dir, 'acorn-1-plugin-trust.json'),
      JSON.stringify({ version: 1, acks: [good, { pluginId: 'future', hash: 12, whatever: true }, alsoGood] }),
    )
    const kept = store().list()
    expect(kept.map((entry) => entry.pluginId).sort()).toEqual(['board', 'sparkline'])
  })

  it('does not erase every decision on the next write when one row was unreadable', () => {
    const remembered = ack({ pluginId: 'board', hash: HASH_B, decision: 'rejected' })
    writeFileSync(
      join(dir, 'acorn-1-plugin-trust.json'),
      JSON.stringify({ version: 1, acks: [remembered, { pluginId: 'future', hash: 12 }] }),
    )
    // A rejection is the one that hurts most to lose: forget it and the plugin the owner turned away
    // asks again on every boot.
    const trust = store()
    trust.record(ack({ pluginId: 'sparkline', hash: HASH_A }))
    expect(new PluginTrustStore(dir).decisionFor('board', HASH_B)?.decision).toBe('rejected')
  })

  it('sets an unrecognisable file aside instead of letting the next write destroy it', () => {
    const path = join(dir, 'acorn-1-plugin-trust.json')
    writeFileSync(path, '{ not json')
    const trust = store()
    expect(trust.list()).toEqual([])
    // This is the only copy of every decision the owner ever made. "We could not read it" must not
    // silently become "it is gone".
    expect(existsSync(`${path}.corrupt`)).toBe(true)
    expect(readFileSync(`${path}.corrupt`, 'utf8')).toBe('{ not json')
    // And the store still works from here.
    trust.record(ack())
    expect(new PluginTrustStore(dir).decisionFor('sparkline', HASH_A)?.decision).toBe('accepted')
  })

  it('never diffs an update against a partial snapshot', () => {
    // A decision recorded when the disclosure could not be parsed. Its snapshot
    // is known-incomplete, so using it as the "what changed" baseline would mark grants as newly
    // requested that the owner had already seen, the alarming direction.
    const trust = store()
    trust.record(ack({ hash: HASH_A, partial: true }))
    expect(trust.previousFor('sparkline', HASH_B)).toBeUndefined()
    trust.record(ack({ hash: 'c'.repeat(64), decidedAt: 1_700_000_000_001 }))
    expect(trust.previousFor('sparkline', HASH_B)?.hash).toBe('c'.repeat(64))
  })
})
