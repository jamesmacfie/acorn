import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { corePluginBundleRoute } from '@acorn/protocol/api.ts'
import type { NodeFetchRequest, NodeFetchResponse } from '@acorn/protocol/broker.ts'

// The content-addressed store of plugin client bundles a node handed us
// (docs/third-party/phase-2-distribution-trust.md § Electron main side).
//
// Two properties carry the whole design, and both come from the file name being the hash of the
// contents:
//
//   1. TRUST BINDS TO BYTES. The hash a node advertises in its plugin listing is untrusted input — a
//      compromised node can put anything there. So this module hashes what it actually received,
//      stores under THAT, and treats the advertised hash as a claim to be cross-checked. The device's
//      trust acknowledgement (pluginTrustStore.ts) is then bound to a hash nobody but this process
//      computed.
//   2. A poisoned entry cannot masquerade as an accepted one. Overwriting `<hash>.js` with different
//      bytes is not possible without breaking the name.
//
// Only main writes here, and only main knows the paths: nothing on this class hands a filesystem path
// across contextBridge. The renderer names bundles by hash and nothing else.
//
// Future-web note (docs/future/remote.md): this is the Electron-main implementation of what a browser
// client does with IndexedDB. The renderer reaches it through one narrow module
// (client-core/plugins/host.ts), so the interface is the portable part, not the storage.

const CACHE_DIR = 'plugin-cache'
const INDEX_FILE = 'index.json'
const HASH_RE = /^[0-9a-f]{64}$/

// Matches the node's own ceiling (node-core MAX_CLIENT_BUNDLE_BYTES). Enforced again here because the
// node that answers is not necessarily one this device trusts yet, and a response arrives fully
// buffered in main's heap.
export const MAX_BUNDLE_BYTES = 8 * 1024 * 1024

// How long an unreferenced bundle survives. Generous on purpose: the cache is a few hundred kilobytes
// per plugin, and evicting a bundle the owner already acknowledged means a re-prompt for nothing.
const EVICT_AFTER_MS = 30 * 24 * 60 * 60 * 1000

const entrySchema = z.strictObject({
  pluginId: z.string().min(1),
  version: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  // Every node this exact bundle has been offered by. A plural: two nodes carrying the same plugin
  // version serve byte-identical bundles and therefore share one cache entry.
  nodeIds: z.array(z.string().min(1)),
  firstSeen: z.number().int(),
  lastSeen: z.number().int(),
})
export type PluginCacheEntry = z.infer<typeof entrySchema>

const indexSchema = z.strictObject({ version: z.literal(1), entries: z.record(z.string(), entrySchema) })

export type PutFailure = 'unreachable' | 'not-found' | 'too-large' | 'hash-mismatch'
export type PutResult = { hash: string } | { error: PutFailure }

// Just enough of NodeBroker to fetch. Narrow so the tests do not need a TLS server to exercise the
// hashing rules, which are the part worth testing.
export type BundleFetcher = { fetch(nodeId: string, request: NodeFetchRequest): Promise<NodeFetchResponse> }

export class PluginCache {
  #entries: Record<string, PluginCacheEntry> | null = null

  constructor(
    private readonly userDataDir: string,
    private readonly broker: BundleFetcher,
  ) {}

  has(hash: string): boolean {
    return HASH_RE.test(hash) && hash in this.entries()
  }

  list(): Record<string, PluginCacheEntry> {
    return { ...this.entries() }
  }

  // Main-only. Phase 3's `app-plugin://` handler is the caller; this never crosses contextBridge.
  path(hash: string): string | null {
    return this.has(hash) ? join(this.dir, `${hash}.js`) : null
  }

