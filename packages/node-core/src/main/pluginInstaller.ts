// Putting a third-party plugin on this node, and taking it off again
// (docs/plugins.md).
//
// Install is PER NODE. A fleet is a set of independently administered nodes, so there is no
// cross-node transaction here and no attempt at one: this module answers "make this node carry this
// package", and every device that pairs with the node picks the bundle up through phase 2's
// distribution path afterwards.
//
// This is also the node's only outbound HTTP consumer (docs/http-client.md says there is deliberately
// no shared client). The fetch usage stays inside this file rather than becoming a general helper —
// same posture node-security.md asks of the future credential broker.
//
// Nothing here loads or executes plugin code. The package is validated, hashed and placed; the loader
// runs it at the node's next start (pluginLoader.ts), which is why every result says
// `installed-restart-required` rather than pretending the plugin is live.
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, existsSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type {
  PluginInstallResult,
  PluginInstallSource,
  PluginUninstallResult,
  PluginUpdateResult,
} from '@acorn/protocol/api.ts'
import { runProcess } from './core/exec/proc'
import { resolveInRoot } from './core/filesystem/confinement'
import { MANIFEST_FILE, PLUGIN_API_MAJOR, readPluginManifest, type PluginManifest } from './pluginManifest'
import { pluginDbPath, PLUGIN_DB_DIR } from './pluginStorage'

// A plugin package is source plus a bundle or two. 32 MiB is roughly four times the client-bundle
// ceiling and leaves room for assets; anything past it is not a plugin, and a node should not spool a
// gigabyte to disk because a URL said so.
export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 60_000
const UNPACK_TIMEOUT_MS = 120_000

// The convention this phase establishes: a GitHub release carries the package as one asset with this
// exact name. A public authoring guide documents it with the ecosystem work (README § Future work).
export const RELEASE_ASSET = 'acorn-plugin.tgz'

// Everything a caller can be told about why an install did not happen. One class rather than a code
// union because every one of these is the same outcome for the owner — "that package was refused, and
// here is the sentence explaining it" — and the route turns them all into one 400.
export class PluginInstallError extends Error {}

const fail = (message: string): never => {
  throw new PluginInstallError(message)
}

export type PluginProvenance = Record<string, string>

// What was installed, pinned. `archiveSha256` answers "are these the bytes that were reviewed"; the
// entrypoint hashes answer the same question for the two files that actually execute; `provenance`
// records what the source resolved TO (a release tag, an npm integrity value) so "what exactly is
// running" survives the source moving underneath it (node-security.md § Supply chain).
export type PluginLockfile = {
  source: PluginInstallSource
  resolvedVersion: string
  // null for a `{ path }` dev install, where there was no archive.
  archiveSha256: string | null
  entrypoints: { node?: string; client?: string }
  provenance?: PluginProvenance
  installedAt: number
}

export const pluginInstallRoot = (dataRoot: string): string => join(resolve(dataRoot), PLUGIN_DB_DIR)
export const pluginDir = (dataRoot: string, id: string): string => join(pluginInstallRoot(dataRoot), id)
// Beside `<id>/` and `<id>.sqlite`, and unable to collide with either: the manifest id regex forbids a
// dot, so no plugin directory can be named `<id>.lock.json`.
export const lockfilePath = (dataRoot: string, id: string): string => join(pluginInstallRoot(dataRoot), `${id}.lock.json`)

/** Never throws. A missing or corrupt lockfile means "installed before lockfiles, or hand-copied", which
 * is a plugin with no known source rather than an error. */
export function readLockfile(dataRoot: string, id: string): PluginLockfile | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(lockfilePath(dataRoot, id), 'utf8'))
    if (!parsed || typeof parsed !== 'object') return null
    const record = parsed as PluginLockfile
    return typeof record.resolvedVersion === 'string' && record.source ? record : null
  } catch {
    return null
  }
}

