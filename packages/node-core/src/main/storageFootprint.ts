// Visibility trigger for deferred retention work. Derived mirrors/blob data deliberately have no
// sweep yet; logging their size at startup turns future retention into a measured decision.
//
// Phase 2 split the single database, and this is the one place where that split could have degraded
// silently. The line used to count `repos` / `pull_requests` / `issues` / `sync_state` off core's handle;
// two of those tables now live in <data-root>/plugins/github.sqlite, which core cannot see. Counting
// them against core's schema would still COMPILE (drizzle would happily emit `select count(*) from
// repos`) and would then fail at runtime, or worse — if a stale core database still had the dropped
// tables — report a number that has nothing to do with the live mirror.
//
// So the counts a plugin owns are CONTRIBUTED by the plugin, and this function reports only what it can
// actually see. A plugin that contributes nothing is omitted from the line entirely rather than logged as
// zero, because "0 repos mirrored" and "nobody told me about repos" are different facts and only one of
// them is a reason to look at retention.
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
  // Core's own remaining mirror-ish tables: the generic external-item read model and the provider
  // freshness markers (server/integrations/itemStore.ts explains why these two stayed here).
  const [blobBytes, issues, syncRows] = await Promise.all([
    directoryBytes(join(dataDir, 'blobs')),
    db.select({ value: count() }).from(schema.issues),
    db.select({ value: count() }).from(schema.syncState),
  ])

  const parts = [`blobs=${blobBytes}B`, `core issues=${issues[0]?.value ?? 0} provider-sync=${syncRows[0]?.value ?? 0}`]
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
