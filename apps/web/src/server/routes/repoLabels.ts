import { Hono } from 'hono'
import type { Label } from '../../shared/api'
import { getDb } from '../db'
import { gh, ghError } from '../github'
import type { AppEnv } from '../middleware/auth'
import { resolveRepoForUser } from './repoMirror'

type GitHubLabel = {
  name: string
  color: string | null
}

export const repoLabels = new Hono<AppEnv>().get('/:owner/:repo/labels', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthenticated' }, 401)

  const owner = c.req.param('owner')
  const repo = c.req.param('repo')
  const db = getDb(c.env)
  const resolved = await resolveRepoForUser(db, user.token, user.login, owner, repo)
  if (!resolved.ok) return c.json({ error: resolved.failure.error }, resolved.failure.status)

  const res = await gh(user.token, `/repos/${owner}/${repo}/labels?per_page=100`)
  const err = ghError(res)
  if (err) return c.json({ error: err.error }, err.status)

  const labels = ((await res.json()) as GitHubLabel[])
    .map((label): Label => ({ name: label.name, color: label.color }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return c.json(labels)
})
