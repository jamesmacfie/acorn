import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb, schema } from '../db'
import { gh } from '../github'
import type { AppEnv } from '../middleware/auth'

// First read path through the D1 mirror (docs/caching.md serve-then-revalidate).
// TTL-only for this slice: freshness is the staleness window; conditional If-None-Match
// revalidation lands with the PR slice. Rows are user-scoped (private repos never cross users).
const STALE_AFTER_MS = 300_000 // ~5 min — repo metadata is "slow-changing" (docs/caching.md)

type GitHubRepo = {
  id: number
  name: string
  private: boolean
  default_branch: string
  pushed_at: string | null
  owner: { login: string }
}

export const repos = new Hono<AppEnv>()
  .get('/', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthenticated' }, 401)

    const db = getDb(c.env)
    const userId = user.login // ponytail: login as the scope key — stable enough; revisit if logins churn.

    const cached = await db
      .select()
      .from(schema.repos)
      .where(eq(schema.repos.userId, userId))
      .orderBy(desc(schema.repos.pushedAt))

    // Fresh if we have rows and the most recent sync is within the staleness window.
    const newest = cached.reduce((max, r) => Math.max(max, r.fetchedAt), 0)
    const fresh = cached.length > 0 && newest + STALE_AFTER_MS > Date.now()
    if (fresh) return c.json(cached.map(toPublic))

    // Stale or missing → re-sync from GitHub. One page of 100, most-recently-pushed first.
    // ponytail: Link-header pagination deferred; the selector wants recent repos anyway.
    const res = await gh(user.token, '/user/repos?sort=pushed&direction=desc&per_page=100')
    if (res.status === 401) return c.json({ error: 'reauth' }, 401)
    if (!res.ok) return c.json({ error: 'github_unavailable' }, 502)
    // ponytail: full error table (SSO 403, rate-limit 429) lands with the PR slice.

    const etag = res.headers.get('etag')
    const fetchedAt = Date.now()
    const body = (await res.json()) as GitHubRepo[]
    const rows = body.map((r) => ({
      userId,
      id: r.id,
      owner: r.owner.login,
      name: r.name,
      private: r.private,
      defaultBranch: r.default_branch ?? null,
      pushedAt: r.pushed_at ? Date.parse(r.pushed_at) : null,
      fetchedAt,
      staleAfter: STALE_AFTER_MS,
      etag,
    }))

    // Full-list refresh: delete-then-insert so repos the user lost access to disappear
    // (docs/data-layer.md batch pattern), atomically in one batch. D1 caps bound params at
    // 100/statement, so chunk inserts: 10 cols × 9 rows = 90 params per insert.
    const del = db.delete(schema.repos).where(eq(schema.repos.userId, userId))
    const inserts = []
    for (let i = 0; i < rows.length; i += 9) {
      inserts.push(db.insert(schema.repos).values(rows.slice(i, i + 9)))
    }
    await db.batch([del, ...inserts])

    return c.json(rows.map(toPublic))
  })
  .post('/refresh', async (c) => {
    const user = c.get('user')
    if (!user) return c.json({ error: 'unauthenticated' }, 401)

    await getDb(c.env).update(schema.repos).set({ fetchedAt: 0 }).where(eq(schema.repos.userId, user.login))
    return c.body(null, 204)
  })

// Public projection — the fields the SPA selector needs; no staleness bookkeeping.
const toPublic = (r: {
  id: number
  owner: string
  name: string
  private: boolean
  defaultBranch: string | null
  pushedAt: number | null
}) => ({
  id: r.id,
  owner: r.owner,
  name: r.name,
  private: r.private,
  defaultBranch: r.defaultBranch,
  pushedAt: r.pushedAt,
})
