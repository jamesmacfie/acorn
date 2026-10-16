import { count } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import { mergeRequests, projects, syncState } from '../node/schema'

/** Row counts for core's boot storage log, which can't see these tables. */
export async function mirrorFootprint(db: PluginDatabase): Promise<Record<string, number>> {
  const [projectRows, mergeRequestRows, syncRows] = await Promise.all([
    db.select({ value: count() }).from(projects),
    db.select({ value: count() }).from(mergeRequests),
    db.select({ value: count() }).from(syncState),
  ])
  return {
    projects: projectRows[0]?.value ?? 0,
    mergeRequests: mergeRequestRows[0]?.value ?? 0,
    sync: syncRows[0]?.value ?? 0,
  }
}
