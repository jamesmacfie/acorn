import { and, desc, eq, ne } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb, schema } from '../db'
import { chunkRowsByColumnBudget } from '../db/batch'
import { pullsResource } from '../db/resourceKeys'
import { gh, ghError } from '../github'
import type { AppEnv } from '../middleware/auth'

// PR list for a repo (docs/caching.md serve-then-revalidate). PR data is "fast-changing":
// short TTL + conditional If-None-Match. The list ETag lives in sync_state (no per-row home);
// 304s are free against the rate limit. Rows are user-scoped (private PRs never cross users).
const STALE_AFTER_MS = 45_000 // ~45s — "fast-changing" list data (docs/caching.md)

type GitHubPull = {
  number: number
  node_id: string
  state: string
  draft: boolean
  title: string
  head: { ref: string }
  base: { ref: string }
  user: { login: string } | null
  updated_at: string | null
}

export const pulls = new Hono<AppEnv>().get('/:owner/:repo/pulls', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: 'unauthenticated' }, 401)

  const db = getDb(c.env)
  const userId = user.login
  const owner = c.req.param('owner')
  const repo = c.req.param('repo')
  // open | closed (closed covers merged — GitHub's list reports merged PRs as "closed").
  const state = c.req.query('state') === 'closed' ? 'closed' : 'open'

  // Resolve the GitHub repo id from this user's repos mirror. The client only requests repos
  // already in its loaded list, so a miss means a cold/invalid URL.
  const [repoRow] = await db
    .select({ id: schema.repos.id })
    .from(schema.repos)
    .where(and(eq(schema.repos.userId, userId), eq(schema.repos.owner, owner), eq(schema.repos.name, repo)))
  if (!repoRow) return c.json({ error: 'repo_not_found' }, 404)
  const repoId = repoRow.id

  const resource = pullsResource(repoId, state)
  const [sync] = await db
    .select()
    .from(schema.syncState)
    .where(and(eq(schema.syncState.userId, userId), eq(schema.syncState.resource, resource)))

  // Partition open vs closed within the shared table so the two tabs don't clobber each other.
  const stateFilter = state === 'open' ? eq(schema.pullRequests.state, 'open') : ne(schema.pullRequests.state, 'open')
  const scope = and(eq(schema.pullRequests.userId, userId), eq(schema.pullRequests.repoId, repoId), stateFilter)

  const readRows = () =>
    db.select().from(schema.pullRequests).where(scope).orderBy(desc(schema.pullRequests.updatedAt))

  // Fresh → serve the mirror, no GitHub call.
  if (sync && sync.fetchedAt + STALE_AFTER_MS > Date.now()) {
    return c.json((await readRows()).map(toPublic))
  }

  // Stale/missing → revalidate conditionally.
  const res = await gh(user.token, `/repos/${owner}/${repo}/pulls?state=${state}&sort=updated&direction=desc&per_page=100`, {
    headers: sync?.etag ? { 'If-None-Match': sync.etag } : {},
  })
  if (res.status === 401) return c.json({ error: 'reauth' }, 401)

  const now = Date.now()

  // 304 Not Modified → mirror is still valid; just bump freshness (free, no rate cost).
  if (res.status === 304) {
    await db
      .insert(schema.syncState)
      .values({ userId, resource, etag: sync?.etag ?? null, fetchedAt: now })
      .onConflictDoUpdate({
        target: [schema.syncState.userId, schema.syncState.resource],
        set: { fetchedAt: now },
      })
    return c.json((await readRows()).map(toPublic))
  }

  // 401 + 304 already handled above; everything else (rate-limit, SSO, upstream failure) maps here.
  const err = ghError(res)
  if (err) return c.json({ error: err.error }, err.status)

  const etag = res.headers.get('etag')
  const body = (await res.json()) as GitHubPull[]
  const rows = body.map((p) => ({
    userId,
    repoId,
    number: p.number,
    nodeId: p.node_id,
    state: p.state,
    draft: p.draft,
    title: p.title,
    headRef: p.head?.ref ?? null,
    baseRef: p.base?.ref ?? null,
    author: p.user?.login ?? null,
    updatedAt: p.updated_at ? Date.parse(p.updated_at) : null,
    fetchedAt: now,
    staleAfter: STALE_AFTER_MS,
    etag: null, // collection freshness lives in sync_state; per-row etag earns its keep at single-PR revalidation.
  }))

  // Full-list refresh: delete-then-insert so closed/merged PRs drop out, plus the sync_state
  // upsert, atomically in one batch. D1 caps bound params at 100/statement.
  const ops = chunkRowsByColumnBudget(rows).map((part) => db.insert(schema.pullRequests).values(part))
  await db.batch([
    db.delete(schema.pullRequests).where(scope),
    db
      .insert(schema.syncState)
      .values({ userId, resource, etag, fetchedAt: now })
      .onConflictDoUpdate({
        target: [schema.syncState.userId, schema.syncState.resource],
        set: { etag, fetchedAt: now },
      }),
    ...ops,
  ])

  return c.json(rows.map(toPublic))
})

// Public projection — the fields the SPA PR list needs; no staleness bookkeeping.
const toPublic = (r: {
  number: number
  title: string
  state: string
  draft: boolean
  author: string | null
  headRef: string | null
  baseRef: string | null
  updatedAt: number | null
}) => ({
  number: r.number,
  title: r.title,
  state: r.state,
  draft: r.draft,
  author: r.author,
  headRef: r.headRef,
  baseRef: r.baseRef,
  updatedAt: r.updatedAt,
})
