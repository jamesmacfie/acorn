import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { trackBackgroundRefresh } from '../background'
import { getDb, schema } from '../db'
import type { AppEnv } from '../middleware/auth'
import { getUser } from '../middleware/requireUser'
import { respondError } from '../respond'
import { readCachedRepos, refreshRepos, REPOS_STALE_AFTER_MS, toPublicRepo } from './repoMirror'

export const repos = new Hono<AppEnv>()
  .get('/', async (c) => {
    const user = getUser(c)

    const db = getDb(c.env)
    const userId = user.login // ponytail: login as the scope key — stable enough; revisit if logins churn.

    const cached = await readCachedRepos(db, userId)

    // Fresh if we have rows and the most recent sync is within the staleness window.
    const newest = cached.reduce((max, r) => Math.max(max, r.fetchedAt), 0)
    const fresh = cached.length > 0 && newest + REPOS_STALE_AFTER_MS > Date.now()
    if (fresh) return c.json(cached.map(toPublicRepo))

    // Stale-but-present is enough for first paint; revalidate outside the response.
    if (cached.length > 0) {
      trackBackgroundRefresh('repos', refreshRepos(user.token, db, userId))
      return c.json(cached.map(toPublicRepo))
    }

    // Cold mirror: no rows exist yet, so the selector has nothing useful to render.
    const refreshed = await refreshRepos(user.token, db, userId)
    if (!refreshed.ok) return respondError(c, refreshed.failure.status, refreshed.failure.error)
    return c.json(refreshed.value.map(toPublicRepo))
  })
  .post('/refresh', async (c) => {
    const user = getUser(c)

    await getDb(c.env).update(schema.repos).set({ fetchedAt: 0 }).where(eq(schema.repos.userId, user.login))
    return c.body(null, 204)
  })