/** One line naming where a package came from, for the settings row. */
export const describeSource = (source: PluginInstallSource): string =>
  'github' in source
    ? `github:${source.github}${source.tag ? `@${source.tag}` : ''}`
    : 'npm' in source
      ? `npm:${source.npm}${source.version ? `@${source.version}` : ''}`
      : 'url' in source
        ? source.url
        : `path:${source.path}`

// ── Source resolution ─────────────────────────────────────────────────────────────────────────────

type Resolved = { url: string; provenance: PluginProvenance }

const json = async (url: string, accept: string): Promise<unknown> => {
  guardUrl(url)
  const res = await fetch(url, { headers: { accept }, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  if (!res.ok) fail(`${url} answered ${res.status}.`)
  return await res.json()
}

async function resolveGithub(source: { github: string; tag?: string }): Promise<Resolved> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(source.github)) fail(`'${source.github}' is not an owner/repo pair.`)
  const base = `https://api.github.com/repos/${source.github}/releases`
  const release = (await json(source.tag ? `${base}/tags/${encodeURIComponent(source.tag)}` : `${base}/latest`, 'application/vnd.github+json')) as {
    tag_name?: string
    assets?: { name?: string; browser_download_url?: string }[]
  }
  const asset = (release.assets ?? []).find((candidate) => candidate.name === RELEASE_ASSET)
  if (!asset?.browser_download_url) {
    fail(`That release has no ${RELEASE_ASSET} asset. An acorn plugin release publishes the package under exactly that name.`)
  }
  return { url: asset!.browser_download_url!, provenance: { tag: release.tag_name ?? source.tag ?? 'latest' } }
}

async function resolveNpm(source: { npm: string; version?: string }): Promise<Resolved> {
  if (!/^(@[\w.-]+\/)?[\w.-]+$/.test(source.npm)) fail(`'${source.npm}' is not an npm package name.`)
  const packument = (await json(`https://registry.npmjs.org/${source.npm.replace('/', '%2f')}`, 'application/json')) as {
    'dist-tags'?: Record<string, string>
    versions?: Record<string, { dist?: { tarball?: string; integrity?: string } }>
  }
  const version = source.version ?? packument['dist-tags']?.latest
  if (!version) fail(`${source.npm} has no published version to install.`)
  const dist = packument.versions?.[version!]?.dist
  if (!dist?.tarball) fail(`${source.npm}@${version} has no tarball on the registry.`)
  return { url: dist!.tarball!, provenance: { version: version!, ...(dist!.integrity ? { integrity: dist!.integrity } : {}) } }
}

// https everywhere, plus http on loopback so a test or a local build server can hand this a real
// archive over a real socket. Anything else is a downgrade: a plugin package is code, and fetching it
// in the clear means whoever is between the node and the host chooses what runs.
export function guardUrl(raw: string): void {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return fail(`'${raw}' is not a URL.`)
  }
  if (url.protocol === 'https:') return
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === '::1'
  if (url.protocol === 'http:' && loopback) return
  fail('A plugin package must be fetched over https (http is accepted only from localhost).')
}

// ── Download and unpack ───────────────────────────────────────────────────────────────────────────

async function download(url: string, dest: string): Promise<string> {
  guardUrl(url)
  const res = await fetch(url, { headers: { accept: 'application/octet-stream' }, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  if (!res.ok) fail(`${url} answered ${res.status}.`)
  // Again, on the final URL. fetch follows redirects itself and does not expose the hops, so this is
  // the only place a redirect off https can be caught.
  guardUrl(res.url || url)
  if (!res.body) fail(`${url} returned no body.`)

  // Hashed and capped as it streams, so an oversized package is abandoned partway rather than after a
  // node has already written it all to disk.
  const hash = createHash('sha256')
  let total = 0
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      total += chunk.byteLength
      if (total > MAX_ARCHIVE_BYTES) return done(new PluginInstallError(`That package is larger than the ${MAX_ARCHIVE_BYTES} byte limit.`))
      hash.update(chunk)
      done(null, chunk)
    },
  })
  await pipeline(Readable.fromWeb(res.body as never), meter, createWriteStream(dest, { mode: 0o600 }))
  return hash.digest('hex')
}

