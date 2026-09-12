import { and, eq, max } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { type AppEnv, ownerId, type PluginDatabase, respondError } from '@acorn/plugin-api/node'
import { pinnedRepos } from '../../../node/schema'

const pinBody = z.object({ repoId: z.number().int(), pinned: z.boolean() })

export const pins = (db: PluginDatabase) =>
  new Hono<AppEnv>()
    .get('/', async (c) => {
      const uid = ownerId(c)
      const rows = await db
        .select({ repoId: pinnedRepos.repoId })
        .from(pinnedRepos)
        .where(eq(pinnedRepos.userId, uid))
        .orderBy(pinnedRepos.sort)
      return c.json(rows.map((r) => r.repoId))
    })
    .put('/', async (c) => {
      const uid = ownerId(c)
      const parsed = pinBody.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) return respondError(c, 400, 'bad_request')
      const { repoId, pinned } = parsed.data
      if (pinned) {
        // Append to the end: next sort = current max + 1 (0 when the user has no pins yet).
        const [{ value }] = await db
          .select({ value: max(pinnedRepos.sort) })
          .from(pinnedRepos)
          .where(eq(pinnedRepos.userId, uid))
        const sort = (value ?? -1) + 1
        await db.insert(pinnedRepos).values({ userId: uid, repoId, sort }).onConflictDoNothing()
      } else {
        await db.delete(pinnedRepos).where(and(eq(pinnedRepos.userId, uid), eq(pinnedRepos.repoId, repoId)))
      }
      return c.json({ repoId, pinned })
    })
