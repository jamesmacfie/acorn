import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb, schema } from '../db'
import type { AppEnv } from '../middleware/auth'

// Participant logins for @-mention autocomplete, read straight from the mirror tables.
export const mentions = new Hono<AppEnv>().get('/:owner/:repo/mentions', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthenticated' }, 401)
  const db = getDb(c.env)
  const owner = c.req.param('owner')!
  const repo = c.req.param('repo')!

  const [repoRow] = await db
    .select({ id: schema.repos.id })
    .from(schema.repos)
    .where(and(eq(schema.repos.userId, user.login), eq(schema.repos.owner, owner), eq(schema.repos.name, repo)))
  if (!repoRow) return c.json([] as string[])

  const rid = repoRow.id
  const uid = user.login

  const [prAuthors, reviewAuthors, commentAuthors, threadAuthors] = await Promise.all([
    db.selectDistinct({ login: schema.pullRequests.author }).from(schema.pullRequests)
      .where(and(eq(schema.pullRequests.userId, uid), eq(schema.pullRequests.repoId, rid))),
    db.selectDistinct({ login: schema.reviews.author }).from(schema.reviews)
      .where(and(eq(schema.reviews.userId, uid), eq(schema.reviews.repoId, rid))),
    db.selectDistinct({ login: schema.comments.author }).from(schema.comments)
      .where(and(eq(schema.comments.userId, uid), eq(schema.comments.repoId, rid))),
    db.selectDistinct({ login: schema.reviewThreads.author }).from(schema.reviewThreads)
      .where(and(eq(schema.reviewThreads.userId, uid), eq(schema.reviewThreads.repoId, rid))),
  ])

  const all = [...prAuthors, ...reviewAuthors, ...commentAuthors, ...threadAuthors]
  const logins = [...new Set(all.map((r) => r.login).filter((l): l is string => !!l))].sort()
  return c.json(logins)
})
