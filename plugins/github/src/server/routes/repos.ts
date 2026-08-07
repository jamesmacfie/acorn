import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { Repo } from '../../contract/api'
import { reposResource } from '../resourceKeys'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { ownerId } from '@acorn/node-core/server/middleware/requireUser.ts'
import { respondError } from '@acorn/node-core/server/respond.ts'
import { REPOS_STALE_AFTER_MS } from '@acorn/node-core/server/sync/policy.ts'
import { type Cached, serveThenRevalidate } from '@acorn/node-core/server/sync/engine.ts'
import { readCachedRepos, refreshRepos, toPublicRepo } from './repoMirror'
import { githubToken } from '../githubToken'
import { repos as reposTable, syncState } from '../../node/schema'
import type { PluginDatabase } from '@acorn/node-core/main/pluginStorage.ts'

// A FACTORY over this plugin's own database, not a module-scope router reading getDb(c.env). The tables
// live in <data-root>/plugins/github.sqlite now, and `c.env` deliberately carries no per-plugin handles
// (docs/data-layer.md § Plugin DBs). The handle arrives at plugin init, so no request can reach an
// unmigrated database — and a second startServiceRuntime in one process builds fresh routers over its own
// handle instead of inheriting a closed one.
export const repos = (db: PluginDatabase) => new Hono<AppEnv>()
  .get('/', async (c) => {
    const uid = ownerId(c)
    const token = await githubToken(c)

    const userId = uid // The active owner is the mirror scope key for this request.
    const resource = reposResource()

    // Freshness comes from sync_state (bumped on every 200/304). A pre-ETag mirror has repo rows but
    // no sync row yet — fall back to the newest row's fetchedAt so it serves as stale (not cold) and
    // self-heals on the first refresh. Cold only when nothing was ever fetched.
    const read = async (): Promise<Cached<Repo[]> | null> => {
      const [[sync], rows] = await Promise.all([
        db.select().from(syncState).where(and(eq(syncState.userId, userId), eq(syncState.resource, resource))),
        readCachedRepos(db, userId),
      ])
      if (!sync && rows.length === 0) return null
      const fetchedAt = sync?.fetchedAt ?? rows.reduce((max, r) => Math.max(max, r.fetchedAt), 0)
      return { data: rows.map(toPublicRepo), fetchedAt }
    }

    const result = await serveThenRevalidate({
      resource,
      userId,
      ttlMs: REPOS_STALE_AFTER_MS,
      read,
      refresh: () => refreshRepos(token, db, userId),
    })
    if (!result.ok) return respondError(c, result.failure.status, result.failure.error, result.failure.detail)
    return c.json(result.value)
  })
  .post('/refresh', async (c) => {
    const uid = ownerId(c)

    // Force the next GET stale: zero both freshness sources (sync row + legacy row fetchedAt). The
    // ETag stays, so the refetch can still 304 (nothing changed → cheap re-validate).
    await db.batch([
      db.update(reposTable).set({ fetchedAt: 0 }).where(eq(reposTable.userId, uid)),
      db.update(syncState).set({ fetchedAt: 0 }).where(and(eq(syncState.userId, uid), eq(syncState.resource, reposResource()))),
    ])
    return c.body(null, 204)
  })
