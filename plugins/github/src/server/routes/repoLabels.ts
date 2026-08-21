import { Hono } from 'hono'
import type { Label } from '../../contract/api'
import { gh, ghError } from '..'
import { type AppEnv, ownerId, type PluginDatabase, respondError } from '@acorn/plugin-api/node'
import { resolveRepoForUser } from './repoMirror'
import { githubToken } from '../githubToken'

type GitHubLabel = {
  name: string
  color: string | null
}

// Factory over this plugin's own database, not a module-scope router (docs/data-layer.md § Plugin
// databases).
export const repoLabels = (db: PluginDatabase) => new Hono<AppEnv>().get('/:owner/:repo/labels', async (c) => {
  const uid = ownerId(c)
  const token = await githubToken(c)

  const owner = c.req.param('owner')
  const repo = c.req.param('repo')
  const resolved = await resolveRepoForUser(db, token, uid, owner, repo)
  if (!resolved.ok) return respondError(c, resolved.failure.status, resolved.failure.error)

  const res = await gh(token, `/repos/${owner}/${repo}/labels?per_page=100`)
  const err = ghError(res)
  if (err) return respondError(c, err.status, err.error)

  const labels = ((await res.json()) as GitHubLabel[])
    .map((label): Label => ({ name: label.name, color: label.color }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return c.json(labels)
})
