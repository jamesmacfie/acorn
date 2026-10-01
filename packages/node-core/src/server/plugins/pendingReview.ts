// An agent-requested package stays inert until its declaration is reviewed. This marker lives
// beside the package, rather than in the agent's in-memory request queue, so a crash or restart
// cannot turn a downloaded package into executable Node code.
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, linkSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { writePrivateAtomic } from '../storage/dataRoot'
import { PLUGIN_DB_DIR } from './storage'
import { MAX_PLUGIN_FILE_BYTES, MAX_PLUGIN_PACKAGE_BYTES, MAX_PLUGIN_PACKAGE_DEPTH, MAX_PLUGIN_PACKAGE_ENTRIES, pluginDirectoryEntries, streamPluginFile, visitPluginFile } from './packageFiles'

export type PendingPluginReview = {
  reviewId: string
  requestId: string
  fingerprint: string
  stagedAt: number
}

const markerPath = (dataRoot: string, id: string): string => {
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(id)) throw new Error('Invalid plugin id for pending review.')
  return join(resolve(dataRoot), PLUGIN_DB_DIR, `${id}.pending-review.json`)
}

export const hasPendingPluginReview = (dataRoot: string, id: string): boolean =>
  existsSync(markerPath(dataRoot, id))

export function pendingPluginReviewIds(dataRoot: string): string[] {
  try {
    return readdirSync(join(resolve(dataRoot), PLUGIN_DB_DIR))
      .map((name) => /^([a-z][a-z0-9-]{1,31})\.pending-review\.json$/.exec(name)?.[1])
      .filter((id): id is string => !!id)
  } catch {
    return []
  }
}

export function readPendingPluginReview(dataRoot: string, id: string): PendingPluginReview | null {
  try {
    const value: unknown = JSON.parse(readFileSync(markerPath(dataRoot, id), 'utf8'))
    if (!value || typeof value !== 'object') return null
    const row = value as Record<string, unknown>
    if (typeof row.reviewId !== 'string' || typeof row.requestId !== 'string' ||
        typeof row.fingerprint !== 'string' || typeof row.stagedAt !== 'number') return null
    return row as PendingPluginReview
  } catch {
    return null
  }
}

/** Binds review to the whole candidate, including imported modules, migrations, and assets. Reads
 * files in chunks so a linked development folder cannot force one giant allocation. */
export function pluginReviewFingerprint(dir: string): string {
  const hash = createHash('sha256')
  const realRoot = realpathSync(dir)
  const visited = new Set<string>()
  let files = 0
  let bytes = 0
  const walk = (path: string, depth: number): void => {
    if (depth > MAX_PLUGIN_PACKAGE_DEPTH) throw new Error('Plugin review exceeds the package depth limit.')
    if (++files > MAX_PLUGIN_PACKAGE_ENTRIES) throw new Error('Plugin review exceeds the package entry limit.')
    const real = realpathSync(path)
    if (real !== realRoot && !real.startsWith(realRoot + sep)) throw new Error(`Review path '${relative(dir, path)}' escapes the plugin package.`)
    const stat = lstatSync(path)
    const rel = relative(dir, path)
    if (stat.isSymbolicLink()) {
      hash.update(`link\0${rel}\0${readlinkSync(path)}\0`)
      if (visited.has(real)) return
    }
    if (statSync(path).isDirectory()) {
      if (visited.has(real)) return
      visited.add(real)
      hash.update(`dir\0${rel}\0`)
      for (const entry of pluginDirectoryEntries(path, MAX_PLUGIN_PACKAGE_ENTRIES - files).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) walk(join(path, entry.name), depth + 1)
      return
    }
    if (!statSync(path).isFile()) throw new Error(`Unsupported review entry '${rel}'.`)
    visitPluginFile(dir, path, Math.min(MAX_PLUGIN_FILE_BYTES, MAX_PLUGIN_PACKAGE_BYTES - bytes), (fd, stats) => {
      hash.update(`file\0${rel}\0${stats.size}\0`)
      bytes += streamPluginFile(fd, stats.size, Math.min(MAX_PLUGIN_FILE_BYTES, MAX_PLUGIN_PACKAGE_BYTES - bytes), (chunk) => hash.update(chunk))
    })
  }
  walk(dir, 0)
  return hash.digest('hex')
}

/** Called only after the installer has validated a candidate, before it becomes the installed path. */
export function stagePluginReview(dataRoot: string, id: string, requestId: string, fingerprint: string): PendingPluginReview {
  if (hasPendingPluginReview(dataRoot, id)) throw new Error(`'${id}' already has an unreviewed package. Review or remove it first.`)
  const review = { reviewId: randomUUID(), requestId, fingerprint, stagedAt: Date.now() }
  const marker = markerPath(dataRoot, id)
  const prepared = `${marker}.${review.reviewId}.prepared`
  try {
    writePrivateAtomic(prepared, `${JSON.stringify(review)}\n`)
    // Same-filesystem hard link is exclusive and publishes a complete marker in one operation.
    // A simultaneous install cannot replace another candidate's gate.
    linkSync(prepared, marker)
  } finally {
    rmSync(prepared, { force: true })
  }
  return review
}

/** Removing the package removes its gate only after the package itself is gone. */
export function removePluginReview(dataRoot: string, id: string): void {
  rmSync(markerPath(dataRoot, id), { force: true })
}

export function approvePluginReview(dataRoot: string, id: string, reviewId: string, fingerprint: string): PendingPluginReview {
  const review = readPendingPluginReview(dataRoot, id)
  if (!review || review.reviewId !== reviewId || review.fingerprint !== fingerprint) {
    throw new Error(`The pending review for '${id}' changed or is unreadable. Reopen its review in Settings.`)
  }
  removePluginReview(dataRoot, id)
  return review
}
