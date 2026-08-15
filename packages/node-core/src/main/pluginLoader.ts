// Loading a plugin's node half from disk (docs/plugins.md).
//
// Everything here is best-effort by design: a bad manifest, an unimportable bundle or an id that
// collides with a built-in is a SKIP plus a report, never a throw. A node that cannot run one
// installed plugin must still boot — that is the whole difference between loaded plugins and
// built-ins, and the reason the plugin host grows a `contained` path in the same phase.
//
// The loader used to be inert unless ACORN_UNSAFE_PLUGINS=1, because there was no consent surface and
// a default-on loader would have run third-party code nobody agreed to. Phase 5 removed the flag: the
// only way a package reaches `<dataRoot>/plugins` now is through the installer, which is an
// owner-authenticated route, and the device asks again before it runs the client half
// (docs/plugins.md).
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { confineExistingFile, resolveInRoot } from './core/filesystem/confinement'
import { describeSource, pluginInstallRoot, readLockfile, sweepDebris } from './pluginInstaller'
import { PLUGIN_API_MAJOR, readPluginManifestResult, type PluginManifest } from './pluginManifest'
import { PluginMigrationsError, pluginMigrationsChain } from './pluginMigrations'
import { openPluginDb } from './pluginStorage'
import { readBundledPluginState } from './bundledPluginState'
import type { NodePlugin, PluginStorage } from '../server/plugin/types'

// A client bundle is one ESM file that has to travel a broker request and land in a device's cache
// (docs/plugins.md). The ceiling is here rather than only in the
// device's cache because a node should not read a gigabyte into memory to answer a GET, and it is
// generous enough that no honest bundle meets it.
export const MAX_CLIENT_BUNDLE_BYTES = 8 * 1024 * 1024

export type LoadedPlugin = {
  manifest: PluginManifest
  plugin: NodePlugin
  dir: string
  shadowsBuiltin: boolean
  migrationsFolder: string | null
  storage: PluginStorage
}

// Every package on disk whose manifest parsed, whether or not it has a node half to run. This is the
// list phase 2 distributes from: a client-only plugin has nothing to load in this process but its
// bundle still has to reach every paired device.
export type InstalledPlugin = {
  manifest: PluginManifest
  dir: string
  // sha256 (lowercase hex) and byte length of the client entrypoint, read at boot. null when the
  // manifest declares none, or the file is missing or escapes the plugin directory.
  //
  // It can go stale — nothing stops the file being edited under a running node — and that is the
  // wanted behaviour rather than a gap: the device hashes the bytes it actually received, finds they
  // do not match this claim, and refuses them. Fail closed.
  client: { hash: string; bytes: number } | null
  // From the package's lockfile, absent when it has none (installed before phase 5, or copied in by
  // hand). Display only — the structured source stays in the lockfile, which is the one thing that has
  // to be able to re-resolve it.
  source?: string
  installedAt?: number
}

// The `dir` -free projection the roster route takes. `dir` is an absolute path on the node's
// filesystem and must not be reachable from a route, so the narrowing happens here rather than
// being a discipline each composition root has to remember.
export type InstalledPluginInfo = {
  id: string
  version: string
  apiVersion: string
  permissions: PluginManifest['permissions']
  // What the manifest declared for the device to render (docs/plugins.md).
  // Passed through untouched: the node neither renders nor validates these beyond the schema, and the
  // device binds each one to this plugin's id.
  contributions: PluginManifest['contributions']
  // The package's brand marks, if it declared any. Same pass-through rule as `contributions`: the
  // node validated the `d` grammar in the manifest schema and does nothing else with them.
  icon?: PluginManifest['icon']
  icons?: PluginManifest['icons']
  client: { hash: string; bytes: number } | null
  // Whether the package declares a node half at all. The roster needs it to tell a client-only package
  // (nothing to start, so no restart is ever pending for it) from one that was installed and is waiting
  // for the node to come back up. Not the entrypoint itself: that is a path on the node's filesystem.
  hasNode: boolean
  source?: string
  installedAt?: number
}

// Why one directory did not produce a plugin. `id` is the directory name when the manifest could not
// be read at all — it is the only handle we have on the thing that failed.
// `at` is when this pass discovered the failure, and it exists so the bell can say "20 minutes ago".
// Without it the roster row had no timestamp, the attention item fell back to 0, and every load failure
// rendered as a 56-year-old event that also sorted last within its severity band.
export type PluginLoadFailure = { id: string; dir: string; reason: string; at: number }

// The same record before it is stamped. One timestamp per pass, applied at the return: these walks are
// synchronous, so a clock at each of the nine record sites would differ by microseconds and claim a
// precision the roster does not have.
type UnstampedFailure = Omit<PluginLoadFailure, 'at'>

const stamped = (failures: readonly UnstampedFailure[]): PluginLoadFailure[] => {
  const at = Date.now()
  return failures.map((failure) => ({ ...failure, at }))
}

export type PluginLoadResult = { loaded: LoadedPlugin[]; installed: InstalledPlugin[]; failures: PluginLoadFailure[] }

