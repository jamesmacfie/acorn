// Putting a third-party plugin on this node, and taking it off again (docs/plugins/loaded-plugins.md § Loaded
// plugins).
//
// Install is per node. A fleet is a set of independently administered nodes, so there is no
// cross-node transaction here and no attempt at one: this module answers "make this node carry this
// package", and every device that pairs with the node picks the bundle up through phase 2's
// distribution path afterwards.
//
// This is also the node's only outbound HTTP consumer (docs/http-client.md says there is no shared
// client). The fetch usage stays inside this file rather than becoming a general helper, the same
// posture docs/security.md asks of the future credential broker.
//
// Nothing here loads or executes plugin code. The package is validated, hashed and placed; the loader
// runs it at the node's next start (pluginLoader.ts), which is why every result says
// `installed-restart-required` rather than pretending the plugin is live.
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type {
  PluginInstallResult,
  PluginInstallSource,
  PluginUninstallResult,
  PluginUpdateResult,
} from '@acorn/protocol/api.ts'
import { describePluginSource, guardPluginUrl, resolvePluginSource, RELEASE_ASSET } from '@acorn/protocol/plugin/source.ts'
import { writePrivateAtomic } from '../storage/dataRoot'
import { unpackPluginArchive } from './archive'
import { assertPluginPackageTree } from './packageTree'
import { hashPluginFile, visitPluginFile, MAX_CLIENT_BUNDLE_BYTES, MAX_PLUGIN_FILE_BYTES } from './packageFiles'
import { MANIFEST_FILE, PLUGIN_API_MAJOR, readPluginManifestResult, speaksApiVersion, type PluginManifest } from './manifest'
import { pluginDbPath, PLUGIN_DB_DIR } from './storage'
import { markPluginRemoved, markPluginUserManaged } from './bundledState'
import { hasPendingPluginReview, pluginReviewFingerprint, removePluginReview, stagePluginReview } from './pendingReview'

// A plugin package is source plus a bundle or two. 32 MiB is roughly four times the client-bundle
// ceiling and leaves room for assets; anything past it is not a plugin, and a node should not spool a
// gigabyte to disk because a URL said so.
export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024
const DOWNLOAD_TIMEOUT_MS = 60_000

// The convention this phase establishes: a GitHub release carries the package as one asset with this
// exact name.
export { RELEASE_ASSET }

// Everything a caller can be told about why an install did not happen. One class rather than a code
// union because every one of these is the same outcome for the owner, "that package was refused, and
// here is the sentence explaining it", and the route turns them all into one 400.
export class PluginInstallError extends Error {}

const fail = (message: string): never => {
  throw new PluginInstallError(message)
}

export type PluginProvenance = Record<string, string>

// What was installed, pinned. `archiveSha256` answers "are these the bytes that were reviewed"; the
// entrypoint hashes answer the same question for the two files that actually execute; `provenance`
// records what the source resolved to (a release tag, an npm integrity value) so "what exactly is
// running" survives the source moving underneath it (docs/security/plugin-storage-and-supply-chain.md § Supply chain).
export type PluginLockfile = {
  source: PluginInstallSource
  resolvedVersion: string
  // null for a `{ path }` folder install, where there was no archive and nothing to pin, since the
  // directory is symlinked and stays editable. `entrypoints` is empty for the same reason.
  archiveSha256: string | null
  entrypoints: { node?: string; client?: string }
  provenance?: PluginProvenance
  installedAt: number
}

export const pluginInstallRoot = (dataRoot: string): string => join(resolve(dataRoot), PLUGIN_DB_DIR)
const checkedPluginId = (id: string): string => {
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(id)) fail('Invalid plugin id.')
  return id
}
export const pluginDir = (dataRoot: string, id: string): string => join(pluginInstallRoot(dataRoot), checkedPluginId(id))
// Beside `<id>/` and `<id>.sqlite`, and unable to collide with either: the manifest id regex forbids a
// dot, so no plugin directory can be named `<id>.lock.json`.
export const lockfilePath = (dataRoot: string, id: string): string => join(pluginInstallRoot(dataRoot), `${checkedPluginId(id)}.lock.json`)

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
export const describeSource = describePluginSource

