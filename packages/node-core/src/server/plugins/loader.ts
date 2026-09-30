// Loading a plugin's node half from disk (docs/plugins.md § Loaded plugins).
//
// Everything here is best-effort: a bad manifest, an unimportable bundle or an id that collides with
// a built-in is a skip plus a report, never a throw (docs/plugins.md § Loaded plugins, "Failures are
// contained").
//
// The loader used to be inert unless ACORN_UNSAFE_PLUGINS=1, because there was no consent surface and
// a default-on loader would have run third-party code nobody agreed to. Phase 5 removed the flag: the
// only way a package reaches `<dataRoot>/plugins` now is through the installer, an
// owner-authenticated route, and the device asks again before it runs the client half.
import { createHash } from 'node:crypto'
import { readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { resolveInRoot } from '../core/fs'
import { describeSource, pluginInstallRoot, readLockfile, sweepDebris } from './installer'
import { contributesNodeData, PLUGIN_API_MAJOR, readPluginManifestResult, speaksApiVersion, type ManifestUnknown, type PluginManifest } from './manifest'
import { PluginMigrationsError, pluginMigrationsChain } from './migrations'
import { openPluginDb } from './storage'
import { readBundledPluginState } from './bundledState'
import { disposeUnstartedPlugin, isolateNodePlugin } from './isolation'
import { hasPendingPluginReview } from './pendingReview'
import type { NodePlugin, PluginStorage } from '../pluginHost/types'
import { createLogger } from '../telemetry/logger'
import type { PluginRuntimeIdentity } from '@acorn/protocol/api.ts'

import { MAX_CLIENT_BUNDLE_BYTES, MAX_PLUGIN_FILE_BYTES, readPluginFile, streamPluginFile, visitPluginFile } from './packageFiles'

const log = createLogger('plugins')

// A client bundle is one ESM file that has to travel a broker request and land in a device's cache
// (docs/plugins.md). The ceiling is here rather than only in the
// device's cache because a node should not read a gigabyte into memory to answer a GET, and it is
// generous enough that no honest bundle meets it.
export { MAX_CLIENT_BUNDLE_BYTES } from './packageFiles'

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
  // What the manifest declared that this build has no meaning for (./pluginManifest.ts § ManifestUnknown).
  // Retained and reported rather than dropped silently: it rides the roster row out to the device, which
  // raises one attention row per entry.
  unknown: ManifestUnknown
  // sha256 (lowercase hex) and byte length of the client entrypoint, read at boot. null when the
  // manifest declares none, or the file is missing or escapes the plugin directory.
  //
  // It can go stale, since nothing stops the file being edited under a running node, and that is
  // wanted: the device hashes the bytes it actually received, finds they do not match this claim, and
  // refuses them. Fail closed.
  client: { hash: string; bytes: number } | null
  // From the package's lockfile, absent when it has none (installed before phase 5, or copied in by
  // hand). Display only: the structured source stays in the lockfile, which is the one thing that has
  // to be able to re-resolve it.
  source?: string
  installedAt?: number
  // Seeded by the app build rather than installed over the route. No lockfile, so it cannot be updated.
  bundled?: true
}

// The `dir`-free projection the roster route takes. `dir` is an absolute path on the node's
// filesystem and must not be reachable from a route, so the narrowing happens here rather than being
// a discipline each composition root has to remember.
export type InstalledPluginInfo = {
  id: string
  // See InstalledPlugin above. Absent on the wire when there is nothing to report, so the common case
  // costs no bytes.
  unknown?: ManifestUnknown
  version: string
  apiVersion: string
  permissions: PluginManifest['permissions']
  emits: PluginManifest['emits']
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
  bundled?: true
}

// Why one directory did not produce a plugin (docs/plugins.md § Loaded plugins, "Failures are
// contained"). `id` is the directory name when the manifest could not be read at all, since it is the
// only handle we have on the thing that failed. `at` used to be missing, and every load failure
// rendered as a 56-year-old event that sorted last within its severity band; the roster needs it so
// the bell can say "20 minutes ago".
export type PluginLoadFailure = { id: string; dir: string; reason: string; at: number }

// The same record before it is stamped. One timestamp per pass, applied at the return: these walks
// are synchronous, so a clock read at each of the nine record sites would differ by microseconds and
// claim a precision the roster does not have.
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
export { pluginInstallRoot as pluginInstallDir } from './installer'