// Installed packages live beside the per-plugin SQLite files, under the same `<dataRoot>/plugins`.
// They cannot collide: the id pattern forbids a dot, so no directory can be named `<id>.sqlite`.
// Owned by the installer, which is the only thing that writes there; re-exported under the name the
// loader has always used.
export { pluginInstallRoot as pluginInstallDir } from './pluginInstaller'

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

// Identity plus content, so a file that was replaced between two scans is re-read and one that was not
// is not. Phase 5 made `scanInstalled` a per-request call from the roster route, and sha256 over an
// 8 MiB bundle on every GET is a cost with no answer attached to it.
const digestCache = new Map<string, { key: string; value: { hash: string; bytes: number } }>()

// The client entrypoint's hash and size, or null. Every failure is null rather than a throw: a
// package whose client half is broken still has a node half worth running, and the device simply
// never sees a bundle to cache.
function clientDigest(dir: string, relPath: string | undefined): { hash: string; bytes: number } | null {
  if (!relPath) return null
  const abs = resolveInRoot(dir, relPath)
  if (!abs) return null
  try {
    const stats = statSync(abs)
    const key = `${stats.mtimeMs}:${stats.size}:${stats.ino}`
    const cached = digestCache.get(abs)
    if (cached?.key === key) return cached.value
    const bytes = readFileSync(abs)
    if (bytes.byteLength > MAX_CLIENT_BUNDLE_BYTES) return null
    const value = { hash: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength }
    digestCache.set(abs, { key, value })
    return value
  } catch {
    return null
  }
}

export const installedPluginInfo = (entry: InstalledPlugin): InstalledPluginInfo => ({
  id: entry.manifest.id,
  version: entry.manifest.version,
  apiVersion: entry.manifest.apiVersion,
  permissions: entry.manifest.permissions,
  contributions: entry.manifest.contributions,
  ...(entry.manifest.icon === undefined ? {} : { icon: entry.manifest.icon }),
  ...(entry.manifest.icons === undefined ? {} : { icons: entry.manifest.icons }),
  client: entry.client,
  hasNode: entry.manifest.node !== undefined,
  ...(entry.source === undefined ? {} : { source: entry.source }),
  ...(entry.installedAt === undefined ? {} : { installedAt: entry.installedAt }),
})

// The bytes behind GET /v2/core/plugins/:id/client.js. Re-confines the path rather than trusting the
// one resolved at boot, and re-hashes rather than reporting the boot hash: the two disagree exactly
// when the file changed underneath us, and the honest answer is the hash of what is being sent.
export async function readClientBundle(
  installed: readonly InstalledPlugin[],
  id: string,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; hash: string } | null> {
  const entry = installed.find((candidate) => candidate.manifest.id === id)
  if (!entry?.manifest.client) return null
  const confined = await confineExistingFile(entry.dir, entry.manifest.client)
  if (!confined.ok) return null
  try {
    const bytes = await readFile(confined.path)
    if (bytes.byteLength > MAX_CLIENT_BUNDLE_BYTES) return null
    // Uint8Array.from rather than a view over the Buffer: Node's Buffers sit in a shared pool, and
    // the response body must not alias memory the next read can reuse.
    return { bytes: Uint8Array.from(bytes), hash: createHash('sha256').update(bytes).digest('hex') }
  } catch {
    return null
  }
}

// Directories, plus symlinks to directories — a `{ path }` dev install is a symlink, and Dirent's
// isDirectory() is lstat-shaped so it answers false for one. Dot-prefixed names are skipped: the
// installer stages under `.staging-*` in this same directory, and a plugin id can never start with a
// dot anyway.
function subdirectories(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith('.'))
      .filter((entry) => entry.isDirectory() || (entry.isSymbolicLink() && isDirectory(join(dir, entry.name))))
      .map((entry) => entry.name)
  } catch {
    return [] // no plugins directory yet, which is the normal case
  }
}

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Every package on disk whose manifest parses and whose apiVersion this node speaks — with nothing
 * imported and nothing executed.
 *
 * Split out of `loadExternalPlugins` because phase 5 gave the roster route a second question to answer:
 * the load result describes what this PROCESS assembled at boot, and after an install or an uninstall
 * that is no longer what is on disk. This is the "right now" answer, and comparing the two is how the
 * roster knows a restart is pending (server/routes/plugins.ts). */
export function scanInstalled(dataRoot: string): { installed: InstalledPlugin[]; failures: PluginLoadFailure[] } {
  const root = pluginInstallRoot(dataRoot)
  const installed: InstalledPlugin[] = []
  const failures: UnstampedFailure[] = []
  const seen = new Set<string>()

  for (const name of subdirectories(root).sort()) {
    const dir = join(root, name)
    // The reason carries the Zod issue paths, so "which of ~30 rules did I break" is answered on the
    // roster row rather than by reading the schema (docs/plugins.md § Failures are contained).
    const read = readPluginManifestResult(dir)
    if (!read.ok) {
      failures.push({ id: name, dir, reason: read.reason })
      continue
    }
    const manifest = read.manifest
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
    const lock = readLockfile(dataRoot, manifest.id)
    const bundled = readBundledPluginState(dataRoot, manifest.id)
    installed.push({
      manifest,
      dir,
      client: clientDigest(dir, manifest.client),
      ...(lock
        ? { source: describeSource(lock.source), installedAt: lock.installedAt }
        : bundled?.status === 'installed'
          ? { source: 'bundled with acorn', installedAt: bundled.installedAt }
          : {}),
    })
  }
  return { installed, failures: stamped(failures) }
}

