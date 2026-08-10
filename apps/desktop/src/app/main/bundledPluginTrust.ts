import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pluginKeyClaimGrants, pluginWebviewGrants } from '@acorn/protocol/pluginGrants.ts'
import { resolveInRoot } from '@acorn/node-core/main/core/filesystem/confinement.ts'
import { readPluginManifest } from '@acorn/node-core/main/pluginManifest.ts'
import type { PluginCache } from './pluginCache'
import type { PluginTrustStore } from './pluginTrustStore'

const packageDirectories = (root: string): string[] => {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith('.') && entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

/** Trust only client bundles read from the installed application's own resource directory. The node
 * roster is deliberately not consulted: a remote node calling something "bundled" grants nothing. */
export function trustBundledClientPlugins(
  bundledRoot: string,
  appVersion: string,
  cache: PluginCache,
  trust: PluginTrustStore,
): string[] {
  const accepted: string[] = []
  for (const id of packageDirectories(bundledRoot)) {
    const dir = join(bundledRoot, id)
    const manifest = readPluginManifest(dir)
    if (!manifest || manifest.id !== id || !manifest.client) continue
    const client = resolveInRoot(dir, manifest.client)
    if (!client) continue
    try {
      const hash = cache.putBundled(id, manifest.version, readFileSync(client))
      trust.record({
        pluginId: id,
        hash,
        nodeId: `bundled:acorn-${appVersion}`,
        version: manifest.version,
        permissions: manifest.permissions,
        webviews: pluginWebviewGrants(manifest.contributions),
        keyClaims: pluginKeyClaimGrants(manifest.contributions),
        decision: 'accepted',
        decidedAt: Date.now(),
      })
      accepted.push(id)
    } catch (error) {
      console.error(`[plugins] bundled client for ${id} could not be trusted:`, error)
    }
  }
  return accepted
}