// ── Source resolution ─────────────────────────────────────────────────────────────────────────────

// https everywhere, plus http on loopback so a test or a local build server can hand this a real
// archive over a real socket. Anything else is a downgrade: a plugin package is code, and fetching it
// in the clear means whoever is between the node and the host chooses what runs.
export const guardUrl = guardPluginUrl

// ── Download and unpack ───────────────────────────────────────────────────────────────────────────

// npm publishes each version's tarball digest as a Subresource Integrity string,
// `<algorithm>-<base64 digest>`, optionally several separated by spaces. It was recorded into
// provenance and never checked, which made it a note about the package rather than a statement about
// the bytes on disk. This parses the strongest entry we can compute; an unrecognised algorithm returns
// null and the caller treats that as "the registry told us nothing we can verify".
const SRI_ALGORITHMS = ['sha512', 'sha384', 'sha256'] as const

export function parseIntegrity(integrity: string | undefined): { algorithm: string; digest: string } | null {
  if (!integrity) return null
  const entries = integrity.trim().split(/\s+/).map((entry) => entry.split('-'))
  for (const algorithm of SRI_ALGORITHMS) {
    const match = entries.find(([name, digest]) => name === algorithm && digest)
    if (match) return { algorithm, digest: match.slice(1).join('-') }
  }
  return null
}

// `expectIntegrity` is the registry's claim about these bytes. A plugin package is code that runs with
// the node's own access, so a mismatch is refused rather than warned about: it means the archive is
// not the one the registry published, which is either a corrupt transfer or someone between here and
// the host choosing what runs.
async function download(url: string, dest: string, expectIntegrity?: string): Promise<string> {
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
  const expected = parseIntegrity(expectIntegrity)
  // A second digest only when there is something to compare it against, and in the registry's own
  // algorithm rather than ours: sha256 above is the lockfile's record of what was installed, which is
  // a different question from whether these are the published bytes.
  const integrity = expected ? createHash(expected.algorithm) : null
  let total = 0
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      total += chunk.byteLength
      if (total > MAX_ARCHIVE_BYTES) return done(new PluginInstallError(`That package is larger than the ${MAX_ARCHIVE_BYTES} byte limit.`))
      hash.update(chunk)
      integrity?.update(chunk)
      done(null, chunk)
    },
  })
  await pipeline(Readable.fromWeb(res.body as never), meter, createWriteStream(dest, { mode: 0o600 }))
  if (expected && integrity!.digest('base64') !== expected.digest) {
    fail(`That package does not match the ${expected.algorithm} digest the registry published for it. Nothing was installed.`)
  }
  return hash.digest('hex')
}

