import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeFetchRequest, NodeFetchResponse } from '@acorn/protocol/broker.ts'
import { MAX_BUNDLE_BYTES, PluginCache } from './pluginCache'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import { PLUGIN_API_MAJOR } from '@acorn/protocol/plugin/apiVersion.ts'
import { NodeResponseTooLargeError } from '../broker/nodeRequest'

// Nothing to mock: the cache takes userDataDir as a parameter, the way fleetStore does, and touches
// no shell API. That is what makes the hashing rules, the part that carries the security property,
// testable without a window.

const BUNDLE = 'export default { name: "sparkline" }'
const sha256 = (text: string) => createHash('sha256').update(Buffer.from(text)).digest('hex')

let dir = ''
let served: { status: number; body: string | Uint8Array<ArrayBuffer> } | Error = { status: 200, body: BUNDLE }
let legacyServed: typeof served | null = null
let requests: Array<{ nodeId: string; request: NodeFetchRequest; limits: { maxResponseBytes?: number } | undefined }> = []

const broker = {
  fetch: async (nodeId: string, request: NodeFetchRequest, limits?: { maxResponseBytes?: number }): Promise<NodeFetchResponse> => {
    requests.push({ nodeId, request, limits })
    const answer = request.path.endsWith('/client.js') && legacyServed ? legacyServed : served
    if (answer instanceof Error) throw answer
    const body = typeof answer.body === 'string' ? new TextEncoder().encode(answer.body) : answer.body
    return { status: answer.status, headers: {}, body }
  },
}

const cache = () => new PluginCache(dir, broker)
const claim = (hash = sha256(BUNDLE)) => ({ hash, version: '1.2.0' })
const cacheDir = () => join(dir, 'acorn-1-plugin-cache')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'acorn-plugin-cache-'))
  served = { status: 200, body: BUNDLE }
  legacyServed = null
  requests = []
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

describe('fetching a bundle from a node', () => {
  it('stores under the hash of the bytes and reports it', async () => {
    const store = cache()
    expect(await store.putFromNode('node-a', 'sparkline', claim())).toEqual({ hash: sha256(BUNDLE) })
    expect(requests[0].request.path).toBe(`/v1/core/plugins/sparkline/bundles/${sha256(BUNDLE)}`)
    expect(requests[0].limits).toEqual({ maxResponseBytes: MAX_BUNDLE_BYTES })
    expect(store.has(sha256(BUNDLE))).toBe(true)
    expect(readFileSync(join(cacheDir(), `${sha256(BUNDLE)}.js`), 'utf8')).toBe(BUNDLE)
    expect(store.list()[sha256(BUNDLE)]).toMatchObject({ pluginId: 'sparkline', version: '1.2.0', bytes: BUNDLE.length, nodeIds: ['node-a'] })
  })

  it('survives the process: a second store reads the index off disk', async () => {
    await cache().putFromNode('node-a', 'sparkline', claim())
    // The offline-first property. Nothing has connected in this second store's lifetime.
    expect(cache().has(sha256(BUNDLE))).toBe(true)
    expect(cache().list()[sha256(BUNDLE)].pluginId).toBe('sparkline')
  })

  it('uses the legacy route for an older node and still verifies its bytes', async () => {
    served = { status: 404, body: '' }
    legacyServed = { status: 200, body: BUNDLE }
    expect(await cache().putFromNode('old-node', 'sparkline', claim())).toEqual({ hash: sha256(BUNDLE) })
    expect(requests.map(({ request }) => request.path)).toEqual([
      `/v1/core/plugins/sparkline/bundles/${sha256(BUNDLE)}`,
      '/v1/core/plugins/sparkline/client.js',
    ])
    expect(requests.map(({ limits }) => limits)).toEqual([
      { maxResponseBytes: MAX_BUNDLE_BYTES },
      { maxResponseBytes: MAX_BUNDLE_BYTES },
    ])
    legacyServed = { status: 200, body: 'other bytes' }
    expect(await cache().putFromNode('old-node', 'changed', claim(sha256('different')))).toEqual({ error: 'hash-mismatch' })
  })

  it('does not re-fetch a bundle it already holds', async () => {
    const store = cache()
    await store.putFromNode('node-a', 'sparkline', claim())
    expect(await store.putFromNode('node-b', 'sparkline', claim())).toEqual({ hash: sha256(BUNDLE) })
    expect(requests).toHaveLength(1)
    // Both nodes are recorded against the one entry: identical bytes are one bundle, not two.
    expect(store.list()[sha256(BUNDLE)].nodeIds).toEqual(['node-a', 'node-b'])
  })

  it('records nothing when the node is unreachable or has no such bundle', async () => {
    const store = cache()
    served = new Error('ECONNREFUSED')
    expect(await store.putFromNode('node-a', 'sparkline', claim())).toEqual({ error: 'unreachable' })
    served = { status: 404, body: '' }
    expect(await store.putFromNode('node-a', 'sparkline', claim())).toEqual({ error: 'not-found' })
    expect(store.list()).toEqual({})
  })
})

