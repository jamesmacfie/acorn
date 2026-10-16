import { count } from 'drizzle-orm'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import { pullRequests, repositories, syncState } from '../node/schema'

/** Row counts for core's boot storage log, which can't see these tables. */
export async function mirrorFootprint(db: PluginDatabase): Promise<Record<string, number>> {
  const [repositoryRows, pullRequestRows, syncRows] = await Promise.all([
    db.select({ value: count() }).from(repositories),
    db.select({ value: count() }).from(pullRequests),
    db.select({ value: count() }).from(syncState),
  ])
  return {
    repositories: repositoryRows[0]?.value ?? 0,
    pullRequests: pullRequestRows[0]?.value ?? 0,
    sync: syncRows[0]?.value ?? 0,
  }
}
