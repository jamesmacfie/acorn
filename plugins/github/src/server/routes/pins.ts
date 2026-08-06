import { and, eq, max } from 'drizzle-orm'
import { Hono } from 'hono'
import type { PluginDatabase } from '@acorn/node-core/main/pluginStorage.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { ownerId } from '@acorn/node-core/server/middleware/requireUser.ts'
import { respondError } from '@acorn/node-core/server/respond.ts'
import { pinnedRepos } from '../../node/schema'

// Pinned repos for the selector — app-state, source of truth is us (not GitHub), user-scoped.
// GET returns this user's pinned repo ids (sort ascending); PUT pins/unpins one repo.
//
// This was CORE's route at /v2/core/pins through Phase 1. It moved here with its table because
// `pinned_repos` is keyed by the numeric GitHub repo id, and nothing outside this mirror can resolve that
// id to a repo — a "pin" in core would have been a core row core could not interpret. The mount is
// /v2/p/github/pins now, and `pinsRoute` in @acorn/protocol moved in the same commit; the repo selector is
// the only caller.
//
// A FACTORY over this plugin's own database, not a module-scope router reading getDb(c.env): the table is
// in <data-root>/plugins/github.sqlite, and `c.env` deliberately carries no per-plugin handles
// (docs/vNext/data.md § Plugin DBs).
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
