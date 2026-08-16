import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodePluginPermissions } from '@acorn/protocol/api.ts'
import { PluginTrustStore, type PluginAck } from './pluginTrustStore'

const NONE: NodePluginPermissions = { api: [], events: [], node: { core: [], capabilities: [], secrets: false, exec: false, net: [] } }
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

let dir = ''
const store = () => new PluginTrustStore(dir)
const ack = (over: Partial<PluginAck> = {}): PluginAck => ({
  pluginId: 'sparkline',
  hash: HASH_A,
  nodeId: 'node-a',
  version: '1.0.0',
  permissions: NONE,
  webviews: [],
  keyClaims: [],
  extensions: [],
  schedules: [],
  decision: 'accepted',
  decidedAt: 1_700_000_000_000,
  ...over,
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'acorn-plugin-trust-'))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

describe('acknowledging a bundle', () => {
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
    // The update case. Consent was given to a hash, not to a name — which is the whole point of
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
})

describe('custody', () => {
  it('is per device: a fresh store knows nothing and prompts again', () => {
    store().record(ack())
    // A second machine, or a re-imaged one. Pairing a new laptop re-prompts by design — the decision
    // was this device's to make, exactly like its device token.
    const other = new PluginTrustStore(mkdtempSync(join(tmpdir(), 'acorn-plugin-trust-other-')))
    expect(other.decisionFor('sparkline', HASH_A)).toBeUndefined()
  })

  it('writes the file 0600', () => {
    store().record(ack())
    expect(statSync(join(dir, 'plugin-trust.json')).mode & 0o777).toBe(0o600)
  })

  it('fails closed on a file it cannot parse', () => {
    writeFileSync(join(dir, 'plugin-trust.json'), '{ not json')
    // Every plugin re-prompts, which is an annoyance. Guessing at a half-parsed row would mean
    // running code on the strength of it.
    expect(store().list()).toEqual([])
  })

  it('reads pre-webview version-1 acknowledgements as having no webview grants', () => {
    const { webviews: _webviews, keyClaims: _keyClaims, ...legacy } = ack()
    writeFileSync(join(dir, 'plugin-trust.json'), JSON.stringify({ version: 1, acks: [legacy] }))
    expect(store().list()[0]?.webviews).toEqual([])
    expect(store().list()[0]?.keyClaims).toEqual([])
  })

  it('refuses a malformed acknowledgement rather than storing one nothing can match', () => {
    expect(() => store().record(ack({ hash: 'not-a-hash' }))).toThrow()
  })

  it('keeps the readable acknowledgements when one row cannot be parsed', () => {
    // The whole file used to be parsed as a unit, so one row written by a newer build condemned every
    // row beside it — and the empty result became the cache, so the next write ERASED them.
    const good = ack({ hash: HASH_A })
    const alsoGood = ack({ pluginId: 'board', hash: HASH_B, decision: 'rejected' })
    writeFileSync(
      join(dir, 'plugin-trust.json'),
      JSON.stringify({ version: 1, acks: [good, { pluginId: 'future', hash: 12, whatever: true }, alsoGood] }),
    )
    const kept = store().list()
    expect(kept.map((entry) => entry.pluginId).sort()).toEqual(['board', 'sparkline'])
  })

  it('does not erase every decision on the next write when one row was unreadable', () => {
    const remembered = ack({ pluginId: 'board', hash: HASH_B, decision: 'rejected' })
    writeFileSync(
      join(dir, 'plugin-trust.json'),
      JSON.stringify({ version: 1, acks: [remembered, { pluginId: 'future', hash: 12 }] }),
    )
    // A rejection is the one that hurts most to lose: forget it and the plugin the owner turned away
    // asks again on every boot.
    const trust = store()
    trust.record(ack({ pluginId: 'sparkline', hash: HASH_A }))
    expect(new PluginTrustStore(dir).decisionFor('board', HASH_B)?.decision).toBe('rejected')
  })

  it('sets an unrecognisable file aside instead of letting the next write destroy it', () => {
    const path = join(dir, 'plugin-trust.json')
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
    // A decision recorded when the disclosure could not be parsed (main/pluginIpc.ts). Its snapshot is
    // known-incomplete, so using it as the "what changed" baseline would mark grants as newly
    // requested that the owner had already seen — the alarming direction.
    const trust = store()
    trust.record(ack({ hash: HASH_A, partial: true }))
    expect(trust.previousFor('sparkline', HASH_B)).toBeUndefined()
    trust.record(ack({ hash: 'c'.repeat(64), decidedAt: 1_700_000_000_001 }))
    expect(trust.previousFor('sparkline', HASH_B)?.hash).toBe('c'.repeat(64))
  })
})
