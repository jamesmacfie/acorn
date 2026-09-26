import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { writePrivateAtomic } from '@acorn/node-core/server/storage'
import { join } from 'node:path'
import { z } from 'zod'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import { corePluginBundleByHashRoute, corePluginBundleRoute } from '@acorn/protocol/api.ts'
import type { NodeFetchRequest, NodeFetchResponse } from '@acorn/protocol/broker.ts'
import { createLogger, describeError } from '@acorn/node-core/server/telemetry'
import { withPluginPackage } from '@acorn/node-core/server/plugins'
import { hasNodeHalf, bundleSourceSchema } from '@acorn/protocol/plugin/bundles.ts'
import type { PluginInstallSource } from '@acorn/protocol/api.ts'
import { describePluginSource } from '@acorn/protocol/plugin/source.ts'
import { resolveInRoot } from '@acorn/node-core/server/core/fs.ts'
import { installSchema } from './pluginRequests'

const log = createLogger('plugins')

// The content-addressed store of plugin client bundles a node handed over. See docs/security.md,
// "Third-party plugin bundles", for why the hash is trusted and the claim is not.
//
// Only main writes here and only main knows the paths. Nothing on this class hands a filesystem path
// to the renderer, which names bundles by hash and nothing else.
//
// See docs/future/remote.md: a browser client does the same job with IndexedDB. The renderer reaches
// this through one narrow module, client-core/host/plugins/host.ts, so the interface is the portable part
// rather than the storage.

const CACHE_DIR = `${ACORN_BASELINE}-plugin-cache`
const INDEX_FILE = 'index.json'
const HASH_RE = /^[0-9a-f]{64}$/

// Matches the node's own ceiling, node-core MAX_CLIENT_BUNDLE_BYTES. Enforced again here because the
// node that answers is not necessarily one this device trusts yet, and a response arrives fully
// buffered in main's heap.
export const MAX_BUNDLE_BYTES = 8 * 1024 * 1024

// How long an unreferenced bundle survives. Generous on purpose. The cache is a few hundred kilobytes
// per plugin, and evicting a bundle the owner already acknowledged means a re-prompt for nothing.
const EVICT_AFTER_MS = 30 * 24 * 60 * 60 * 1000

const entrySchema = z.strictObject({
  pluginId: z.string().min(1),
  version: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  // Every node that has offered this bundle. Two nodes carrying the same plugin version serve
  // byte-identical bundles, so they share one cache entry.
  nodeIds: z.array(z.string().min(1)),
  source: bundleSourceSchema.optional(),
  installSource: installSchema.shape.source.optional(),
  sourceLabel: z.string().optional(),
  manifest: z.unknown().optional(),
  firstSeen: z.number().int(),
  lastSeen: z.number().int(),
})
export type PluginCacheEntry = z.infer<typeof entrySchema>

const indexSchema = z.strictObject({ version: z.literal(1), entries: z.record(z.string(), entrySchema) })

export type PutFailure = 'unreachable' | 'not-found' | 'too-large' | 'hash-mismatch' | 'has-node-half' | 'invalid-manifest' | 'plugin-id-mismatch'
export type PutResult = { hash: string } | { error: PutFailure }