  // Pull a plugin's client bundle from a node and store it under the hash of the bytes that arrived.
  //
  // `claim` is what the node's listing said. It is used as a fast "do we already have this?" check and
  // then as an integrity assertion — never as the storage key. A mismatch is reported rather than
  // stored: bytes that do not match what the node itself advertised are either a corrupted transfer or
  // a node lying to one device about what it is serving to another.
  async putFromNode(nodeId: string, pluginId: string, claim: { hash: string; version: string }): Promise<PutResult> {
    if (!HASH_RE.test(claim.hash)) return { error: 'hash-mismatch' }
    if (this.has(claim.hash)) {
      this.noteSeen(nodeId, claim.hash)
      return { hash: claim.hash }
    }

    let response: NodeFetchResponse
    try {
      response = await this.broker.fetch(nodeId, {
        requestId: `plugin-bundle-${pluginId}-${claim.hash.slice(0, 12)}`,
        path: corePluginBundleRoute(pluginId),
        method: 'GET',
        headers: {},
      })
    } catch (error) {
      console.warn(`[plugins] could not fetch ${pluginId} from ${nodeId}:`, error)
      return { error: 'unreachable' }
    }
    if (response.status !== 200) return { error: response.status === 404 ? 'not-found' : 'unreachable' }
    if (response.body.byteLength > MAX_BUNDLE_BYTES) return { error: 'too-large' }

    const hash = createHash('sha256').update(response.body).digest('hex')
    if (hash !== claim.hash) {
      // Loud, and refused. This is the one failure in this file that is a security event rather than
      // an operational one, and the owner sees it as a blocked row rather than a silent absence.
      console.error(`[plugins] ${pluginId} from ${nodeId} does not match the hash it advertised; refusing the bundle`)
      return { error: 'hash-mismatch' }
    }

    this.writeBundle(hash, response.body)
    const now = Date.now()
    const existing = this.entries()[hash]
    this.writeIndex({
      ...this.entries(),
      [hash]: {
        pluginId,
        version: claim.version,
        bytes: response.body.byteLength,
        nodeIds: [...new Set([...(existing?.nodeIds ?? []), nodeId])],
        firstSeen: existing?.firstSeen ?? now,
        lastSeen: now,
      },
    })
    return { hash }
  }

  // A node still offers this bundle. Keeps the eviction clock honest for a plugin that has been
  // installed and untouched for a year.
  noteSeen(nodeId: string, hash: string): void {
    const entry = this.entries()[hash]
    if (!entry) return
    const nodeIds = [...new Set([...entry.nodeIds, nodeId])]
    if (entry.lastSeen > Date.now() - 60_000 && nodeIds.length === entry.nodeIds.length) return
    this.writeIndex({ ...this.entries(), [hash]: { ...entry, nodeIds, lastSeen: Date.now() } })
  }

  forgetNode(nodeId: string): void {
    const entries = Object.fromEntries(
      Object.entries(this.entries()).map(([hash, entry]) => [hash, { ...entry, nodeIds: entry.nodeIds.filter((id) => id !== nodeId) }]),
    )
    this.writeIndex(entries)
  }

  // Boot sweep. Two independent jobs, because the file set and the index can disagree in both
  // directions after a crash mid-write: drop bundles nothing indexes, and drop index rows for bundles
  // no known node has offered in a long time.
  sweep(): void {
    const entries = { ...this.entries() }
    const cutoff = Date.now() - EVICT_AFTER_MS
    for (const [hash, entry] of Object.entries(entries)) {
      if (entry.nodeIds.length > 0 || entry.lastSeen >= cutoff) continue
      delete entries[hash]
    }
    this.writeIndex(entries)

    let files: string[]
    try {
      files = readdirSync(this.dir)
    } catch {
      return // no cache directory yet
    }
    for (const file of files) {
      if (file === INDEX_FILE) continue
      const hash = file.replace(/\.js$/, '')
      if (HASH_RE.test(hash) && hash in entries) continue
      rmSync(join(this.dir, file), { force: true })
    }
  }

  private get dir(): string {
    return join(this.userDataDir, CACHE_DIR)
  }

  private entries(): Record<string, PluginCacheEntry> {
    if (this.#entries) return this.#entries
    try {
      const parsed = indexSchema.safeParse(JSON.parse(readFileSync(join(this.dir, INDEX_FILE), 'utf8')))
      // Same stance as fleet.json: an index we cannot parse is not one to guess at. Starting empty
      // costs a re-download and a re-prompt, both of which are safe; half-reading it would not be.
      if (!parsed.success) console.warn('[plugins] the bundle cache index is unreadable; starting from an empty cache')
      this.#entries = parsed.success ? parsed.data.entries : {}
    } catch {
      this.#entries = {} // first launch
    }
    return this.#entries
  }

  // Temp + rename so a crash mid-write cannot leave a truncated file sitting under a hash that
  // promises its contents. The temp name carries the hash for the same reason.
  private writeBundle(hash: string, bytes: Uint8Array): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    const target = join(this.dir, `${hash}.js`)
    const temp = `${target}.tmp`
    writeFileSync(temp, bytes, { mode: 0o600 })
    chmodSync(temp, 0o600)
    renameSync(temp, target)
  }

  private writeIndex(entries: Record<string, PluginCacheEntry>): void {
    this.#entries = entries
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    const path = join(this.dir, INDEX_FILE)
    writeFileSync(path, `${JSON.stringify({ version: 1, entries } satisfies z.input<typeof indexSchema>, null, 2)}\n`, { mode: 0o600 })
    chmodSync(path, 0o600)
  }
}
