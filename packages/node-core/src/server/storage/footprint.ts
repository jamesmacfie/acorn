import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { count } from 'drizzle-orm'
import type { NodeStorageReport } from '@acorn/protocol/api.ts'
import type { AppDatabase } from '../db'
import { schema } from '../db'
import { PLUGIN_DB_DIR } from '../plugins/storage'
import { resolveDatabasePath } from './paths'
import { createLogger, describeError } from '../telemetry/logger'
import { capabilityId, type CapabilityRegistry } from '../pluginHost/capabilities'

const log = createLogger('storage')

async function fileBytes(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

async function directoryBytes(path: string): Promise<number> {
  try {
    let total = 0
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      total += entry.isDirectory() ? await directoryBytes(child) : entry.isFile() ? await fileBytes(child) : 0
    }
    return total
  } catch {
    return 0
  }
}

// A database and the two files SQLite keeps beside it in WAL mode. The WAL can be as large as the
// database between checkpoints, so leaving it out would understate a busy plugin by half.
const databaseBytes = async (path: string): Promise<number> =>
  (await Promise.all([path, `${path}-wal`, `${path}-shm`].map(fileBytes))).reduce((sum, bytes) => sum + bytes, 0)

// `<dataRoot>/plugins` holds two unrelated things: one SQLite file per plugin, with its -wal and
// -shm siblings, and the unpacked package of every installed plugin in a subdirectory named for its
// id. Only the first counts as a plugin database. Counting the second reports bundle bytes as rows.
async function pluginDatabases(dir: string): Promise<{ plugin: string; bytes: number }[]> {
  const names = await readdir(dir, { withFileTypes: true })
    .then((entries) =>
      entries.filter((entry) => entry.isFile() && entry.name.endsWith('.sqlite')).map((entry) => entry.name),
    )
    .catch(() => [] as string[])
  const sizes = await Promise.all(
    names.map(async (name) => ({
      plugin: name.slice(0, -'.sqlite'.length),
      bytes: await databaseBytes(join(dir, name)),
    })),
  )
  return sizes.sort((a, b) => b.bytes - a.bytes || a.plugin.localeCompare(b.plugin))
}

type DiskSizes = Omit<NodeStorageReport, 'rssBytes'>

async function measureDisk(dataDir: string): Promise<DiskSizes> {
  const [blobCacheBytes, coreDatabaseBytes, plugins] = await Promise.all([
    directoryBytes(join(dataDir, 'blobs')),
    databaseBytes(resolveDatabasePath(dataDir)),
    pluginDatabases(join(dataDir, PLUGIN_DB_DIR)),
  ])
  return { coreDatabaseBytes, pluginDatabases: plugins, blobCacheBytes }
}

// How long one measurement is reused. The blob cache is thousands of files and each is a `stat`, and
// Settings > Storage and memory asks every five seconds while it is open.
const DISK_REUSE_MS = 30_000
let lastDisk: { dataDir: string; at: number; sizes: Promise<DiskSizes> } | null = null

/** What Settings > Storage and memory shows for core: this process's memory, and the size of the
 *  databases and the blob cache. Memory is read on every call. Disk sizes are reused for 30 seconds. */
export async function nodeStorageReport(dataDir: string, now = Date.now()): Promise<NodeStorageReport> {
  if (!lastDisk || lastDisk.dataDir !== dataDir || now - lastDisk.at >= DISK_REUSE_MS) {
    lastDisk = { dataDir, at: now, sizes: measureDisk(dataDir) }
  }
  return { rssBytes: process.memoryUsage().rss, ...(await lastDisk.sizes) }
}

/**
 * Row counts a plugin reports about its own database. The composition root resolves these from the
 * capability registry, so a disabled plugin contributes nothing and is absent from the log line
 * rather than reported as empty. Each contributor is caught separately below, so one broken query
 * does not hide the other numbers.
 */
export type FootprintContributor = { plugin: string; counts: () => Promise<Record<string, number>> }

/** What a plugin with a mirror provides under `mirrorFootprintCapability(<its id>)`, for the log. The
 *  plugin owns those tables, so it reports their counts instead of exposing its database handle. */
type MirrorFootprint = { footprint(): Promise<Record<string, number>> }

// One capability per plugin, because a capability has one provider. The suffix is how the log finds
// them all without knowing which plugins have a mirror.
const MIRROR_FOOTPRINT = '.mirrorFootprint'
export const mirrorFootprintCapability = (pluginId: string) =>
  capabilityId<MirrorFootprint>(`${pluginId}${MIRROR_FOOTPRINT}`)

/** Every mirror footprint the running plugins provide, as log contributors. */
export const mirrorFootprints = (capabilities: Pick<CapabilityRegistry, 'ids' | 'get'>): FootprintContributor[] =>
  capabilities
    .ids()
    .filter((id) => id.endsWith(MIRROR_FOOTPRINT))
    .map((id) => ({
      plugin: id.slice(0, -MIRROR_FOOTPRINT.length),
      // Async, so a plugin that stopped since the list was read fails its own counts and not the line.
      counts: async () => capabilities.get(capabilityId<MirrorFootprint>(id))!.footprint(),
    }))

export async function logStorageFootprint(
  db: AppDatabase,
  dataDir: string,
  contributors: readonly FootprintContributor[] = [],
): Promise<void> {
  const [disk, issues, syncRows] = await Promise.all([
    measureDisk(dataDir),
    db.select({ value: count() }).from(schema.issues),
    db.select({ value: count() }).from(schema.syncState),
  ])

  const parts = [
    `blobs=${disk.blobCacheBytes}B`,
    `core.sqlite=${disk.coreDatabaseBytes}B`,
    `plugin-dbs=${disk.pluginDatabases.reduce((sum, entry) => sum + entry.bytes, 0)}B`,
    `core issues=${issues[0]?.value ?? 0} provider-sync=${syncRows[0]?.value ?? 0}`,
  ]
  for (const contributor of contributors) {
    const counts = await contributor.counts().catch((error: unknown) => {
      log.warn(`${contributor.plugin} footprint failed: ${describeError(error).message}`)
      return null
    })
    // `null` is the failure above, and is not rendered as zeros.
    if (counts)
      parts.push(
        `${contributor.plugin} ${Object.entries(counts)
          .map(([key, value]) => `${key}=${value}`)
          .join(' ')}`,
      )
  }
  log.info(parts.join(' '))
}
