import { z } from 'zod'
import { corePluginBundleByHashRoute, corePluginBundleRoute } from '@acorn/protocol/api.ts'
import type { NodeFetchRequest, NodeFetchResponse } from '@acorn/protocol/broker.ts'
import { bundleSourceSchema } from '@acorn/protocol/plugin/bundles.ts'
import { installSchema } from './requests'
import { NodeResponseTooLargeError } from './responseTooLarge'
import type { BundleStorage, RulesLog, Sha256 } from './storage'

// The content-addressed store of plugin client bundles a node handed over. See
// docs/security/plugin-bundles.md, "Third-party plugin bundles", for why the hash is trusted and the
// claim is not.
//
// The rules live here and the storage doesn't, so a desktop, a terminal, and a phone's browser make the
// same decisions about the same bytes: hash what arrived, refuse a mismatch, and key the bundle by the
// hash it earned. Nothing here names a path, and the renderer names bundles by hash and nothing else.

const HASH_RE = /^[0-9a-f]{64}$/

// Matches the node's own ceiling, node-core MAX_CLIENT_BUNDLE_BYTES. Enforced again here because the
// node that answers is not necessarily one this device trusts yet. The same limit is passed to the
// broker transport, which rejects before retaining excess response bytes.
export const MAX_BUNDLE_BYTES = 8 * 1024 * 1024

// How long an unreferenced bundle survives. Generous on purpose. The cache is a few hundred kilobytes
// per plugin, and evicting a bundle the owner already acknowledged means a re-prompt for nothing.
const EVICT_AFTER_MS = 30 * 24 * 60 * 60 * 1000

export const entrySchema = z.strictObject({
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

export type PutFailure =
  | 'unreachable'
  | 'not-found'
  | 'too-large'
  | 'hash-mismatch'
  | 'has-node-half'
  | 'invalid-manifest'
  | 'plugin-id-mismatch'
  | 'other-app'
export type PutResult = { hash: string } | { error: PutFailure }

// Just enough of a node transport to fetch. Narrow so the tests can exercise the hashing rules without
// a TLS server.
export type BundleFetcher = {
  fetch(nodeId: string, request: NodeFetchRequest, limits?: { maxResponseBytes?: number }): Promise<NodeFetchResponse>
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export class BundleCache {
  #entries: Record<string, PluginCacheEntry> | null = null

  constructor(
    protected readonly storage: BundleStorage,
    private readonly fetcher: BundleFetcher,
    private readonly sha256: Sha256,
    protected readonly log: RulesLog,
  ) {}

  has(hash: string): boolean {
    return HASH_RE.test(hash) && hash in this.entries()
  }

  list(): Record<string, PluginCacheEntry> {
    return { ...this.entries() }
  }

  // Pull a plugin's client bundle from a node and store it under the hash of the bytes that arrived.
  // `claim` is what the node's listing said. It is a fast "do we already have this?" check and an
  // integrity assertion, never the storage key.
  async putFromNode(nodeId: string, pluginId: string, claim: { hash: string; version: string }): Promise<PutResult> {
    if (!HASH_RE.test(claim.hash)) return { error: 'hash-mismatch' }
    if (this.has(claim.hash)) {
      this.noteSeen(nodeId, claim.hash)
      return { hash: claim.hash }
    }

    let response: NodeFetchResponse
    try {
      response = await this.fetcher.fetch(
        nodeId,
        {
          requestId: `plugin-bundle-${pluginId}-${claim.hash.slice(0, 12)}`,
          path: corePluginBundleByHashRoute(pluginId, claim.hash),
          method: 'GET',
          headers: {},
        },
        { maxResponseBytes: MAX_BUNDLE_BYTES },
      )
      if (response.status === 404) {
        // A node from before the hash-addressed route only has /client.js. The device still hashes
        // what arrives and refuses anything other than this exact claim below.
        // Mixed-version path until 2026-12-26.
        response = await this.fetcher.fetch(
          nodeId,
          {
            requestId: `plugin-bundle-legacy-${pluginId}-${claim.hash.slice(0, 12)}`,
            path: corePluginBundleRoute(pluginId),
            method: 'GET',
            headers: {},
          },
          { maxResponseBytes: MAX_BUNDLE_BYTES },
        )
      }
    } catch (error) {
      if (error instanceof NodeResponseTooLargeError) return { error: 'too-large' }
      this.log.warn(`could not fetch ${pluginId} from ${nodeId}: ${errorMessage(error)}`, {
        'plugin.id': pluginId,
        'node.id': nodeId,
      })
      return { error: 'unreachable' }
    }
    if (response.status !== 200) return { error: response.status === 404 ? 'not-found' : 'unreachable' }
    if (response.body.byteLength > MAX_BUNDLE_BYTES) return { error: 'too-large' }

    const hash = await this.sha256(response.body)
    if (hash !== claim.hash) {
      // Loud, and refused. The one failure in this file that is a security event rather than an
      // operational one, and the owner sees it as a blocked row rather than a silent absence.
      this.log.error(`${pluginId} from ${nodeId} does not match the hash it advertised; refusing the bundle`, {
        'plugin.id': pluginId,
        'node.id': nodeId,
      })
      return { error: 'hash-mismatch' }
    }

    await this.storage.writeBundle(hash, response.body)
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
      Object.entries(this.entries()).map(([hash, entry]) => [
        hash,
        { ...entry, nodeIds: entry.nodeIds.filter((id) => id !== nodeId) },
      ]),
    )
    this.writeIndex(entries)
  }

  // Boot sweep. Two independent jobs, because the stored bundles and the index can disagree in both
  // directions after a crash mid-write. Drop index rows for bundles no known node has offered in a long
  // time, and drop bundles nothing indexes.
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
    this.storage.keepOnly(new Set(Object.keys(entries)))
  }

  protected entries(): Record<string, PluginCacheEntry> {
    if (this.#entries) return this.#entries
    const text = this.storage.readIndex()
    if (text === null) return (this.#entries = {}) // first launch
    let parsed: ReturnType<typeof indexSchema.safeParse>
    try {
      parsed = indexSchema.safeParse(JSON.parse(text))
    } catch {
      parsed = indexSchema.safeParse(null)
    }
    // Same stance as fleet.json. An unparseable index is not one to guess at: starting empty costs
    // a re-download and a re-prompt, both safe, where half-reading it would not be.
    if (!parsed.success) this.log.warn('the bundle cache index is unreadable; starting from an empty cache')
    return (this.#entries = parsed.success ? parsed.data.entries : {})
  }

  protected writeIndex(entries: Record<string, PluginCacheEntry>): void {
    this.storage.writeIndex(
      `${JSON.stringify({ version: 1, entries } satisfies z.input<typeof indexSchema>, null, 2)}\n`,
    )
    this.#entries = entries
  }
}
