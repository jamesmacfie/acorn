import { Hono } from 'hono'
import type { Label } from '@acorn/protocol/api.ts'
import { gh, ghError } from '..'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { ownerId } from '@acorn/node-core/server/middleware/requireUser.ts'
import { respondError } from '@acorn/node-core/server/respond.ts'
import { resolveRepoForUser } from './repoMirror'
import { githubToken } from '../githubToken'
import type { PluginDatabase } from '@acorn/node-core/main/pluginStorage.ts'

type GitHubLabel = {
  name: string
  color: string | null
}

// A FACTORY over this plugin's own database, not a module-scope router reading getDb(c.env). The tables
// live in <data-root>/plugins/github.sqlite now, and `c.env` deliberately carries no per-plugin handles
// (docs/vNext/data.md § Plugin DBs). The handle arrives at plugin init, so no request can reach an
// unmigrated database — and a second startServiceRuntime in one process builds fresh routers over its own
// handle instead of inheriting a closed one.
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
