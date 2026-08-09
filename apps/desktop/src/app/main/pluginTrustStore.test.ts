import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
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

  it('refuses a malformed acknowledgement rather than storing one nothing can match', () => {
    expect(() => store().record(ack({ hash: 'not-a-hash' }))).toThrow()
  })
})