// Just enough of NodeBroker to fetch. Narrow so the tests can exercise the hashing rules without a
// TLS server.
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

  /** Cache client code read from this app's packaged resources. Unlike putFromNode there is no remote
   * hash claim to verify, so the content hash computed here is the identity main trusts. */
  putBundled(pluginId: string, version: string, bytes: Uint8Array): string {
    if (bytes.byteLength > MAX_BUNDLE_BYTES) throw new Error(`Bundled plugin '${pluginId}' exceeds the client bundle limit.`)
    const hash = createHash('sha256').update(bytes).digest('hex')
    // Nothing to do when these exact bytes are already here, which is every launch between app
    // updates. Writing anyway cost a bundle write plus an fsynced index rewrite per bundled plugin,
    // in front of the window (docs/security.md § Third-party plugin bundles).
    //
    // The file is checked as well as the index row, because the two can disagree after a crash
    // mid-write and `sweep` only repairs the other direction. A stat is not a write.
    if (this.has(hash) && existsSync(join(this.dir, `${hash}.js`))) return hash
    this.writeBundle(hash, bytes)
    const now = Date.now()
    const existing = this.entries()[hash]
    this.writeIndex({
      ...this.entries(),
      [hash]: {
        pluginId,
        version,
        bytes: bytes.byteLength,
        nodeIds: existing?.nodeIds ?? [],
        firstSeen: existing?.firstSeen ?? now,
        lastSeen: now,
      },
    })
    return hash
  }

  // Main-only. The `app-plugin://` handler is the caller, and this never reaches the renderer.
  path(hash: string): string | null {
    return this.has(hash) ? join(this.dir, `${hash}.js`) : null
  }

  // Pull a plugin's client bundle from a node and store it under the hash of the bytes that arrived.
  // `claim` is what the node's listing said. It is a fast "do we already have this?" check and an
  // integrity assertion, never the storage key. See docs/security.md, "Third-party plugin bundles".
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
        path: corePluginBundleByHashRoute(pluginId, claim.hash),
        method: 'GET',
        headers: {},
      })
      if (response.status === 404) {
        // A node from before the hash-addressed route only has /client.js. The device still hashes
        // what arrives and refuses anything other than this exact claim below.
        response = await this.broker.fetch(nodeId, {
          requestId: `plugin-bundle-legacy-${pluginId}-${claim.hash.slice(0, 12)}`,
          path: corePluginBundleRoute(pluginId),
          method: 'GET',
          headers: {},
        })
      }
    } catch (error) {
      log.warn(`could not fetch ${pluginId} from ${nodeId}: ${describeError(error).message}`, { 'plugin.id': pluginId, 'node.id': nodeId })
      return { error: 'unreachable' }
    }
    if (response.status !== 200) return { error: response.status === 404 ? 'not-found' : 'unreachable' }
    if (response.body.byteLength > MAX_BUNDLE_BYTES) return { error: 'too-large' }

    const hash = createHash('sha256').update(response.body).digest('hex')
    if (hash !== claim.hash) {
      // Loud, and refused. The one failure in this file that is a security event rather than an
      // operational one, and the owner sees it as a blocked row rather than a silent absence.
      log.error(`${pluginId} from ${nodeId} does not match the hash it advertised; refusing the bundle`, { 'plugin.id': pluginId, 'node.id': nodeId })
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
        source: existing?.source ?? { kind: 'node', nodeId },
        ...(existing?.installSource ? { installSource: existing.installSource } : {}),
        ...(existing?.sourceLabel ? { sourceLabel: existing.sourceLabel } : {}),
        ...(existing?.manifest ? { manifest: existing.manifest } : {}),
        firstSeen: existing?.firstSeen ?? now,
        lastSeen: now,
      },
    })
    return { hash }
  }

  /** Validate the package before any entry is added. A folder is re-read for every update. */
  async putFromSource(source: PluginInstallSource, expectedPluginId?: string): Promise<{ hash: string; pluginId: string; version: string } | { error: PutFailure }> {
    try {
      return await withPluginPackage(this.userDataDir, source, (root, manifest) => {
        const rawManifest: unknown = JSON.parse(readFileSync(join(root, 'acorn-plugin.json'), 'utf8'))
        if (expectedPluginId && manifest.id !== expectedPluginId) return { error: 'plugin-id-mismatch' as const }
        if (hasNodeHalf(rawManifest)) return { error: 'has-node-half' as const }
        if (!manifest.client) return { error: 'invalid-manifest' as const }
        const path = resolveInRoot(root, manifest.client)
        if (!path) return { error: 'invalid-manifest' as const }
        if (statSync(path).size > MAX_BUNDLE_BYTES) return { error: 'too-large' as const }
        const bytes = readFileSync(path)
        const hash = createHash('sha256').update(bytes).digest('hex')
        this.writeBundle(hash, bytes)
        const now = Date.now()
        const existing = this.entries()[hash]
        this.writeIndex({ ...this.entries(), [hash]: {
          pluginId: manifest.id,
          version: manifest.version,
          bytes: bytes.byteLength,
          nodeIds: existing?.nodeIds ?? [],
          source: { kind: 'device' },
          installSource: source,
          sourceLabel: describePluginSource(source),
          manifest: rawManifest,
          firstSeen: existing?.firstSeen ?? now,
          lastSeen: now,
        } })
        this.removeDevice(manifest.id, hash)
        return { hash, pluginId: manifest.id, version: manifest.version }
      })
    } catch (error) {
      log.warn(`device plugin install failed: ${describeError(error).message}`)
      throw error
    }
  }

  removeDevice(pluginId: string, keepHash?: string): void {
    const entries = { ...this.entries() }
    for (const [hash, entry] of Object.entries(entries)) {
      if (hash === keepHash || entry.pluginId !== pluginId || entry.source?.kind !== 'device') continue
      if (entry.nodeIds.length) {
        const { installSource: _installSource, sourceLabel: _sourceLabel, manifest: _manifest, ...rest } = entry
        entries[hash] = { ...rest, source: { kind: 'node', nodeId: entry.nodeIds[0]! } }
      } else {
        delete entries[hash]
        rmSync(join(this.dir, `${hash}.js`), { force: true })
      }
    }
    this.writeIndex(entries)
  }

  // A node still offers this bundle. Keeps the eviction clock honest for a plugin installed and
  // untouched for a year.
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
  // directions after a crash mid-write. Drop bundles nothing indexes, and drop index rows for bundles
  // no known node has offered in a long time.
  sweep(): void {
    const entries = { ...this.entries() }
    const cutoff = Date.now() - EVICT_AFTER_MS
    let dropped = 0
    for (const [hash, entry] of Object.entries(entries)) {
      if (entry.source?.kind === 'device' || entry.nodeIds.length > 0 || entry.lastSeen >= cutoff) continue
      delete entries[hash]
      dropped++
    }
    // Only when the sweep actually dropped something. The steady state is a launch that evicts
    // nothing, and rewriting an unchanged index there is an fsync in front of the window for bytes
    // that did not change.
    if (dropped) this.writeIndex(entries)

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
      // Same stance as fleet.json. An unparseable index is not one to guess at: starting empty costs
      // a re-download and a re-prompt, both safe, where half-reading it would not be.
      if (!parsed.success) log.warn('the bundle cache index is unreadable; starting from an empty cache')
      this.#entries = parsed.success ? parsed.data.entries : {}
    } catch {
      this.#entries = {} // first launch
    }
    return this.#entries
  }

  // Write to a temp file and rename, so a crash mid-write cannot leave a truncated file under a hash
  // that promises its contents. The temp name carries the hash for the same reason.
  //
  // Deliberately not node-core's `writePrivateAtomic`: that helper takes a string and fsyncs, and a
  // bundle is bytes named by their own sha256 that the helper re-downloads when it is missing. The
  // durability the fsync buys would be paid on every plugin update to protect a cache entry. The
  // index and the trust store next door do call the helper, because losing those costs more than a
  // download.
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
    writePrivateAtomic(path, `${JSON.stringify({ version: 1, entries } satisfies z.input<typeof indexSchema>, null, 2)}\n`)
  }
}