describe('installing a device bundle', () => {
  const packageFolder = () => {
    const folder = join(dir, 'package')
    mkdirSync(folder)
    writeFileSync(join(folder, 'client.js'), BUNDLE)
    writeFileSync(join(folder, 'acorn-plugin.json'), JSON.stringify({
      id: 'sparkline', name: 'Sparkline', version: '1.2.0', baseline: ACORN_BASELINE,
      apiVersion: PLUGIN_API_MAJOR, client: 'client.js',
    }))
    return folder
  }

  it('hashes a folder bundle and re-reads it on update', async () => {
    const folder = packageFolder()
    const store = cache()
    expect(await store.putFromSource({ path: folder })).toEqual({ hash: sha256(BUNDLE), pluginId: 'sparkline', version: '1.2.0' })
    expect(store.list()[sha256(BUNDLE)]).toMatchObject({ source: { kind: 'device' }, installSource: { path: folder } })
    writeFileSync(join(folder, 'client.js'), 'export default 2')
    const updated = await store.putFromSource({ path: folder })
    expect(updated).toMatchObject({ hash: sha256('export default 2') })
    expect(store.has(sha256(BUNDLE))).toBe(false)
    store.removeDevice('sparkline')
    expect(store.list()).toEqual({})
  })

  it('refuses a manifest with node execution before writing a bundle', async () => {
    const folder = packageFolder()
    const manifest = JSON.parse(readFileSync(join(folder, 'acorn-plugin.json'), 'utf8')) as Record<string, unknown>
    manifest.node = 'node.js'
    writeFileSync(join(folder, 'acorn-plugin.json'), JSON.stringify(manifest))
    writeFileSync(join(folder, 'node.js'), 'export default {}')
    const store = cache()
    expect(await store.putFromSource({ path: folder })).toEqual({ error: 'has-node-half' })
    expect(store.list()).toEqual({})
  })

  it('checks a config offer or update identity before changing the cache', async () => {
    const folder = packageFolder()
    const store = cache()
    expect(await store.putFromSource({ path: folder }, 'sparkline')).toMatchObject({ pluginId: 'sparkline' })
    const before = store.list()
    const manifest = JSON.parse(readFileSync(join(folder, 'acorn-plugin.json'), 'utf8')) as Record<string, unknown>
    manifest.id = 'different-plugin'
    writeFileSync(join(folder, 'acorn-plugin.json'), JSON.stringify(manifest))
    writeFileSync(join(folder, 'client.js'), 'export default "different-plugin"')

    expect(await store.putFromSource({ path: folder }, 'sparkline')).toEqual({ error: 'plugin-id-mismatch' })
    expect(store.list()).toEqual(before)
    expect(store.has(sha256('export default "different-plugin"'))).toBe(false)
  })

  it('accepts a remote-tree source and refuses a source that needs a Node route', async () => {
    const folder = packageFolder()
    const file = join(folder, 'acorn-plugin.json')
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    manifest.contributions = { sources: [{ id: 'sparkline', label: 'Sparkline', order: 50, tree: { list: 'list', detail: 'detail' } }] }
    writeFileSync(file, JSON.stringify(manifest))
    const store = cache()
    expect(await store.putFromSource({ path: folder })).toMatchObject({ pluginId: 'sparkline' })
    manifest.contributions = { sources: [{ id: 'sparkline', label: 'Sparkline', order: 50, items: '/v1/p/sparkline/items' }] }
    writeFileSync(file, JSON.stringify(manifest))
    expect(await store.putFromSource({ path: folder })).toEqual({ error: 'has-node-half' })
  })

  it('reports a manifest parse failure to the install caller', async () => {
    const folder = packageFolder()
    writeFileSync(join(folder, 'acorn-plugin.json'), '{ broken json')
    await expect(cache().putFromSource({ path: folder })).rejects.toThrow()
  })

  it('refuses a client bundle over the size limit', async () => {
    const folder = packageFolder()
    writeFileSync(join(folder, 'client.js'), Buffer.alloc(MAX_BUNDLE_BYTES + 1))
    expect(await cache().putFromSource({ path: folder })).toEqual({ error: 'too-large' })
  })
})

// The invariant the whole phase rests on: the hash in a node's listing is a claim, and a compromised
// node can put anything there. Only bytes this process hashed itself may be stored or acknowledged.
describe('trust binds to bytes, not to the listing', () => {
  it('refuses bytes that do not match the hash the node advertised, and stores nothing', async () => {
    const store = cache()
    served = { status: 200, body: 'export default { evil: true }' }
    expect(await store.putFromNode('node-a', 'sparkline', claim())).toEqual({ error: 'hash-mismatch' })
    expect(store.has(sha256(BUNDLE))).toBe(false)
    expect(store.has(sha256('export default { evil: true }'))).toBe(false)
    // Not stored under the honest hash either: a mismatch is a refusal, not a re-key.
    expect(existsSync(cacheDir()) ? readdirSync(cacheDir()).filter((f) => f.endsWith('.js')) : []).toEqual([])
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('does not match the hash it advertised'))
  })

  it('refuses a claim that is not a sha256 at all, without asking the node for anything', async () => {
    expect(await cache().putFromNode('node-a', 'sparkline', { hash: '../../etc/passwd', version: '1.0.0' })).toEqual({ error: 'hash-mismatch' })
    expect(requests).toEqual([])
  })

  it('refuses a bundle over the size ceiling', async () => {
    const huge = new Uint8Array(MAX_BUNDLE_BYTES + 1)
    served = { status: 200, body: huge }
    expect(await cache().putFromNode('node-a', 'sparkline', claim(createHash('sha256').update(huge).digest('hex')))).toEqual({ error: 'too-large' })
  })

  it('reports a transport refusal as too large rather than unreachable', async () => {
    served = new NodeResponseTooLargeError(MAX_BUNDLE_BYTES)
    expect(await cache().putFromNode('node-a', 'sparkline', claim())).toEqual({ error: 'too-large' })
  })
})