// Identity plus content, so a file that was replaced between two scans is re-read and one that was
// not is not. Phase 5 made `scanInstalled` a per-request call from the roster route, and sha256 over
// an 8 MiB bundle on every GET is a cost with no answer attached to it.
const digestCache = new Map<string, { key: string; value: { hash: string; bytes: number } }>()

// The client entrypoint's hash and size, or null. Every failure is null rather than a throw: a
// package whose client half is broken still has a node half worth running, and the device simply
// never sees a bundle to cache.
function clientDigest(dir: string, relPath: string | undefined): { hash: string; bytes: number } | null {
  if (!relPath) return null
  try {
    return visitPluginFile(dir, relPath, MAX_CLIENT_BUNDLE_BYTES, (fd, stats) => {
      const key = `${stats.mtimeMs}:${stats.ctimeMs}:${stats.size}:${stats.ino}:${stats.dev}`
      const cacheKey = `${dir}:${relPath}`
      const cached = digestCache.get(cacheKey)
      if (cached?.key === key) return cached.value
      const hash = createHash('sha256')
      const bytes = streamPluginFile(fd, stats.size, MAX_CLIENT_BUNDLE_BYTES, (chunk) => hash.update(chunk))
      const value = { hash: hash.digest('hex'), bytes }
      digestCache.set(cacheKey, { key, value })
      return value
    })
  } catch {
    return null
  }
}

export const installedPluginInfo = (entry: InstalledPlugin): InstalledPluginInfo => ({
  id: entry.manifest.id,
  version: entry.manifest.version,
  apiVersion: entry.manifest.apiVersion,
  permissions: entry.manifest.permissions,
  emits: entry.manifest.emits,
  contributions: entry.manifest.contributions,
  ...(entry.manifest.icon === undefined ? {} : { icon: entry.manifest.icon }),
  ...(entry.manifest.icons === undefined ? {} : { icons: entry.manifest.icons }),
  client: entry.client,
  hasNode: entry.manifest.node !== undefined,
  ...(entry.source === undefined ? {} : { source: entry.source }),
  ...(entry.installedAt === undefined ? {} : { installedAt: entry.installedAt }),
  ...(entry.bundled === undefined ? {} : { bundled: entry.bundled }),
  ...(entry.unknown.length ? { unknown: entry.unknown } : {}),
})

export type ActivePluginSnapshot = {
  id: string
  identity: PluginRuntimeIdentity
  bundle: { bytes: Uint8Array<ArrayBuffer>; hash: string } | null
}

/** Retain the manifest and the exact client bytes as one boot or reload candidate. The reported
 * digest is computed from these retained bytes, never from a later disk scan. */
export async function snapshotActivePlugin(entry: InstalledPlugin): Promise<ActivePluginSnapshot> {
  const { id, hasNode, source: _source, installedAt: _installedAt, bundled: _bundled, ...declaration } = installedPluginInfo(entry)
  const bundle = await readClientBundle([entry], id)
  return {
    id,
    identity: {
      ...declaration,
      client: bundle ? { hash: bundle.hash, bytes: bundle.bytes.byteLength } : null,
      activation: hasNode || contributesNodeData(declaration.contributions) ? 'node' : 'client-only',
    },
    bundle,
  }
}

// The bytes behind GET /v1/core/plugins/:id/client.js. Re-confines the path rather than trusting the
// one resolved at boot, and re-hashes rather than reporting the boot hash: the two disagree exactly
// when the file changed underneath us, and the honest answer is the hash of what is being sent.
export async function readClientBundle(
  installed: readonly InstalledPlugin[],
  id: string,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; hash: string } | null> {
  const entry = installed.find((candidate) => candidate.manifest.id === id)
  if (!entry?.manifest.client) return null
  try {
    const bytes = readPluginFile(entry.dir, entry.manifest.client, MAX_CLIENT_BUNDLE_BYTES)
    // Uint8Array.from rather than a view over the Buffer: Node's Buffers sit in a shared pool, and
    // the response body must not alias memory the next read can reuse.
    return { bytes: Uint8Array.from(bytes), hash: createHash('sha256').update(bytes).digest('hex') }
  } catch {
    return null
  }
}

