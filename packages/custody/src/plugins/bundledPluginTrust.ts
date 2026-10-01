import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pluginAgentToolGrants, pluginContextSectionGrants, pluginExtensionGrants, pluginHarnessGrants, pluginKeyClaimGrants, pluginNavigationDestinationGrants, pluginScheduleGrants, pluginTaskCheckGrants, pluginWebviewGrants } from '@acorn/protocol/plugin/grants.ts'
import { resolveInRoot } from '@acorn/node-core/server/core/fs.ts'
import { readPluginManifest } from '@acorn/node-core/server/plugins'
import type { PluginCache } from './pluginCache'
import type { PluginAck, PluginTrustStore } from './pluginTrustStore'
import { createLogger, describeError } from '@acorn/node-core/server/telemetry'

const log = createLogger('plugins')

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

/** The environment-variable opt-out, for anyone testing the trust flow itself: a QA pass over the
 * dialog, or a spec that wants a bundled package to prompt like a third-party one. Honoured in
 * packaged builds too, because all it can do is ask more questions. */
export const BUNDLED_TRUST_OPT_OUT = 'ACORN_PROMPT_BUNDLED_PLUGIN_TRUST'

/** Whether to auto-accept the application's own bundled client bundles on this launch.
 *
 * Not `app.isPackaged`. This grant covers the bytes the build produced from the first-party roster,
 * `apps/desktop/scripts/build-bundled-plugins.mjs`, into this application's own resource directory:
 * bundle resources when packaged, `dist/bundled-plugins` in a development build, and in both cases a
 * directory the build owns and nothing else writes to. Gating on packaging made every dev boot answer
 * four dialogs about the developer's own build output, which taught people to click Trust without
 * reading.
 *
 * It says nothing about packages in the data root. A hand-installed or third-party package, and
 * anything a node serves this device, still prompts. */
export const trustsBundledClientPlugins = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env[BUNDLED_TRUST_OPT_OUT] !== '1'

/** Trust only client bundles read from the application's own resource directory. The node roster is
 * not consulted, because a remote node calling something "bundled" grants nothing. */
export function trustBundledClientPlugins(
  bundledRoot: string,
  appVersion: string,
  cache: PluginCache,
  trust: PluginTrustStore,
): string[] {
  const packages = new Map<string, { manifest: NonNullable<ReturnType<typeof readPluginManifest>>; client: string }>()
  for (const id of packageDirectories(bundledRoot)) {
    const dir = join(bundledRoot, id)
    const manifest = readPluginManifest(dir)
    if (!manifest || manifest.id !== id || !manifest.client) continue
    const client = resolveInRoot(dir, manifest.client)
    if (!client) continue
    packages.set(id, { manifest, client })
  }
  if (!packages.size) return []
  try {
    const cached = cache.putBundledBatch(Array.from(packages, ([pluginId, { manifest, client }]) => ({
      pluginId, version: manifest.version, read: () => readFileSync(client),
    })))
    const acks: PluginAck[] = []
    for (const result of cached) {
      const id = result.pluginId
      if ('error' in result) {
        log.error(`bundled client for ${id} could not be trusted: ${describeError(result.error).message}`, { 'plugin.id': id })
        continue
      }
      try {
        const { manifest } = packages.get(id)!
        acks.push({
          pluginId: id,
          hash: result.hash,
          nodeId: `bundled:acorn-${appVersion}`,
          version: manifest.version,
          permissions: manifest.permissions,
          webviews: pluginWebviewGrants(manifest.contributions),
          keyClaims: pluginKeyClaimGrants(manifest.contributions),
          navigationDestinations: pluginNavigationDestinationGrants(manifest.contributions),
          extensions: pluginExtensionGrants(id, manifest.contributions),
          schedules: pluginScheduleGrants(manifest.contributions),
          taskChecks: pluginTaskCheckGrants(manifest.contributions),
          harnesses: pluginHarnessGrants(manifest.contributions),
          agentTools: pluginAgentToolGrants(manifest.contributions),
          contextSections: pluginContextSectionGrants(manifest.contributions),
          decision: 'accepted',
          decidedAt: Date.now(),
        })
      } catch (error) {
        log.error(`bundled client for ${id} could not be trusted: ${describeError(error).message}`, { 'plugin.id': id })
      }
    }
    const accepted: string[] = []
    for (const result of trust.recordBatch(acks)) {
      if ('error' in result) {
        log.error(`bundled client for ${result.ack.pluginId} could not be trusted: ${describeError(result.error).message}`, { 'plugin.id': result.ack.pluginId })
      } else accepted.push(result.ack.pluginId)
    }
    return accepted
  } catch (error) {
    // Neither store publishes changed rows before its atomic commit succeeds. A pass with a failed
    // commit can retry on the next launch without acknowledging an uncommitted cache entry.
    log.error(`bundled client metadata could not be committed: ${describeError(error).message}`)
    return []
  }
}
