import { and, eq, max } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb, schema } from '../db'
import type { AppEnv } from '../middleware/auth'
import { getUser } from '../middleware/requireUser'
import { respondError } from '../respond'

// Pinned repos for the selector — app-state, source of truth is us (not GitHub), user-scoped.
// GET returns this user's pinned repo ids (sort ascending); PUT pins/unpins one repo.
export const pins = new Hono<AppEnv>()
  .get('/', async (c) => {
    const user = getUser(c)
    const rows = await getDb(c.env)
      .select({ repoId: schema.pinnedRepos.repoId })
      .from(schema.pinnedRepos)
      .where(eq(schema.pinnedRepos.userId, user.login))
      .orderBy(schema.pinnedRepos.sort)
    return c.json(rows.map((r) => r.repoId))
  })
  .put('/', async (c) => {
    const user = getUser(c)
    const { repoId, pinned } = (await c.req.json().catch(() => ({}))) as { repoId?: number; pinned?: boolean }
    if (typeof repoId !== 'number' || typeof pinned !== 'boolean') return respondError(c, 400, 'bad_request')
    const db = getDb(c.env)
    if (pinned) {
      // Append to the end: next sort = current max + 1 (0 when the user has no pins yet).
      const [{ value }] = await db
        .select({ value: max(schema.pinnedRepos.sort) })
        .from(schema.pinnedRepos)
        .where(eq(schema.pinnedRepos.userId, user.login))
      const sort = (value ?? -1) + 1
      await db.insert(schema.pinnedRepos).values({ userId: user.login, repoId, sort }).onConflictDoNothing()
    } else {
      await db
        .delete(schema.pinnedRepos)
        .where(and(eq(schema.pinnedRepos.userId, user.login), eq(schema.pinnedRepos.repoId, repoId)))
    }
    return c.json({ repoId, pinned })
  })
