import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb, schema } from '../db'
import { gh } from '../github'
import type { AppEnv } from '../middleware/auth'

// PR changed-files + patches. REST /pulls/{n}/files is the single writer of pr_files (it carries
// path/status/+/−/sha/patch in one call — richer than the GraphQL composite, which dropped files).
// Patch bodies are immutable by sha (docs/caching.md): public → shared KV by sha; private → D1.
const STALE_AFTER_MS = 45_000

type GitHubFile = {
  filename: string
  status: string
  additions: number
  deletions: number
  sha: string
  patch?: string // omitted for binary / too-large / pure-rename files
}

const blobKey = (sha: string) => `patch:${sha}`

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

  const fileWhere = and(eq(schema.prFiles.userId, userId), eq(schema.prFiles.repoId, repoId), eq(schema.prFiles.number, number))

  // Resolve a row's patch: private bodies live in D1, public bodies in shared KV by sha.
  const withPatch = async (f: typeof schema.prFiles.$inferSelect) => ({
    path: f.path,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    sha: f.sha,
    patch: f.patch ?? (f.sha ? await c.env.BLOBS.get(blobKey(f.sha)) : null),
  })
  const readFiles = async () => Promise.all((await db.select().from(schema.prFiles).where(fileWhere)).map(withPatch))

  const resource = `files:${repoId}:${number}`
  const [sync] = await db
    .select()
    .from(schema.syncState)
    .where(and(eq(schema.syncState.userId, userId), eq(schema.syncState.resource, resource)))
  if (sync && sync.fetchedAt + STALE_AFTER_MS > Date.now()) return c.json(await readFiles())

  const res = await gh(user.token, `/repos/${owner}/${repo}/pulls/${number}/files?per_page=100`)
  if (res.status === 401) return c.json({ error: 'reauth' }, 401)
  if (!res.ok) return c.json({ error: 'github_unavailable' }, 502)
  // ponytail: first 100 files — Link-header pagination deferred.
  const body = (await res.json()) as GitHubFile[]
  const now = Date.now()

  // Public patches → KV (shared, immutable by sha); the D1 row keeps patch null for public.
  if (!isPrivate) {
    await Promise.all(body.filter((f) => f.patch != null).map((f) => c.env.BLOBS.put(blobKey(f.sha), f.patch as string)))
  }

  const rows = body.map((f) => ({
    userId,
    repoId,
    number,
    path: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    sha: f.sha,
    patch: isPrivate ? (f.patch ?? null) : null,
  }))

  // Full-list refresh. One insert per file — patches are large; a multi-row statement risks
  // the D1 statement-size limit. ponytail: per-row insert, revisit only if file counts explode.
  await db.batch([
    db.delete(schema.prFiles).where(fileWhere),
    ...rows.map((r) => db.insert(schema.prFiles).values(r)),
    db
      .insert(schema.syncState)
      .values({ userId, resource, etag: null, fetchedAt: now })
      .onConflictDoUpdate({ target: [schema.syncState.userId, schema.syncState.resource], set: { fetchedAt: now } }),
  ])

  return c.json(await readFiles())
})
