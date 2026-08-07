import { and, eq, max } from 'drizzle-orm'
import { Hono } from 'hono'
import type { PluginDatabase } from '@acorn/node-core/main/pluginStorage.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { ownerId } from '@acorn/node-core/server/middleware/requireUser.ts'
import { respondError } from '@acorn/node-core/server/respond.ts'
import { pinnedRepos } from '../../node/schema'

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
      const { repoId, pinned } = (await c.req.json().catch(() => ({}))) as { repoId?: number; pinned?: boolean }
      if (typeof repoId !== 'number' || typeof pinned !== 'boolean') return respondError(c, 400, 'bad_request')
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
