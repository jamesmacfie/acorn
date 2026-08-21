import { Hono } from 'hono'
import { type AppEnv, fileBodyBlobKey, ownerId, type PluginDatabase, respondError } from '@acorn/plugin-api/node'
import { gh, ghError } from '..'
import { resolveRepoForUser } from './repoMirror'
import { githubToken } from '../githubToken'

const decodeBase64 = (content: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(content.replace(/\n/g, '')), (c) => c.charCodeAt(0)))

// Factory over this plugin's own database, not a module-scope router (docs/data-layer.md § Plugin
// databases).
export const pullBlob = (db: PluginDatabase) => new Hono<AppEnv>().get('/:owner/:repo/blobs/:sha', async (c) => {
  const uid = ownerId(c)
  const token = await githubToken(c)

  const userId = uid
  const owner = c.req.param('owner')
  const repo = c.req.param('repo')
  const sha = c.req.param('sha')

  // Same repo resolution as the sibling read routes (pulls/pullDetail/pullFiles): mirror hit, else
  // live fetch + mirror; a private-repo 403 folds to repo_not_found.
  const resolved = await resolveRepoForUser(db, token, userId, owner, repo)
  if (!resolved.ok) return respondError(c, resolved.failure.status, resolved.failure.error)

  const cached = await c.env.BLOBS.get(fileBodyBlobKey(sha))
  if (cached != null) return c.json({ text: cached })

  const res = await gh(token, `/repos/${owner}/${repo}/git/blobs/${sha}`)
  const err = ghError(res)
  if (err) return respondError(c, err.status, err.error)
  const body = (await res.json()) as { content: string; encoding: string }
  const text = body.encoding === 'base64' ? decodeBase64(body.content) : body.content

  await c.env.BLOBS.put(fileBodyBlobKey(sha), text)
  return c.json({ text })
})
