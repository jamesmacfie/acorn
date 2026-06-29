import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb, schema } from '../db'
import { gh, ghError } from '../github'
import type { AppEnv } from '../middleware/auth'

// Full file body at an immutable blob sha — used to expand unchanged context around diff hunks.
// The sha keys an immutable object, so bodies cache forever (mirrors the patch:<sha> pattern in
// prMirror.ts). The BLOBS cache is a local per-user on-disk dir, so private bodies are cached too
// — the public/private split only mattered for Workers' shared KV (docs/electron.md §5).
const blobKey = (sha: string) => `filebody:${sha}`

const decodeBase64 = (content: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(content.replace(/\n/g, '')), (c) => c.charCodeAt(0)))

export const pullBlob = new Hono<AppEnv>().get('/:owner/:repo/blobs/:sha', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthenticated' }, 401)

  const db = getDb(c.env)
  const userId = user.login
  const owner = c.req.param('owner')
  const repo = c.req.param('repo')
  const sha = c.req.param('sha')

  const [repoRow] = await db
    .select({ id: schema.repos.id })
    .from(schema.repos)
    .where(and(eq(schema.repos.userId, userId), eq(schema.repos.owner, owner), eq(schema.repos.name, repo)))
  if (!repoRow) return c.json({ error: 'repo_not_found' }, 404)

  const cached = await c.env.BLOBS.get(blobKey(sha))
  if (cached != null) return c.json({ text: cached })

  const res = await gh(user.token, `/repos/${owner}/${repo}/git/blobs/${sha}`)
  const err = ghError(res)
  if (err) return c.json({ error: err.error }, err.status)
  const body = (await res.json()) as { content: string; encoding: string }
  const text = body.encoding === 'base64' ? decodeBase64(body.content) : body.content

  await c.env.BLOBS.put(blobKey(sha), text)
  return c.json({ text })
})
