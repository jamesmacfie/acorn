import { Hono } from 'hono'
import type { Label } from '../../../../core/shared/api'
import { getDb } from '../../../../core/server/db'
import { gh, ghError } from '..'
import type { AppEnv } from '../../../../core/server/middleware/auth'
import { getUser } from '../../../../core/server/middleware/requireUser'
import { respondError } from '../../../../core/server/respond'
import { resolveRepoForUser } from './repoMirror'

type GitHubLabel = {
  name: string
  color: string | null
}

export const repoLabels = new Hono<AppEnv>().get('/:owner/:repo/labels', async (c) => {
  const user = getUser(c)

  const owner = c.req.param('owner')
  const repo = c.req.param('repo')
  const db = getDb(c.env)
  const resolved = await resolveRepoForUser(db, user.token, user.login, owner, repo)
  if (!resolved.ok) return respondError(c, resolved.failure.status, resolved.failure.error)

  const res = await gh(user.token, `/repos/${owner}/${repo}/labels?per_page=100`)
  const err = ghError(res)
  if (err) return respondError(c, err.status, err.error)

  const labels = ((await res.json()) as GitHubLabel[])
    .map((label): Label => ({ name: label.name, color: label.color }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return c.json(labels)
})