// Directories, plus symlinks to directories: a `{ path }` dev install is a symlink, and Dirent's
// isDirectory() is lstat-shaped so it answers false for one. Dot-prefixed names are skipped, since the
// installer stages under `.staging-*` in this same directory and a plugin id can never start with a
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

/** Every package on disk whose manifest parses and whose apiVersion this node speaks, with nothing
 * imported and nothing executed.
 *
 * Split out of `loadExternalPlugins` because phase 5 gave the roster route a second question to
 * answer: the load result describes what this process assembled at boot, and after an install or an
 * uninstall that is no longer what is on disk. This is the "right now" answer, and comparing the two
 * is how the roster knows a restart is pending (server/routes/plugins/plugins.ts). */
export function scanInstalled(dataRoot: string): { installed: InstalledPlugin[]; failures: PluginLoadFailure[] } {
  const root = pluginInstallRoot(dataRoot)
  const installed: InstalledPlugin[] = []
  const failures: UnstampedFailure[] = []
  const seen = new Set<string>()

  for (const name of subdirectories(root).sort()) {
    const dir = join(root, name)
    // The reason carries the Zod issue paths (docs/plugins.md § Loaded plugins, "Failures are
    // contained").
    const read = readPluginManifestResult(dir)
    if (!read.ok) {
      failures.push({ id: name, dir, reason: read.reason })
      continue
    }
    const manifest = read.manifest
    if (!speaksApiVersion(manifest.apiVersion)) {
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
      unknown: read.unknown,
      client: clientDigest(dir, manifest.client),
      ...(lock
        ? { source: describeSource(lock.source), installedAt: lock.installedAt }
        : bundled?.status === 'installed'
          ? { source: 'bundled with acorn', installedAt: bundled.installedAt, bundled: true as const }
          : {}),
    })
  }
  return { installed, failures: stamped(failures) }
}

// ── Declared dependencies ─────────────────────────────────────────────────────────────────────────
//
// `requires.plugins` in the manifest (@acorn/protocol/plugin/contract.ts). Two things come out of it, and
// the first is the one worth having: a package that consumes another plugin's capability used to fail at
// whichever route reached for it first, with a message about a missing capability and nothing naming the
// package that was supposed to provide it.
//
// A requirement is met by anything present on this node under that id: a built-in, another loaded
// package, or a client-only one, because a client-only package still contributes its manifest. Disabled
// is not checked here. The loader does not know what the owner has switched off, and a plugin disabled
// after install should read as disabled rather than as a package that will not load.

const majorOf = (version: string): string => version.trim().split('.')[0] ?? ''

type UnmetRequirement = { id: string; dir: string; reason: string }

function resolveRequires(
  loaded: readonly LoadedPlugin[],
  installed: readonly InstalledPlugin[],
  builtins: ReadonlySet<string>,
): UnmetRequirement[] {
  const versions = new Map<string, string>()
  for (const entry of installed) versions.set(entry.manifest.id, entry.manifest.version)
  const unmet: UnmetRequirement[] = []
  for (const entry of installed) {
    // One reason per package. A manifest missing three dependencies is one broken package, and three
    // rows in Settings → Plugins would read as three.
    for (const dependency of entry.manifest.requires.plugins) {
      // A built-in ships with this binary, so its version is the app's and there is nothing to range
      // over. Present is the whole answer.
      if (builtins.has(dependency.id)) continue
      const version = versions.get(dependency.id)
      if (version === undefined) {
        unmet.push({ id: entry.manifest.id, dir: entry.dir, reason: `requires the plugin '${dependency.id}', which is not installed on this node` })
        break
      }
      if (dependency.version && !speaksApiVersion(dependency.version, majorOf(version))) {
        unmet.push({ id: entry.manifest.id, dir: entry.dir, reason: `requires '${dependency.id}' version ${dependency.version}; this node has ${version}` })
        break
      }
    }
  }
  return unmet
}

function dropPlugin(loaded: LoadedPlugin[], installed: InstalledPlugin[], id: string): void {
  const loadedAt = loaded.findIndex((entry) => entry.manifest.id === id)
  if (loadedAt >= 0) {
    disposeUnstartedPlugin(loaded[loadedAt].plugin)
    loaded.splice(loadedAt, 1)
  }
  const installedAt = installed.findIndex((entry) => entry.manifest.id === id)
  if (installedAt >= 0) installed.splice(installedAt, 1)
}

