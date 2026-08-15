import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pluginExtensionGrants, pluginKeyClaimGrants, pluginWebviewGrants } from '@acorn/protocol/pluginGrants.ts'
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

/** The env-var opt-out, for anyone whose subject IS the trust flow — a QA pass over the dialog, or a
 * spec that wants a bundled package to prompt like a third-party one. Honoured in packaged builds too,
 * because the only thing it can do is ask MORE questions. */
export const BUNDLED_TRUST_OPT_OUT = 'ACORN_PROMPT_BUNDLED_PLUGIN_TRUST'

/** Whether to auto-accept the application's own bundled client bundles on this launch.
 *
 * Deliberately not `app.isPackaged`. The bytes this grant covers are the ones the build produced from
 * the first-party roster (`apps/desktop/scripts/build-bundled-plugins.mjs`) into this application's own
 * resource directory — in a packaged build that is `resourcesPath`, in a development build it is
 * `out/bundled-plugins`, and in both cases it is a directory the build owns and nothing else writes to.
 * Gating on packaging meant every dev and e2e boot answered four dialogs about the developer's own build
 * output, which taught people to click Trust without reading — the opposite of what the prompt is for,
 * and it wedged a dozen e2e specs.
 *
 * This is parity, not a widening. It says nothing about packages in the data root: a hand-installed or
 * third-party package, and anything a node serves this device, still prompts. */
export const trustsBundledClientPlugins = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env[BUNDLED_TRUST_OPT_OUT] !== '1'

/** Trust only client bundles read from the application's own resource directory. The node roster is
 * deliberately not consulted: a remote node calling something "bundled" grants nothing. */
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
        extensions: pluginExtensionGrants(id, manifest.contributions),
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