// Bumped per re-import so two reloads inside one millisecond still get distinct URLs.
let importGeneration = 0

export async function loadExternalPlugins(
  dataRoot: string,
  options: {
    builtins: readonly string[]
    /** Plugin ids whose entry module must be EVALUATED AGAIN rather than served from Node's module
     * cache (main/pluginReload.ts). Empty at boot, one id on a reload.
     *
     * The technique is a generation stamp on the file URL, and its ceiling is exactly one module deep:
     * `import('…/index.js?load=7')` is a new key, but a relative specifier inside that module resolves
     * against the URL's PATH — the query is not inherited — so `./chunk.js` comes back from the cache
     * with the code it had at boot. A plugin whose edit lands in a non-entry file therefore needs a
     * restart. Single-file node halves (the authoring profile) are unaffected, and the honest fix for
     * the rest is a `module.register` resolve hook stamping the whole subgraph, which is a loader hook
     * this repo does not have and does not need yet. Stated in docs/plugins.md § The dev loop. */
    reimport?: readonly string[]
  },
): Promise<PluginLoadResult> {
  const reimport = new Set(options.reimport ?? [])
  // Boot is the one moment nothing is mid-install, so it is where an interrupted one gets cleaned up.
  sweepDebris(dataRoot)

  const builtins = new Set(options.builtins)
  const scan = scanInstalled(dataRoot)
  const loaded: LoadedPlugin[] = []
  const installed: InstalledPlugin[] = []
  const failures: UnstampedFailure[] = [...scan.failures]

  for (const entry of scan.installed) {
    const { manifest, dir } = entry
    // Client-only package. Nothing to load in the Node, but its bundle still has to reach every
    // paired device — which is the whole reason `installed` exists alongside `loaded`.
    if (!manifest.node) {
      installed.push(entry)
      continue
    }

    let migrationsFolder: string | null = null
    if (manifest.migrations) {
      const declared = resolveInRoot(dir, manifest.migrations)
      if (!declared) {
        failures.push({ id: manifest.id, dir, reason: `migrations path '${manifest.migrations}' resolves outside the plugin directory` })
        continue
      }
      try {
        migrationsFolder = pluginMigrationsChain(manifest.id, declared)
      } catch (error) {
        failures.push({ id: manifest.id, dir, reason: error instanceof Error ? error.message : String(error) })
        continue
      }
    }

    // Lexical + symlink confinement, the same helper CoreServices uses for worktree paths: a bundle
    // must not be able to point the loader at a file outside its own directory.
    const entrypoint = resolveInRoot(dir, manifest.node)
    if (!entrypoint) {
      failures.push({ id: manifest.id, dir, reason: `node entrypoint '${manifest.node}' resolves outside the plugin directory` })
      continue
    }

    let mod: unknown
    try {
      // pathToFileURL, never the bare path: `import('C:\\...')` is not a valid specifier on Windows.
      const url = pathToFileURL(entrypoint)
      // Node caches an ES module permanently by resolved URL, so a second import of the same path hands
      // back the FIRST load's module object. See the `reimport` option above for what this does and does
      // not invalidate.
      if (reimport.has(manifest.id)) url.searchParams.set('load', `${Date.now()}-${(importGeneration += 1)}`)
      mod = await import(url.href)
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

    // Shadowing a built-in is how the loader is dogfooded: `scripts/build-plugin.mjs rollbar` installs
    // the disk copy and the compiled-in one steps aside. Loud rather than silent, because "the version
    // running is not the one in this binary" is the single most confusing thing a support thread can
    // fail to mention.
    const shadowsBuiltin = builtins.has(manifest.id)
    if (shadowsBuiltin) {
      console.warn(`[plugins] ${manifest.id}: loading from ${dir} INSTEAD of the built-in`)
    }
    const storage: PluginStorage = {
      open: () => {
        if (!migrationsFolder) {
          throw new PluginMigrationsError(`Plugin '${manifest.id}' opened storage but declares no migrations.`)
        }
        return openPluginDb(dataRoot, manifest.id, { migrationsFolder })
      },
    }
    loaded.push({ manifest, plugin, dir, shadowsBuiltin, migrationsFolder, storage })
    // Only now. A package whose node half declared itself and then failed to import is broken, not
    // client-only, and distributing the UI of a plugin whose routes will never exist would put a row
    // on every paired device claiming a plugin that is not running anywhere.
    installed.push(entry)
  }

  for (const failure of failures) console.error(`[plugins] ${failure.id}: ${failure.reason}`)
  return { loaded, installed, failures: stamped(failures) }
}