async function unpack(archive: string, into: string): Promise<void> {
  try {
    await unpackPluginArchive(archive, into)
  } catch (error) {
    fail(error instanceof Error ? error.message : 'That archive could not be unpacked.')
  }
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

const digestOf = (root: string, relPath: string | undefined, maxBytes = MAX_PLUGIN_FILE_BYTES): string | undefined => {
  if (!relPath) return undefined
  try {
    return hashPluginFile(root, relPath, maxBytes)
  } catch (error) {
    return fail(`The package does not contain a readable regular entrypoint '${relPath}': ${error instanceof Error ? error.message : String(error)}`)
  }
}

function validate(root: string, expectId: string | null): PluginManifest {
  try { assertPluginPackageTree(root) }
  catch (error) { fail(error instanceof Error ? error.message : 'The package could not be validated.') }
  const parsed = readPluginManifestResult(root)
  if (!parsed.ok) return fail(parsed.reason)
  const manifest = parsed.manifest
  if (!speaksApiVersion(manifest.apiVersion)) {
    fail(`That package is built for acorn plugin API ${manifest.apiVersion}; this node speaks ${PLUGIN_API_MAJOR}.`)
  }
  if (manifest.node) {
    try { visitPluginFile(root, manifest.node, MAX_PLUGIN_FILE_BYTES, () => undefined) }
    catch (error) { fail(`The package does not contain a readable regular entrypoint '${manifest.node}': ${error instanceof Error ? error.message : String(error)}`) }
  }
  // Custody retains its established too-large projection; its callback reads client bytes with
  // the shared descriptor guard. Node placement hashes with the client ceiling below.
  if (expectId && manifest.id !== expectId) fail(`That package is '${manifest.id}', not '${expectId}'.`)
  return manifest
}

/** Inspect downloaded package bytes without installing them on a node. The callback must copy what it
 * needs before this returns; the staged directory is always removed. Desktop custody uses the same
 * archive limit, integrity check, unpacking, and manifest parser as the node installer. */
export async function withPluginPackage<T>(
  stagingRoot: string,
  source: PluginInstallSource,
  inspect: (root: string, manifest: PluginManifest) => Promise<T> | T,
): Promise<T> {
  if ('path' in source) {
    if (!isAbsolute(source.path)) fail('A local plugin path must be absolute.')
    return inspect(source.path, validate(source.path, null))
  }
  mkdirSync(stagingRoot, { recursive: true, mode: 0o700 })
  const staging = join(stagingRoot, `.staging-${randomUUID().slice(0, 8)}`)
  mkdirSync(staging, { recursive: true, mode: 0o700 })
  try {
    const resolved = await resolvePluginSource(source)
    const archive = join(staging, 'package.tgz')
    await download(resolved.url, archive, resolved.provenance.integrity)
    const unpacked = join(staging, 'unpacked')
    await unpack(archive, unpacked)
    const root = packageRoot(unpacked)
    return await inspect(root, validate(root, null))
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
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
  writePrivateAtomic(file, `${JSON.stringify(lock, null, 2)}\n`)
}

// The swap. Two renames on one filesystem with a rename-back on failure, which is why staging lives
// under the data root and not in tmpdir. A cross-device rename would fail here rather than in a test.
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
  /** An owner-approved first step of an agent request. The package is quarantined before placement. */
  reviewRequestId?: string
}

export async function installPlugin(dataRoot: string, source: PluginInstallSource, options: InstallOptions = {}): Promise<PluginInstallResult> {
  return await place(dataRoot, source, null, options)
}

export async function updatePlugin(dataRoot: string, id: string, options: InstallOptions = {}): Promise<PluginUpdateResult> {
  if (hasPendingPluginReview(dataRoot, id)) fail(`'${id}' has an unreviewed package. Review or remove it first.`)
  const lock = readLockfile(dataRoot, id)
  if (!lock) fail(`acorn does not know where '${id}' came from, so it cannot update it. Reinstall it from its source.`)
  const result = await place(dataRoot, lock!.source, id, options)
  return { id, fromVersion: lock!.resolvedVersion, toVersion: result.version, state: result.state }
}

async function place(dataRoot: string, source: PluginInstallSource, expectId: string | null, options: InstallOptions): Promise<PluginInstallResult> {
  if ('path' in source) return linkLocal(dataRoot, source, expectId, options)
  const root = pluginInstallRoot(dataRoot)
  mkdirSync(root, { recursive: true, mode: 0o700 })
  sweepDebris(dataRoot)

  const staging = join(root, `.staging-${randomUUID().slice(0, 8)}`)
  mkdirSync(staging, { recursive: true, mode: 0o700 })
  try {
    const resolved = await resolvePluginSource(source)
    const archive = join(staging, 'package.tgz')
    const archiveSha256 = await download(resolved.url, archive, resolved.provenance.integrity)
    const unpacked = join(staging, 'unpacked')
    await unpack(archive, unpacked)
    const pkg = packageRoot(unpacked)
    const manifest = validate(pkg, expectId)
    if (hasPendingPluginReview(dataRoot, manifest.id)) fail(`'${manifest.id}' has an unreviewed package. Review or remove it first.`)

    const existing = readLockfile(dataRoot, manifest.id)
    guardDowngrade(existing, manifest.version, options)
    const entrypoints = {
      ...(manifest.node ? { node: digestOf(pkg, manifest.node)! } : {}),
      ...(manifest.client ? { client: digestOf(pkg, manifest.client, MAX_CLIENT_BUNDLE_BYTES)! } : {}),
    }

    if (options.reviewRequestId) stagePluginReview(dataRoot, manifest.id, options.reviewRequestId, pluginReviewFingerprint(pkg))
    placeAtomically(dataRoot, manifest.id, pkg)
    writeLockfile(dataRoot, manifest.id, {
      source,
      resolvedVersion: manifest.version,
      archiveSha256,
      entrypoints,
      ...(Object.keys(resolved.provenance).length ? { provenance: resolved.provenance } : {}),
      installedAt: Date.now(),
    })
    markPluginUserManaged(dataRoot, manifest.id)
    return { id: manifest.id, version: manifest.version, state: 'installed-restart-required' }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

// A folder install (docs/security/plugin-install.md § Installing from a folder). The directory is symlinked rather
// than copied, so whatever is in that tree at the node's next start is what runs, and the lockfile
// below records no archive hash and no entrypoint digests because there is nothing to pin.
function linkLocal(dataRoot: string, source: { path: string }, expectId: string | null, options: InstallOptions): PluginInstallResult {
  if (!isAbsolute(source.path)) fail('A local plugin path must be absolute.')
  const manifest = validate(source.path, expectId)
  if (hasPendingPluginReview(dataRoot, manifest.id)) fail(`'${manifest.id}' has an unreviewed package. Review or remove it first.`)
  guardDowngrade(readLockfile(dataRoot, manifest.id), manifest.version, options)

  mkdirSync(pluginInstallRoot(dataRoot), { recursive: true, mode: 0o700 })
  sweepDebris(dataRoot)
  const target = pluginDir(dataRoot, manifest.id)
  if (options.reviewRequestId) stagePluginReview(dataRoot, manifest.id, options.reviewRequestId, pluginReviewFingerprint(source.path))
  rmSync(target, { recursive: true, force: true })
  symlinkSync(source.path, target)
  writeLockfile(dataRoot, manifest.id, {
    source,
    resolvedVersion: manifest.version,
    archiveSha256: null,
    entrypoints: {},
    installedAt: Date.now(),
  })
  markPluginUserManaged(dataRoot, manifest.id)
  return { id: manifest.id, version: manifest.version, state: 'installed-restart-required' }
}

// Refuse to go backwards. An update is the attack window (docs/security/plugin-storage-and-supply-chain.md § Supply chain), and a
// source that suddenly resolves to an older version is either a mistake or someone re-pointing a tag
// at a version whose vulnerability is already public.
function guardDowngrade(existing: PluginLockfile | null, next: string, options: InstallOptions): void {
  if (!existing || options.allowDowngrade) return
  if (compareVersions(next, existing.resolvedVersion) === -1) {
    fail(`That source resolves to ${next}, which is older than the installed ${existing.resolvedVersion}. Reinstall with "allow downgrade" if that is what you want.`)
  }
}

export function uninstallPlugin(dataRoot: string, id: string, options: { purgeData?: boolean } = {}): PluginUninstallResult {
  const target = pluginDir(dataRoot, id)
  if (!existsSync(target) && !existsSync(lockfilePath(dataRoot, id)) && !hasPendingPluginReview(dataRoot, id)) fail(`'${id}' is not installed on this node.`)
  markPluginRemoved(dataRoot, id)
  // lstat, so a `{ path }` folder symlink is unlinked rather than followed into the owner's directory.
  rmSync(target, { recursive: true, force: true })
  rmSync(lockfilePath(dataRoot, id), { force: true })
  removePluginReview(dataRoot, id)

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
