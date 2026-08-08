// Loading a plugin's node half from disk (docs/third-party/phase-1-node-loader.md § The loader).
//
// Everything here is best-effort by design: a bad manifest, an unimportable bundle or an id that
// collides with a built-in is a SKIP plus a report, never a throw. A node that cannot run one
// installed plugin must still boot — that is the whole difference between loaded plugins and
// built-ins, and the reason the plugin host grows a `contained` path in the same phase.
//
// The loader is inert unless ACORN_UNSAFE_PLUGINS=1. That flag is not a feature toggle: the trust
// acknowledgement UI does not exist until phases 2/5, and shipping a default-on loader before the
// consent surface exists would mean running third-party code the user never agreed to. Phase 5
// removes the flag, at the same time as it adds the prompt.
import { readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveInRoot } from './core/filesystem/confinement'
import { PLUGIN_API_MAJOR, readPluginManifest, type PluginManifest } from './pluginManifest'
import { PLUGIN_DB_DIR } from './pluginStorage'
import type { NodePlugin } from '../server/plugin/types'

export const UNSAFE_FLAG = 'ACORN_UNSAFE_PLUGINS'

export type LoadedPlugin = { manifest: PluginManifest; plugin: NodePlugin; dir: string; shadowsBuiltin: boolean }

// Why one directory did not produce a plugin. `id` is the directory name when the manifest could not
// be read at all — it is the only handle we have on the thing that failed.
export type PluginLoadFailure = { id: string; dir: string; reason: string }

export type PluginLoadResult = { loaded: LoadedPlugin[]; failures: PluginLoadFailure[] }

// Installed packages live beside the per-plugin SQLite files, under the same `<dataRoot>/plugins`.
// They cannot collide: the id pattern forbids a dot, so no directory can be named `<id>.sqlite`.
// Absolute, like pluginDbPath: resolveInRoot compares path prefixes, so a relative root would make
// every confinement check answer the wrong question.
export const pluginInstallDir = (dataRoot: string): string => join(resolve(dataRoot), PLUGIN_DB_DIR)

// Structural, not `instanceof`. The bundle was compiled separately, so its classes are its own even
// though it shares this realm; identity checks would reject a perfectly good plugin.
function asNodePlugin(mod: unknown): NodePlugin | null {
  const candidate = (mod as { default?: unknown } | null)?.default
  if (!candidate || typeof candidate !== 'object') return null
  const shape = candidate as Partial<NodePlugin>
  if (typeof shape.name !== 'string' || typeof shape.init !== 'function') return null
  if (shape.ready !== undefined && typeof shape.ready !== 'function') return null
  if (shape.dispose !== undefined && typeof shape.dispose !== 'function') return null
  return candidate as NodePlugin
}

function subdirectories(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return [] // no plugins directory yet, which is the normal case
  }
}

export async function loadExternalPlugins(
  dataRoot: string,
  options: { builtins: readonly string[] },
): Promise<PluginLoadResult> {
  const root = pluginInstallDir(dataRoot)
  const dirs = subdirectories(root)
  if (process.env[UNSAFE_FLAG] !== '1') {
    if (dirs.length) {
      console.warn(
        `[plugins] ${dirs.length} installed plugin(s) in ${root} were NOT loaded: set ${UNSAFE_FLAG}=1 to load them. ` +
        'Loading third-party node code is opt-in until the install-time trust prompt ships.',
      )
    }
    return { loaded: [], failures: [] }
  }

  const builtins = new Set(options.builtins)
  const loaded: LoadedPlugin[] = []
  const failures: PluginLoadFailure[] = []
  const seen = new Set<string>()

  for (const name of dirs.sort()) {
    const dir = join(root, name)
    const manifest = readPluginManifest(dir)
    if (!manifest) {
      failures.push({ id: name, dir, reason: 'acorn-plugin.json is missing, unreadable, or does not match the manifest schema' })
      continue
    }
    if (manifest.apiVersion !== PLUGIN_API_MAJOR) {
      failures.push({
        id: manifest.id,
        dir,
        reason: `built for acorn plugin API ${manifest.apiVersion}; this node speaks ${PLUGIN_API_MAJOR}`,
      })
      continue
    }
    if (seen.has(manifest.id)) {
      failures.push({ id: manifest.id, dir, reason: `another installed plugin already claims the id '${manifest.id}'` })
      continue
    }
    // A manifest may name any directory; the id is what binds the route namespace and the database
    // filename, so it has to be unique regardless of which folder it was found in.
    seen.add(manifest.id)
    // Client-only package. Nothing to load in the Node; phase 2 serves its bundle to devices.
    if (!manifest.node) continue

    // Lexical + symlink confinement, the same helper CoreServices uses for worktree paths: a bundle
    // must not be able to point the loader at a file outside its own directory.
    const entry = resolveInRoot(dir, manifest.node)
    if (!entry) {
      failures.push({ id: manifest.id, dir, reason: `node entrypoint '${manifest.node}' resolves outside the plugin directory` })
      continue
    }

    let mod: unknown
    try {
      // pathToFileURL, never the bare path: `import('C:\\...')` is not a valid specifier on Windows.
      mod = await import(pathToFileURL(entry).href)
    } catch (error) {
      failures.push({ id: manifest.id, dir, reason: `could not import ${manifest.node}: ${String(error)}` })
      continue
    }

    const plugin = asNodePlugin(mod)
    if (!plugin) {
      failures.push({ id: manifest.id, dir, reason: 'node entrypoint must default-export { name, init, ready?, dispose? } from an ESM bundle' })
      continue
    }
    // The host binds every namespace from the MANIFEST id. A mismatch means the package is
    // internally inconsistent, and picking a winner silently is how squatting starts.
    if (plugin.name !== manifest.id) {
      failures.push({ id: manifest.id, dir, reason: `bundle declares name '${plugin.name}' but the manifest id is '${manifest.id}'` })
      continue
    }

    // Shadowing a built-in is how phase 1 dogfoods the loader: run `scripts/build-plugin.mjs
    // rollbar`, boot with the flag, and the compiled-in Rollbar steps aside so the disk copy is the
    // one under test. It is reachable ONLY behind the flag, so an unflagged or packaged boot can
    // never have a built-in replaced by something on disk.
    const shadowsBuiltin = builtins.has(manifest.id)
    if (shadowsBuiltin) {
      console.warn(`[plugins] ${manifest.id}: loading from ${dir} INSTEAD of the built-in (${UNSAFE_FLAG} is set)`)
    }
    loaded.push({ manifest, plugin, dir, shadowsBuiltin })
  }

  for (const failure of failures) console.error(`[plugins] ${failure.id}: ${failure.reason}`)
  return { loaded, failures }
}
