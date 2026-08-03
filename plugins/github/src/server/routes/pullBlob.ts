import { Hono } from 'hono'
import { fileBodyBlobKey } from '@acorn/node-core/server/blobs.ts'
import { getDb } from '@acorn/node-core/server/db/index.ts'
import { gh, ghError } from '..'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { ownerId } from '@acorn/node-core/server/middleware/requireUser.ts'
import { respondError } from '@acorn/node-core/server/respond.ts'
import { resolveRepoForUser } from './repoMirror'
import { githubToken } from '../githubToken'

// Full file body at an immutable blob sha — used to expand unchanged context around diff hunks.
// The sha keys immutable content, so bodies cache forever in the local on-disk BLOBS dir
// (key format in server/blobs.ts, next to the patch:<sha> keys prMirror writes).

const decodeBase64 = (content: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(content.replace(/\n/g, '')), (c) => c.charCodeAt(0)))

export const pullBlob = new Hono<AppEnv>().get('/:owner/:repo/blobs/:sha', async (c) => {
  const uid = ownerId(c)
  const token = await githubToken(c)

  const db = getDb(c.env)
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