async function unpack(archive: string, into: string): Promise<void> {
  mkdirSync(into, { recursive: true, mode: 0o700 })
  // Shelling out to tar, the same way main/backup.ts writes one. No `-P`, so absolute paths and `..`
  // members are stripped or refused by tar itself; the symlink walk below closes the remaining escape.
  const result = await runProcess({
    file: '/usr/bin/tar',
    args: ['-xzf', archive, '-C', into, '--no-same-owner'],
    cwd: into,
    timeoutMs: UNPACK_TIMEOUT_MS,
  })
  if (result.spawnError) fail(`Could not run tar: ${result.spawnError}`)
  if (result.code !== 0) fail(`That archive could not be unpacked: ${result.stderr.trim() || 'tar reported no output'}`)
}

// npm tarballs wrap everything in `package/`, and a hand-rolled `tar -czf` of a plugin folder wraps it
// in the folder name. One unambiguous level of nesting is unwrapped; anything else is a package we
// cannot identify, which is better refused than guessed at.
function packageRoot(unpacked: string): string {
  if (existsSync(join(unpacked, MANIFEST_FILE))) return unpacked
  const entries = readdirSync(unpacked, { withFileTypes: true }).filter((entry) => !entry.name.startsWith('.'))
  const only = entries.length === 1 && entries[0].isDirectory() ? join(unpacked, entries[0].name) : null
  if (only && existsSync(join(only, MANIFEST_FILE))) return only
  return fail(`That archive has no ${MANIFEST_FILE} at its root.`)
}

// tar refuses `..` members, but a symlink INSIDE the package pointing at ~/.ssh survives extraction and
// would make the plugin directory a window onto the rest of the disk — for the loader, for the bundle
// route, and for a backup. Reject the whole package rather than pruning: a package that ships one is
// not one to run half of.
function assertConfined(root: string): void {
  const realRoot = realpathSync(root)
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        let real: string
        try {
          real = realpathSync(full)
        } catch {
          return fail(`The package contains a broken symlink (${relative(root, full)}).`)
        }
        if (real !== realRoot && !real.startsWith(realRoot + sep)) {
          fail(`The package contains a symlink pointing outside itself (${relative(root, full)}).`)
        }
      } else if (entry.isDirectory()) {
        walk(full)
      }
    }
  }
  walk(root)
}

const digestOf = (root: string, relPath: string | undefined): string | undefined => {
  if (!relPath) return undefined
  const abs = resolveInRoot(root, relPath)
  if (!abs) return fail(`The entrypoint '${relPath}' resolves outside the plugin directory.`)
  try {
    return createHash('sha256').update(readFileSync(abs)).digest('hex')
  } catch {
    return fail(`The manifest names '${relPath}', which the package does not contain.`)
  }
}

function validate(root: string, expectId: string | null): PluginManifest {
  assertConfined(root)
  const manifest = readPluginManifest(root)
  if (!manifest) fail(`${MANIFEST_FILE} is missing or does not match the plugin manifest schema.`)
  if (manifest!.apiVersion !== PLUGIN_API_MAJOR) {
    fail(`That package is built for acorn plugin API ${manifest!.apiVersion}; this node speaks ${PLUGIN_API_MAJOR}.`)
  }
  if (expectId && manifest!.id !== expectId) fail(`That package is '${manifest!.id}', not '${expectId}'.`)
  return manifest!
}

// ── Versions ──────────────────────────────────────────────────────────────────────────────────────

// Dotted numeric prefixes only. `null` means "these two cannot be ordered", which is the honest answer
// for a calendar version against a semver, and the downgrade guard treats it as "allow" rather than
// inventing an ordering nobody agreed to.
export function compareVersions(a: string, b: string): number | null {
  const parts = (value: string): number[] | null => {
    const head = value.split('-')[0]!.split('.')
    const nums = head.map((piece) => (/^\d+$/.test(piece) ? Number(piece) : Number.NaN))
    return nums.some(Number.isNaN) ? null : nums
  }
  const left = parts(a)
  const right = parts(b)
  if (!left || !right) return null
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  return 0
}