/** The second thing `requires` buys: a plugin initializes after the ones it named.
 *
 * Stable, so a package that declares nothing keeps the position the directory sort gave it, and the
 * built-ins the composition root puts in front of this list are untouched. A cycle is left in whatever
 * order it arrived: refusing to load either half would punish both for one author's mistake, and
 * `ready` is still there for the case init order cannot fix (server/pluginHost/host.ts). */
function orderByRequires(loaded: readonly LoadedPlugin[]): LoadedPlugin[] {
  const byId = new Map(loaded.map((entry) => [entry.manifest.id, entry]))
  const ordered: LoadedPlugin[] = []
  const placed = new Set<string>()
  const visiting = new Set<string>()
  const place = (entry: LoadedPlugin): void => {
    const id = entry.manifest.id
    if (placed.has(id) || visiting.has(id)) return
    visiting.add(id)
    for (const dependency of entry.manifest.requires.plugins) {
      const provider = byId.get(dependency.id)
      if (provider) place(provider)
    }
    visiting.delete(id)
    placed.add(id)
    ordered.push(entry)
  }
  for (const entry of loaded) place(entry)
  return ordered
}

// What one package on disk produced. A client-only package whose name collides with a built-in is
// both installed and a failure, so these are independent rather than a union.
type EntryOutcome = { loaded?: LoadedPlugin; installed?: InstalledPlugin; failure?: UnstampedFailure }

// Never rejects: every way a package can fail is a failure row, so one bad package cannot stop its
// siblings from loading.
async function loadEntry(entry: InstalledPlugin, dataRoot: string, builtins: ReadonlySet<string>): Promise<EntryOutcome> {
  const { manifest, dir } = entry
  // No node bundle. Its client bundle still has to reach every paired device, which is the whole
  // reason `installed` exists alongside `loaded`.
  if (!manifest.node) {
    // But it may still contribute to the node, as data. A managed agent harness and a custom agent are
    // the two kinds that need no route of their own and therefore no bundle at all
    // (docs/managed-agents.md § Harnesses), and the point of that tier is that adding an agent costs one
    // manifest.
    //
    // It goes through the host as a real plugin with an empty `init`, rather than being delivered
    // beside it, so it gets everything a plugin row gets: a line in Settings → Plugins, an owner who
    // can disable it, and registrations that roll back with the rest.
    if (!contributesNodeData(manifest.contributions)) return { installed: entry }
    // Shadowing is a node-half concept: there is nothing here to run in a built-in's place, and
    // letting the id through would delete that built-in from the graph and put nothing back.
    if (builtins.has(manifest.id)) {
      return {
        installed: entry,
        failure: { id: manifest.id, dir, reason: `'${manifest.id}' is a built-in plugin; a package with no node half cannot take its name` },
      }
    }
    return {
      installed: entry,
      loaded: {
        manifest,
        plugin: { name: manifest.id, init: () => {} },
        dir,
        shadowsBuiltin: false,
        migrationsFolder: null,
        storage: {
          open: () => {
            throw new PluginMigrationsError(`Plugin '${manifest.id}' opened storage but ships no node half.`)
          },
        },
      },
    }
  }

  let migrationsFolder: string | null = null
  if (manifest.migrations) {
    const declared = resolveInRoot(dir, manifest.migrations)
    if (!declared) {
      return { failure: { id: manifest.id, dir, reason: `migrations path '${manifest.migrations}' resolves outside the plugin directory` } }
    }
    try {
      migrationsFolder = pluginMigrationsChain(manifest.id, declared)
    } catch (error) {
      return { failure: { id: manifest.id, dir, reason: error instanceof Error ? error.message : String(error) } }
    }
  }

  // Lexical + symlink confinement, the same helper CoreServices uses for worktree paths: a bundle
  // must not be able to point the loader at a file outside its own directory.
  const entrypoint = resolveInRoot(dir, manifest.node)
  if (!entrypoint) {
    return { failure: { id: manifest.id, dir, reason: `node entrypoint '${manifest.node}' resolves outside the plugin directory` } }
  }

  let plugin: NodePlugin
  try {
    // Validate the opened entry before asking the module loader to read the path. Development
    // packages remain mutable; this is a bounded preflight, not an atomic module graph snapshot.
    visitPluginFile(dir, manifest.node, MAX_PLUGIN_FILE_BYTES, () => undefined)
    plugin = await isolateNodePlugin({
      entrypoint,
      pluginDir: dir,
      plugin: manifest.id,
      dataRoot,
      migrationsFolder,
      permissions: manifest.permissions.node,
    })
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? `${String((error as Error & { code?: unknown }).code)}: ` : ''
    const resource = error instanceof Error && 'resource' in error ? ` (${String((error as Error & { resource?: unknown }).resource)})` : ''
    return { failure: { id: manifest.id, dir, reason: `could not import isolated node entrypoint ${manifest.node}: ${code}${String(error)}${resource}` } }
  }

  const storage: PluginStorage = {
    open: () => {
      if (!migrationsFolder) {
        throw new PluginMigrationsError(`Plugin '${manifest.id}' opened storage but declares no migrations.`)
      }
      return openPluginDb(dataRoot, manifest.id, { migrationsFolder, loaded: true })
    },
  }
  // Installed only now. A package whose node half declared itself and then failed to import is
  // broken, not client-only, and distributing the UI of a plugin whose routes will never exist would
  // put a row on every paired device claiming a plugin that is not running anywhere.
  return {
    loaded: { manifest, plugin, dir, shadowsBuiltin: builtins.has(manifest.id), migrationsFolder, storage },
    installed: entry,
  }
}