describe('eviction', () => {
  it('drops an entry no node has offered in a month, and its file with it', async () => {
    const store = cache()
    await store.putFromNode('node-a', 'sparkline', claim())
    store.forgetNode('node-a')
    // Rewrite the index with an old lastSeen: the alternative is a test that waits a month.
    const path = join(cacheDir(), 'index.json')
    const index = JSON.parse(readFileSync(path, 'utf8')) as { version: 1; entries: Record<string, { lastSeen: number }> }
    index.entries[sha256(BUNDLE)].lastSeen = Date.now() - 40 * 24 * 60 * 60 * 1000
    writeFileSync(path, JSON.stringify(index))

    const swept = cache()
    swept.sweep()
    expect(swept.has(sha256(BUNDLE))).toBe(false)
    expect(existsSync(join(cacheDir(), `${sha256(BUNDLE)}.js`))).toBe(false)
  })

  it('keeps an old entry a node still offers', async () => {
    const store = cache()
    await store.putFromNode('node-a', 'sparkline', claim())
    const path = join(cacheDir(), 'index.json')
    const index = JSON.parse(readFileSync(path, 'utf8')) as { version: 1; entries: Record<string, { lastSeen: number }> }
    index.entries[sha256(BUNDLE)].lastSeen = Date.now() - 40 * 24 * 60 * 60 * 1000
    writeFileSync(path, JSON.stringify(index))

    const swept = cache()
    swept.sweep()
    // A plugin installed and untouched for a year is not stale, it is settled.
    expect(swept.has(sha256(BUNDLE))).toBe(true)
  })

  it('deletes a stray file the index does not know about', () => {
    // The crash-mid-write case: bytes on disk with no row promising what they are.
    mkdirSync(cacheDir(), { recursive: true })
    writeFileSync(join(cacheDir(), `${'b'.repeat(64)}.js`), 'orphan')
    cache().sweep()
    expect(existsSync(join(cacheDir(), `${'b'.repeat(64)}.js`))).toBe(false)
  })
})

// Five bundled plugins used to mean five bundle writes and five fsynced index rewrites per launch, for
// bytes that last changed at an app update. See docs/security.md § Third-party plugin bundles.
describe('caching the application own bundles', () => {
  // Nanoseconds, not milliseconds: two writes inside one millisecond would compare equal and the test
  // would pass for the wrong reason.
  const mtime = (path: string): bigint => statSync(path, { bigint: true }).mtimeNs

  it('writes once, and touches neither the bundle nor the index the second time', () => {
    const store = cache()
    const bytes = new TextEncoder().encode(BUNDLE)
    const hash = store.putBundled('sparkline', '1.2.0', bytes)
    const bundlePath = join(cacheDir(), `${hash}.js`)
    const indexPath = join(cacheDir(), 'index.json')
    const before = { bundle: mtime(bundlePath), index: mtime(indexPath) }

    // A fresh store, because a launch is a fresh process: the early return has to come off the index on
    // disk rather than off an in-memory flag.
    expect(cache().putBundled('sparkline', '1.2.0', bytes)).toBe(hash)
    expect(mtime(bundlePath)).toBe(before.bundle)
    expect(mtime(indexPath)).toBe(before.index)
  })

  it('writes the bundle again when the file is gone but the index still promises it', () => {
    const store = cache()
    const bytes = new TextEncoder().encode(BUNDLE)
    const hash = store.putBundled('sparkline', '1.2.0', bytes)
    // The crash-mid-write case in the direction `sweep` does not repair: a row with no file. Returning
    // early on the row alone would leave the plugin unloadable until the next app update.
    rmSync(join(cacheDir(), `${hash}.js`), { force: true })
    expect(cache().putBundled('sparkline', '1.2.0', bytes)).toBe(hash)
    expect(readFileSync(join(cacheDir(), `${hash}.js`), 'utf8')).toBe(BUNDLE)
  })

  it('leaves the index alone when a sweep evicts nothing', () => {
    const store = cache()
    store.putBundled('sparkline', '1.2.0', new TextEncoder().encode(BUNDLE))
    const indexPath = join(cacheDir(), 'index.json')
    const before = mtime(indexPath)
    cache().sweep()
    expect(mtime(indexPath)).toBe(before)
  })
})