// ── Placement ─────────────────────────────────────────────────────────────────────────────────────

function writeLockfile(dataRoot: string, id: string, lock: PluginLockfile): void {
  const file = lockfilePath(dataRoot, id)
  const temporary = `${file}.${process.pid}.tmp`
  const fd = openSync(temporary, 'w', 0o600)
  try {
    writeSync(fd, `${JSON.stringify(lock, null, 2)}\n`)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(temporary, file)
  chmodSync(file, 0o600)
}

// The swap. Two renames on one filesystem with a rename-back on failure, which is why staging lives
// under the data root and not in tmpdir — a cross-device rename would fail here rather than in a test.
//
// The window between the renames is real but tiny, and a crash inside it leaves `<id>.old-*` beside a
// missing `<id>`; `sweepDebris` reclaims it at the next boot instead of leaving the node one directory
// short forever.
function placeAtomically(dataRoot: string, id: string, staged: string): void {
  const target = pluginDir(dataRoot, id)
  const incoming = `${target}.incoming-${randomUUID().slice(0, 8)}`
  renameSync(staged, incoming)
  const displaced = existsSync(target) ? `${target}.old-${randomUUID().slice(0, 8)}` : null
  if (displaced) renameSync(target, displaced)
  try {
    renameSync(incoming, target)
  } catch (error) {
    if (displaced) renameSync(displaced, target)
    rmSync(incoming, { recursive: true, force: true })
    throw error
  }
  if (displaced) rmSync(displaced, { recursive: true, force: true })
}

/** Remove staging and displaced directories a previous run did not get to. Called at boot and before
 * every install, never from a read path. */
export function sweepDebris(dataRoot: string): void {
  const root = pluginInstallRoot(dataRoot)
  let names: string[]
  try {
    names = readdirSync(root)
  } catch {
    return // no plugins directory yet, the normal case
  }
  for (const name of names) {
    const debris = name.startsWith('.staging-') || /\.(?:incoming|old)-[0-9a-f]{8}$/.test(name)
    if (!debris) continue
    // A crash between the two renames left the real directory parked under `.old-`. Put it back rather
    // than deleting it: the node was running that version a moment ago.
    const reclaim = /^(.+)\.old-[0-9a-f]{8}$/.exec(name)?.[1]
    if (reclaim && !existsSync(join(root, reclaim))) {
      renameSync(join(root, name), join(root, reclaim))
      continue
    }
    rmSync(join(root, name), { recursive: true, force: true })
  }
}

// ── The operations ────────────────────────────────────────────────────────────────────────────────

export type InstallOptions = {
  allowDowngrade?: boolean
  // `{ path }` is a plugin author's dogfood loop and nothing else: it symlinks a working tree into the
  // install directory, so whatever is in that tree at the node's next start is what runs. Off unless the
  // composition root says this is a development build.
  allowLocalPath?: boolean
}

export async function installPlugin(dataRoot: string, source: PluginInstallSource, options: InstallOptions = {}): Promise<PluginInstallResult> {
  return await place(dataRoot, source, null, options)
}

export async function updatePlugin(dataRoot: string, id: string, options: InstallOptions = {}): Promise<PluginUpdateResult> {
  const lock = readLockfile(dataRoot, id)
  if (!lock) fail(`acorn does not know where '${id}' came from, so it cannot update it. Reinstall it from its source.`)
  const result = await place(dataRoot, lock!.source, id, options)
  return { id, fromVersion: lock!.resolvedVersion, toVersion: result.version, state: result.state }
}

async function place(dataRoot: string, source: PluginInstallSource, expectId: string | null, options: InstallOptions): Promise<PluginInstallResult> {
  const root = pluginInstallRoot(dataRoot)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  sweepDebris(dataRoot)

  if ('path' in source) return linkLocal(dataRoot, source, expectId, options)

  const staging = join(root, `.staging-${randomUUID().slice(0, 8)}`)
  mkdirSync(staging, { recursive: true, mode: 0o700 })
  try {
    const resolved = 'github' in source ? await resolveGithub(source) : 'npm' in source ? await resolveNpm(source) : { url: source.url, provenance: {} }
    const archive = join(staging, 'package.tgz')
    const archiveSha256 = await download(resolved.url, archive)
    const unpacked = join(staging, 'unpacked')
    await unpack(archive, unpacked)
    const pkg = packageRoot(unpacked)
    const manifest = validate(pkg, expectId)

    const existing = readLockfile(dataRoot, manifest.id)
    guardDowngrade(existing, manifest.version, options)
    const entrypoints = {
      ...(manifest.node ? { node: digestOf(pkg, manifest.node)! } : {}),
      ...(manifest.client ? { client: digestOf(pkg, manifest.client)! } : {}),
    }

    placeAtomically(dataRoot, manifest.id, pkg)
    writeLockfile(dataRoot, manifest.id, {
      source,
      resolvedVersion: manifest.version,
      archiveSha256,
      entrypoints,
      ...(Object.keys(resolved.provenance).length ? { provenance: resolved.provenance } : {}),
      installedAt: Date.now(),
    })
    return { id: manifest.id, version: manifest.version, state: 'installed-restart-required' }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

function linkLocal(dataRoot: string, source: { path: string }, expectId: string | null, options: InstallOptions): PluginInstallResult {
  if (!options.allowLocalPath) fail('Installing a plugin from a local path is only available in a development build.')
  if (!isAbsolute(source.path)) fail('A local plugin path must be absolute.')
  const manifest = validate(source.path, expectId)
  guardDowngrade(readLockfile(dataRoot, manifest.id), manifest.version, options)

  const target = pluginDir(dataRoot, manifest.id)
  rmSync(target, { recursive: true, force: true })
  symlinkSync(source.path, target)
  writeLockfile(dataRoot, manifest.id, {
    source,
    resolvedVersion: manifest.version,
    archiveSha256: null,
    entrypoints: {},
    installedAt: Date.now(),
  })
  return { id: manifest.id, version: manifest.version, state: 'installed-restart-required' }
}

// Refuse to go backwards. An update is the attack window (node-security.md § Supply chain), and a
// source that suddenly resolves to an older version is either a mistake or someone re-pointing a tag at
// a version whose vulnerability is already public.
function guardDowngrade(existing: PluginLockfile | null, next: string, options: InstallOptions): void {
  if (!existing || options.allowDowngrade) return
  if (compareVersions(next, existing.resolvedVersion) === -1) {
    fail(`That source resolves to ${next}, which is older than the installed ${existing.resolvedVersion}. Reinstall with "allow downgrade" if that is what you want.`)
  }
}

export function uninstallPlugin(dataRoot: string, id: string, options: { purgeData?: boolean } = {}): PluginUninstallResult {
  const target = pluginDir(dataRoot, id)
  if (!existsSync(target) && !existsSync(lockfilePath(dataRoot, id))) fail(`'${id}' is not installed on this node.`)
  // lstat, so a `{ path }` dev symlink is unlinked rather than followed into the author's working tree.
  rmSync(target, { recursive: true, force: true })
  rmSync(lockfilePath(dataRoot, id), { force: true })

  // Retained by default, which mirrors what disabling has always done (docs/plugins.md: "SQLite files
  // remain on disk and can be re-enabled later"). Reinstalling then finds its data where it left it.
  if (options.purgeData) {
    const db = pluginDbPath(dataRoot, id)
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${db}${suffix}`, { force: true })
  }
  return { restartRequired: true, dataPurged: options.purgeData === true }
}

/** Whether a package directory is currently on disk, without reading it. Used by the roster to tell a
 * pending install from a running plugin. */
export const isInstalled = (dataRoot: string, id: string): boolean => {
  try {
    return statSync(pluginDir(dataRoot, id)).isDirectory()
  } catch {
    return false
  }
}
