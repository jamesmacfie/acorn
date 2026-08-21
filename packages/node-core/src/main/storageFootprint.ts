import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { count } from 'drizzle-orm'
import type { AppDatabase } from '../server/db'
import { schema } from '../server/db'
import { PLUGIN_DB_DIR } from './pluginStorage'
import { resolveDatabasePath } from './serverPaths'

async function fileBytes(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

async function directoryBytes(path: string, keep: (name: string) => boolean = () => true): Promise<number> {
  try {
    let total = 0
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      if (!keep(entry.name)) continue
      total += entry.isDirectory() ? await directoryBytes(child, keep) : entry.isFile() ? (await stat(child)).size : 0
    }
    return total
  } catch {
    return 0
  }
}

// `<dataRoot>/plugins` holds two unrelated things: one SQLite file per plugin (plus its -wal/-shm
// siblings), and, since the loader landed, the unpacked package of every installed plugin in a
// subdirectory named for its id. Only the first counts as "plugin databases"; counting the second
// would silently report bundle bytes as stored rows.
const isPluginDatabase = (name: string): boolean => name.includes('.sqlite')

/**
 * Row counts a plugin can report about its own database. Resolved by the composition root from the
 * capability registry (plugins/github/src/contract/mirror.ts § footprint), so a disabled plugin
 * contributes nothing and is absent from the log line rather than reported as empty.
 *
 * A failing contributor must not take the boot log with it: this whole function is already fired
 * best-effort by the caller, but one plugin's broken query should not hide the others' numbers either,
 * so each is caught individually below.
 */
export type FootprintContributor = { plugin: string; counts: () => Promise<Record<string, number>> }

export async function logStorageFootprint(
  db: AppDatabase,
  dataDir: string,
  contributors: readonly FootprintContributor[] = [],
): Promise<void> {
  const [blobBytes, coreBytes, pluginBytes, issues, syncRows] = await Promise.all([
    directoryBytes(join(dataDir, 'blobs')),
    fileBytes(resolveDatabasePath(dataDir)),
    directoryBytes(join(dataDir, PLUGIN_DB_DIR), isPluginDatabase),
    db.select({ value: count() }).from(schema.issues),
    db.select({ value: count() }).from(schema.syncState),
  ])

  const parts = [
    `blobs=${blobBytes}B`,
    `core.sqlite=${coreBytes}B`,
    `plugin-dbs=${pluginBytes}B`,
    `core issues=${issues[0]?.value ?? 0} provider-sync=${syncRows[0]?.value ?? 0}`,
  ]
  for (const contributor of contributors) {
    const counts = await contributor.counts().catch((error: unknown) => {
      console.warn(`[storage] ${contributor.plugin} footprint failed:`, error)
      return null
    })
    // `null` is the failure above and is deliberately NOT rendered as zeros.
    if (counts) parts.push(`${contributor.plugin} ${Object.entries(counts).map(([key, value]) => `${key}=${value}`).join(' ')}`)
  }
  console.log(`[storage] ${parts.join(' ')}`)
}
