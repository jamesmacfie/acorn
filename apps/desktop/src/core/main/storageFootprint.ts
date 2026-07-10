// Visibility trigger for deferred retention work. Derived mirrors/blob data deliberately have no
// sweep yet; logging their size at startup turns future retention into a measured decision.
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { count } from 'drizzle-orm'
import type { AppDatabase } from '../server/db'
import { schema } from '../server/db'

async function directoryBytes(path: string): Promise<number> {
  try {
    let total = 0
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name)
      total += entry.isDirectory() ? await directoryBytes(child) : entry.isFile() ? (await stat(child)).size : 0
    }
    return total
  } catch {
    return 0
  }
}

export async function logStorageFootprint(db: AppDatabase, dataDir: string): Promise<void> {
  const [blobBytes, repos, pulls, issues, syncRows] = await Promise.all([
    directoryBytes(join(dataDir, 'blobs')),
    db.select({ value: count() }).from(schema.repos),
    db.select({ value: count() }).from(schema.pullRequests),
    db.select({ value: count() }).from(schema.issues),
    db.select({ value: count() }).from(schema.syncState),
  ])
  console.log(`[storage] blobs=${blobBytes}B mirrors repos=${repos[0]?.value ?? 0} pulls=${pulls[0]?.value ?? 0} issues=${issues[0]?.value ?? 0} sync=${syncRows[0]?.value ?? 0}`)
}
