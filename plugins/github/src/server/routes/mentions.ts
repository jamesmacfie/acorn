import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { type AppEnv, ownerId, type PluginDatabase } from '@acorn/plugin-api/node'
import { comments, pullRequests, repos, reviewThreads, reviews } from '../../node/schema'
import { repoMatches } from '../repoMatch'

// Participant logins for @-mention autocomplete, read straight from the mirror tables. Mirror-only and
// best-effort: an unmirrored repo yields an empty list, so the client just gets no suggestions, which is
// why this keeps its own lookup rather than resolveRepoForUser's live-fetch-on-miss.
//
// Factory over this plugin's own database, not a module-scope router (docs/data-layer.md § Plugin
// databases).
export const mentions = (db: PluginDatabase) => new Hono<AppEnv>().get('/:owner/:repo/mentions', async (c) => {
  const uid = ownerId(c)
  const owner = c.req.param('owner')!
  const repo = c.req.param('repo')!

  const [repoRow] = await db
    .select({ id: repos.id })
    .from(repos)
    .where(and(eq(repos.userId, uid), repoMatches(owner, repo)))
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
