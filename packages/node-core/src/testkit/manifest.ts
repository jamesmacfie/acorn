// Test-only helper. See testkit/db.ts for why this directory exists.
//
// Validate a plugin's `acorn-plugin.config.mjs` against the real manifest schema, at test time
// (docs/plugins.md § The dev loop). Before this, a malformed config surfaced only by running the
// builder, or worse, at the next boot, where the loader skips the package and says so in a console
// line a packaged app shows to nobody.
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PLUGIN_API_MAJOR, parsePluginManifest, type PluginManifestResult } from '../main/pluginManifest'

export const PLUGIN_CONFIG_FILE = 'acorn-plugin.config.mjs'

/** Run the manifest schema over a plugin's build config (docs/plugins.md § What is published, and
 * what acorn promises about it).
 *
 * Pass the path to the config file, or to the directory holding it. Never throws: a config that
 * cannot even be imported comes back as `{ ok: false }` with the import error in it, the same class
 * of problem as a field the schema rejects, reported the same way.
 *
 * This checks the half of the manifest the config owns: name, icons, permissions, and the whole
 * contributions block, where the rules and the mistakes both are. The other half is stamped by the
 * builder (`id` from the directory name, `version` from package.json, `apiVersion`, the bundle
 * paths) and mirrored below so the schema sees a complete manifest. That mirror is the one coupling
 * here: apps/node/scripts/build-plugin.mjs is the authority, and the two integration suites that run
 * the real builder, apps/node/test/integration/pluginLoader.test.ts and httpLoaded.test.ts, keep the
 * stamped half honest. */
export async function validatePluginConfig(configPath: string): Promise<PluginManifestResult> {
  const path = resolve(configPath)
  const file = basename(path) === PLUGIN_CONFIG_FILE ? path : join(path, PLUGIN_CONFIG_FILE)
  if (!existsSync(file)) return { ok: false, reason: `${file} does not exist` }

  let spec: Record<string, unknown>
  try {
    const mod = (await import(pathToFileURL(file).href)) as { default?: unknown }
    if (!mod.default || typeof mod.default !== 'object') {
      return { ok: false, reason: `${PLUGIN_CONFIG_FILE} must default-export the plugin declaration object` }
    }
    spec = mod.default as Record<string, unknown>
  } catch (error) {
    return { ok: false, reason: `${PLUGIN_CONFIG_FILE} could not be imported: ${error instanceof Error ? error.message : String(error)}` }
  }

  // The directory name is the plugin id (docs/plugins.md § Loaded plugins): it binds the route
  // namespace, the provider ids, and the task origins, which is why the config carries no second
  // copy to disagree with.
  const dir = dirname(file)
  const id = basename(dir)
  let version = '0.0.0'
  try {
    version = (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version?: string }).version ?? version
  } catch {
    // A plugin package with no readable package.json is a different failure, and the builder reports it.
    // Validating the contributions block is still worth doing.
  }
  const client = spec.client as { entry?: string } | undefined
  return parsePluginManifest({
    id,
    name: spec.name,
    ...(spec.icon ? { icon: spec.icon } : {}),
    ...(spec.icons ? { icons: spec.icons } : {}),
    version,
    apiVersion: PLUGIN_API_MAJOR,
    node: './dist/node.js',
    ...(client ? { client: './dist/client.js' } : {}),
    ...(spec.migrations ? { migrations: './migrations' } : {}),
    permissions: spec.permissions,
    contributions: spec.contributions,
  }, PLUGIN_CONFIG_FILE)
}
