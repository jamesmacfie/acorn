import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb, schema } from '../db'
import { filesResource } from '../db/resourceKeys'
import { ghError } from '../github'
import type { AppEnv } from '../middleware/auth'
import { fetchFiles, mirrorFiles, readFiles, STALE_AFTER_MS } from './prMirror'

// PR changed-files + patches. REST /pulls/{n}/files is the single writer of pr_files (it carries
// path/status/+/−/sha/patch in one call — richer than the GraphQL composite, which dropped files).
// Mirror logic is shared with the batch route — see prMirror.ts.
export const pullFiles = new Hono<AppEnv>().get('/:owner/:repo/pulls/:number/files', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthenticated' }, 401)

  const db = getDb(c.env)
  const userId = user.login
  const owner = c.req.param('owner')
  const repo = c.req.param('repo')
  const number = Number(c.req.param('number'))
  if (!Number.isInteger(number)) return c.json({ error: 'bad_number' }, 400)

  const [repoRow] = await db
    .select({ id: schema.repos.id, private: schema.repos.private })
    .from(schema.repos)
    .where(and(eq(schema.repos.userId, userId), eq(schema.repos.owner, owner), eq(schema.repos.name, repo)))
  if (!repoRow) return c.json({ error: 'repo_not_found' }, 404)
  const { id: repoId, private: isPrivate } = repoRow
  const key = { userId, repoId, number }

  const [sync] = await db
    .select()
    .from(schema.syncState)
    .where(and(eq(schema.syncState.userId, userId), eq(schema.syncState.resource, filesResource(repoId, number))))
  if (sync && sync.fetchedAt + STALE_AFTER_MS > Date.now()) return c.json(await readFiles(c.env, db, key))

  const { res, body } = await fetchFiles(user.token, owner, repo, number)
  const err = ghError(res)
  if (err) return c.json({ error: err.error }, err.status)
  await mirrorFiles(c.env, db, key, isPrivate, body ?? [])
  return c.json(await readFiles(c.env, db, key))
})
