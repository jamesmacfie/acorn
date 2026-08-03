import { Hono } from 'hono'
import type { Label } from '@acorn/protocol/api.ts'
import { getDb } from '@acorn/node-core/server/db/index.ts'
import { gh, ghError } from '..'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { getUser } from '@acorn/node-core/server/middleware/requireUser.ts'
import { respondError } from '@acorn/node-core/server/respond.ts'
import { resolveRepoForUser } from './repoMirror'
import { githubToken } from '../githubToken'

type GitHubLabel = {
  name: string
  color: string | null
}

export const repoLabels = new Hono<AppEnv>().get('/:owner/:repo/labels', async (c) => {
  const user = getUser(c)
  const token = await githubToken(c)

  const owner = c.req.param('owner')
  const repo = c.req.param('repo')
  const db = getDb(c.env)
  const resolved = await resolveRepoForUser(db, token, user.login, owner, repo)
  if (!resolved.ok) return respondError(c, resolved.failure.status, resolved.failure.error)

  const res = await gh(token, `/repos/${owner}/${repo}/labels?per_page=100`)
  const err = ghError(res)
  if (err) return respondError(c, err.status, err.error)

  const labels = ((await res.json()) as GitHubLabel[])
    .map((label): Label => ({ name: label.name, color: label.color }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return c.json(labels)
})
