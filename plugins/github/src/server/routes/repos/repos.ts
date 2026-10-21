import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { Repo } from '../../../shared/api'
import { reposResource } from '../../resourceKeys'
import {
  type AppEnv,
  type Cached,
  ownerId,
  type PluginDatabase,
  respondError,
  serveThenRevalidate,
} from '@acorn/plugin-api/node'
import { REPOS_STALE_AFTER_MS } from '../../syncPolicy'
import { readCachedRepos, refreshRepos, toPublicRepo } from '../mirror/repoMirror'
import { githubToken } from '../../githubToken'
import { syncState } from '../../../node/schema'
import { type GithubEmit, NO_EMIT } from '../../events'

// Factory over this plugin's own database, not a module-scope router (docs/data-layer/plugin-databases.md § Plugin
// databases).
export const repos = (db: PluginDatabase, emit: GithubEmit = NO_EMIT) =>
  new Hono<AppEnv>()
    .get('/', async (c) => {
      const uid = ownerId(c)
      const token = await githubToken(c)

      const userId = uid // The active owner is the mirror scope key for this request.
      const resource = reposResource()

      // Freshness comes from sync_state, bumped on every 200 and 304. With no sync row the list was
      // never fetched, so it reads as cold even when opening one repository left a single row behind.
      const read = async (): Promise<Cached<Repo[]> | null> => {
        const [[sync], rows] = await Promise.all([
          db
            .select()
            .from(syncState)
            .where(and(eq(syncState.userId, userId), eq(syncState.resource, resource))),
          readCachedRepos(db, userId),
        ])
        return sync ? { data: rows.map(toPublicRepo), fetchedAt: sync.fetchedAt } : null
      }

      const result = await serveThenRevalidate({
        resource,
        userId,
        ttlMs: REPOS_STALE_AFTER_MS,
        force: c.req.query('force') === 'true',
        read,
        refresh: () => refreshRepos(token, db, userId, { emit }),
      })
      if (!result.ok) return respondError(c, result.failure.status, result.failure.error, result.failure.detail)
      return c.json(result.value)
    })
    .post('/refresh', async (c) => {
      const uid = ownerId(c)

      // Force the next GET stale. The ETag stays, so the refetch can still 304 (nothing changed → cheap
      // re-validate).
      await db
        .update(syncState)
        .set({ fetchedAt: 0 })
        .where(and(eq(syncState.userId, uid), eq(syncState.resource, reposResource())))
      return c.body(null, 204)
    })
