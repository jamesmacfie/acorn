import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { ownerId } from '@acorn/node-core/server/middleware/requireUser.ts'
import { comments, pullRequests, repos, reviewThreads, reviews } from '../../node/schema'
import type { PluginDatabase } from '@acorn/node-core/main/pluginStorage.ts'

// Participant logins for @-mention autocomplete, read straight from the mirror tables. Mirror-only
// and best-effort: an unmirrored repo yields an empty list (the client just gets no suggestions),
// so this deliberately keeps its own lookup rather than resolveRepoForUser's live-fetch-on-miss.
// A FACTORY over this plugin's own database, not a module-scope router reading getDb(c.env). The tables
// live in <data-root>/plugins/github.sqlite now, and `c.env` deliberately carries no per-plugin handles
// (docs/data-layer.md § Plugin DBs). The handle arrives at plugin init, so no request can reach an
// unmigrated database — and a second startServiceRuntime in one process builds fresh routers over its own
// handle instead of inheriting a closed one.
export const mentions = (db: PluginDatabase) => new Hono<AppEnv>().get('/:owner/:repo/mentions', async (c) => {
  const uid = ownerId(c)
  const owner = c.req.param('owner')!
  const repo = c.req.param('repo')!

  const [repoRow] = await db
    .select({ id: repos.id })
    .from(repos)
    .where(and(eq(repos.userId, uid), eq(repos.owner, owner), eq(repos.name, repo)))
  if (!repoRow) return c.json([] as string[])

  const rid = repoRow.id

  const [prAuthors, reviewAuthors, commentAuthors, threadAuthors] = await Promise.all([
    db.selectDistinct({ login: pullRequests.author }).from(pullRequests)
      .where(and(eq(pullRequests.userId, uid), eq(pullRequests.repoId, rid))),
    db.selectDistinct({ login: reviews.author }).from(reviews)
      .where(and(eq(reviews.userId, uid), eq(reviews.repoId, rid))),
    db.selectDistinct({ login: comments.author }).from(comments)
      .where(and(eq(comments.userId, uid), eq(comments.repoId, rid))),
    db.selectDistinct({ login: reviewThreads.author }).from(reviewThreads)
      .where(and(eq(reviewThreads.userId, uid), eq(reviewThreads.repoId, rid))),
  ])

  const all = [...prAuthors, ...reviewAuthors, ...commentAuthors, ...threadAuthors]
  const logins = [...new Set(all.map((r) => r.login).filter((l): l is string => !!l))].sort()
  return c.json(logins)
})
