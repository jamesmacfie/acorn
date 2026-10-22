import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { NodeFetchResponse } from '@acorn/protocol/broker.ts'
import { BundleCache, pluginDecisions, TrustStore, webCryptoSha256 } from './public'
import type { BundleStorage, RulesLog, TrustStorage } from './storage'

// The rules over storage that is neither a file nor synchronous, which is what a phone's browser has.
// `plugins/pluginCache.test.ts` and `plugins/pluginTrustStore.test.ts` hold the rest of the decisions
// over files. Here: the same bytes get the same hash, a bundle is stored before the index names it,
// and a record the rules can't read is set aside rather than overwritten.

const bytes = new TextEncoder().encode('export default {}')
const hash = createHash('sha256').update(bytes).digest('hex')

const log: RulesLog = { warn: vi.fn(), error: vi.fn() }

function memoryBundles() {
  const stored = new Map<string, Uint8Array>()
  const events: string[] = []
  const storage: BundleStorage = {
    readIndex: () => null,
    writeIndex: () => void events.push('index'),
    writeBundle: async (key, value) => {
      await Promise.resolve()
      stored.set(key, value)
      events.push('bytes')
    },
    keepOnly: (keep) => {
      for (const key of stored.keys()) if (!keep.has(key)) stored.delete(key)
    },
  }
  return { stored, events, storage }
}

const answer = (body: Uint8Array, status = 200): NodeFetchResponse => ({
  status,
  headers: {},
  body: body as Uint8Array<ArrayBuffer>,
})
const cacheOver = (storage: BundleStorage, served: Uint8Array) =>
  new BundleCache(storage, { fetch: async () => answer(served) }, webCryptoSha256, log)

describe('the shared cache rules, over storage that waits', () => {
  it('hashes with Web Crypto to what node:crypto gives', async () => {
    expect(await webCryptoSha256(bytes)).toBe(hash)
  })

  it('keeps the bytes before it records the bundle', async () => {
    const { stored, events, storage } = memoryBundles()
    const cache = cacheOver(storage, bytes)
    expect(await cache.putFromNode('node-1', 'runn', { hash, version: '1.0.0' })).toEqual({ hash })
    expect(events).toEqual(['bytes', 'index'])
    expect(stored.get(hash)).toEqual(bytes)
    expect(cache.has(hash)).toBe(true)
  })

  it('refuses bytes that don’t match the hash the node advertised, and keeps nothing', async () => {
    const { stored, events, storage } = memoryBundles()
    const cache = cacheOver(storage, new TextEncoder().encode('export default { evil: true }'))
    expect(await cache.putFromNode('node-1', 'runn', { hash, version: '1.0.0' })).toEqual({ error: 'hash-mismatch' })
    expect(events).toEqual([])
    expect(stored.size).toBe(0)
    expect(cache.has(hash)).toBe(false)
  })

  it('sweeps stored bundles the index doesn’t name', () => {
    const { stored, storage } = memoryBundles()
    stored.set('f'.repeat(64), bytes)
    cacheOver(storage, bytes).sweep()
    expect(stored.size).toBe(0)
  })
})

function memoryTrust(text: string | null = null) {
  const state = { text, setAside: 0 }
  const storage: TrustStorage = {
    read: () => state.text,
    write: (next) => void (state.text = next),
    setAside: () => ((state.setAside += 1), 'set-aside'),
  }
  return { state, storage }
}

describe('the shared trust rules, over storage the host loaded first', () => {
  it('remembers a decision across a fresh store over the same text', async () => {
    const first = memoryTrust()
    const cache = cacheOver(memoryBundles().storage, bytes)
    await cache.putFromNode('node-1', 'runn', { hash, version: '1.0.0' })
    const decisions = pluginDecisions(cache, new TrustStore(first.storage, log), log)
    await decisions.trustRecord({
      pluginId: 'runn',
      hash,
      nodeId: 'node-1',
      version: '1.0.0',
      decision: 'rejected',
      declaration: 'declared',
      permissions: {
        api: [],
        events: [],
        node: { core: [], capabilities: [], secrets: false, exec: false, net: [], sockets: false },
      },
      webviews: [],
      keyClaims: [],
    })
    const again = new TrustStore(memoryTrust(first.state.text).storage, log)
    expect(again.decisionFor('runn', hash)).toMatchObject({ decision: 'rejected' })
  })

  it('records only a decision about a bundle it holds', async () => {
    const decisions = pluginDecisions(
      cacheOver(memoryBundles().storage, bytes),
      new TrustStore(memoryTrust().storage, log),
      log,
    )
    await expect(
      decisions.trustRecord({ pluginId: 'runn', hash, version: '1.0.0', decision: 'accepted' }),
    ).rejects.toThrow('No cached bundle for runn')
  })

  it('sets aside a record it can’t read, so the next write doesn’t erase it', () => {
    const { state, storage } = memoryTrust('{ not json')
    expect(new TrustStore(storage, log).list()).toEqual([])
    expect(state.setAside).toBe(1)
  })
})
