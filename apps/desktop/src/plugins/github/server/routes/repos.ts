import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { Repo } from '../../../../core/shared/api'
import { getDb, schema } from '../../../../core/server/db'
import { reposResource } from '../../../../core/server/db/resourceKeys'
import type { AppEnv } from '../../../../core/server/middleware/auth'
import { getUser } from '../../../../core/server/middleware/requireUser'
import { respondError } from '../../../../core/server/respond'
import { REPOS_STALE_AFTER_MS } from '../../../../core/server/sync/policy'
import { type Cached, serveThenRevalidate } from '../../../../core/server/sync/engine'
import { readCachedRepos, refreshRepos, toPublicRepo } from './repoMirror'

export const repos = new Hono<AppEnv>()
  .get('/', async (c) => {
    const user = getUser(c)

    const db = getDb(c.env)
    const userId = user.login // ponytail: login as the scope key — stable enough; revisit if logins churn.
    const resource = reposResource()

    // Freshness comes from sync_state (bumped on every 200/304). A pre-ETag mirror has repo rows but
    // no sync row yet — fall back to the newest row's fetchedAt so it serves as stale (not cold) and
    // self-heals on the first refresh. Cold only when nothing was ever fetched.
    const read = async (): Promise<Cached<Repo[]> | null> => {
      const [[sync], rows] = await Promise.all([
        db.select().from(schema.syncState).where(and(eq(schema.syncState.userId, userId), eq(schema.syncState.resource, resource))),
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
      refresh: () => refreshRepos(user.token, db, userId),
    })
    if (!result.ok) return respondError(c, result.failure.status, result.failure.error, result.failure.detail)
    return c.json(result.value)
  })
  .post('/refresh', async (c) => {
    const user = getUser(c)

    // Force the next GET stale: zero both freshness sources (sync row + legacy row fetchedAt). The
    // ETag stays, so the refetch can still 304 (nothing changed → cheap re-validate).
    const db = getDb(c.env)
    await db.batch([
      db.update(schema.repos).set({ fetchedAt: 0 }).where(eq(schema.repos.userId, user.login)),
      db.update(schema.syncState).set({ fetchedAt: 0 }).where(and(eq(schema.syncState.userId, user.login), eq(schema.syncState.resource, reposResource()))),
    ])
    return c.body(null, 204)
  })