export async function loadExternalPlugins(
  dataRoot: string,
  options: {
    builtins: readonly string[]
    /** Retained for callers from the pre-isolation loader. Every isolated realm has a fresh module
     * cache, so a load now re-evaluates the package's complete dependency graph. */
    reimport?: readonly string[]
  },
): Promise<PluginLoadResult> {
  // Boot is the one moment nothing is mid-install, so it is where an interrupted one gets cleaned up.
  sweepDebris(dataRoot)

  const builtins = new Set(options.builtins)
  const scan = scanInstalled(dataRoot)
  const loaded: LoadedPlugin[] = []
  const installed: InstalledPlugin[] = []
  const failures: UnstampedFailure[] = [...scan.failures]

  // Every package starts at once, and the results fold back in directory order. A worker's start
  // happens almost entirely off this thread: its bootstrap and the bundle's evaluation take about
  // 45 ms a package. Awaiting them one at a time would make boot wait for the sum.
  const outcomes = await Promise.all(scan.installed.map((entry) =>
    // This is shared by boot and live reload. Checking before loadEntry also blocks manifest-only
    // harness registration; merely setting `disabled` would still import the Node bundle above it.
    hasPendingPluginReview(dataRoot, basename(entry.dir)) || hasPendingPluginReview(dataRoot, entry.manifest.id)
      ? Promise.resolve({ installed: entry } as EntryOutcome)
      : loadEntry(entry, dataRoot, builtins)))
  for (const outcome of outcomes) {
    if (outcome.failure) failures.push(outcome.failure)
    if (outcome.loaded) {
      // Shadowing a built-in during a staged migration (docs/plugins.md § The dev loop). Loud rather
      // than silent, because "the version running is not the one in this binary" is the single most
      // confusing thing a support thread can fail to mention.
      if (outcome.loaded.shadowsBuiltin) log.warn(`${outcome.loaded.manifest.id}: loading from ${outcome.loaded.dir} INSTEAD of the built-in`)
      loaded.push(outcome.loaded)
    }
    if (outcome.installed) installed.push(outcome.installed)
  }

  // Dependencies, once every package on disk has been seen. It cannot happen inside the loop above: a
  // package is free to require one whose directory sorts after its own.
  //
  // To a fixpoint, because dropping a package can leave one that required it unmet. The list shrinks
  // every round, so it terminates in at most as many rounds as there are packages.
  for (;;) {
    const unmet = resolveRequires(loaded, installed, builtins)
    if (unmet.length === 0) break
    for (const entry of unmet) {
      failures.push({ id: entry.id, dir: entry.dir, reason: entry.reason })
      dropPlugin(loaded, installed, entry.id)
    }
  }

  for (const failure of failures) log.error(`${failure.id}: ${failure.reason}`)
  return { loaded: orderByRequires(loaded), installed, failures: stamped(failures) }
}
