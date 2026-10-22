import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createLogger, describeError } from '@acorn/node-core/server/telemetry'
import {
  readPluginFile,
  MAX_PLUGIN_MANIFEST_BYTES,
  PluginPackageFileError,
} from '@acorn/node-core/server/plugins/packageFiles.ts'
import { hasNodeHalf } from '@acorn/protocol/plugin/bundles.ts'
import type { PluginInstallSource } from '@acorn/protocol/api.ts'
import { describePluginSource } from '@acorn/protocol/plugin/source.ts'
import { runsIn, type PluginClient } from '@acorn/protocol/plugin/clients.ts'
import { BundleCache, entrySchema, MAX_BUNDLE_BYTES, type BundleFetcher, type PutFailure } from '../rules/bundleCache'
import { FileBundleStorage } from './fileStorage'

export { MAX_BUNDLE_BYTES }
export type { BundleFetcher, PutFailure } from '../rules/bundleCache'

const log = createLogger('plugins')

type BundledClientBundle = { pluginId: string; version: string; read: () => Uint8Array }
type BundledPutResult = { pluginId: string; hash: string } | { pluginId: string; error: unknown }

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

// The desktop's and the terminal client's cache of plugin client bundles. The decisions about what a
// node hands over are `BundleCache`'s (../rules/bundleCache.ts), shared with the phone. This class keeps
// the bundles as files and does what only a computer does: install a plugin from a folder or a package,
// and cache the bundles this app ships with.
//
// Only the helper writes here and only the helper knows the paths. Nothing on this class hands a filesystem path
// to the renderer, which names bundles by hash and nothing else.
export class PluginCache extends BundleCache {
  private readonly files: FileBundleStorage

  constructor(
    private readonly userDataDir: string,
    broker: BundleFetcher,
  ) {
    const files = new FileBundleStorage(userDataDir)
    super(files, broker, sha256, log)
    this.files = files
  }

  /** Cache client code read from this app's packaged resources. Unlike putFromNode there is no remote
   * hash claim to verify, so the content hash computed here is the identity the helper trusts. */
  putBundled(pluginId: string, version: string, bytes: Uint8Array): string {
    const result = this.putBundledBatch([{ pluginId, version, read: () => bytes }])[0]!
    if ('error' in result) throw result.error
    return result.hash
  }

  /** Cache application resources individually, then commit their successful index rows together.
   * Suppliers keep only one bundle body in memory. A failed index commit publishes no new rows. */
  putBundledBatch(bundles: Iterable<BundledClientBundle>): BundledPutResult[] {
    const entries = { ...this.entries() }
    const results: BundledPutResult[] = []
    let changed = false
    for (const bundle of bundles) {
      const { pluginId, version } = bundle
      try {
        const bytes = bundle.read()
        if (bytes.byteLength > MAX_BUNDLE_BYTES)
          throw new Error(`Bundled plugin '${pluginId}' exceeds the client bundle limit.`)
        const hash = sha256(bytes)
        const existing = entries[hash]
        // Check the file as well as its row: a missing body must be repaired after a crash.
        if (!existing || !existsSync(this.files.bundlePath(hash))) {
          const now = Date.now()
          const entry = entrySchema.parse({
            pluginId,
            version,
            bytes: bytes.byteLength,
            nodeIds: existing?.nodeIds ?? [],
            firstSeen: existing?.firstSeen ?? now,
            lastSeen: now,
          })
          this.files.writeBundle(hash, bytes)
          entries[hash] = entry
          changed = true
        }
        results.push({ pluginId, hash })
      } catch (error) {
        results.push({ pluginId, error })
      }
    }
    if (changed) this.writeIndex(entries)
    return results
  }

  // Helper-only. The `app-plugin://` handler is the caller, and this never reaches the renderer.
  path(hash: string): string | null {
    return this.has(hash) ? this.files.bundlePath(hash) : null
  }

  /** Validate the package before any entry is added. A folder is re-read for every update. */
  async putFromSource(
    source: PluginInstallSource,
    app: PluginClient,
    expectedPluginId?: string,
  ): Promise<{ hash: string; pluginId: string; version: string } | { error: PutFailure }> {
    try {
      const { withPluginPackage } = await import('@acorn/node-core/server/plugins/installer.ts')
      return await withPluginPackage(this.userDataDir, source, (root, manifest) => {
        const rawManifest: unknown = JSON.parse(
          readPluginFile(root, 'acorn-plugin.json', MAX_PLUGIN_MANIFEST_BYTES).toString('utf8'),
        )
        if (expectedPluginId && manifest.id !== expectedPluginId) return { error: 'plugin-id-mismatch' as const }
        if (hasNodeHalf(rawManifest)) return { error: 'has-node-half' as const }
        // Refused before anything is written, so an update for another app leaves the installed version.
        if (!runsIn(manifest, app)) return { error: 'other-app' as const }
        if (!manifest.client) return { error: 'invalid-manifest' as const }
        const bytes = readPluginFile(root, manifest.client, MAX_BUNDLE_BYTES)
        const hash = sha256(bytes)
        this.files.writeBundle(hash, bytes)
        const now = Date.now()
        const existing = this.entries()[hash]
        this.writeIndex({
          ...this.entries(),
          [hash]: {
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
          },
        })
        this.removeDevice(manifest.id, hash)
        return { hash, pluginId: manifest.id, version: manifest.version }
      })
    } catch (error) {
      if (error instanceof PluginPackageFileError && error.kind === 'too-large') return { error: 'too-large' }
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
        this.files.removeBundle(hash)
      }
    }
    this.writeIndex(entries)
  }
}
