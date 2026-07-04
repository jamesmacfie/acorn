import { and, desc, eq, isNull, lt, ne, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb, schema } from '../db'
import { chunkRowsByColumnBudget } from '../db/batch'
import { pullsResource } from '../db/resourceKeys'
import { gh, ghError } from '../github'
import type { AppEnv } from '../middleware/auth'
import { resolveRepoForUser, waitUntilLogged, type RouteResult } from './repoMirror'

// PR list for a repo (docs/caching.md serve-then-revalidate). PR data is "fast-changing":
// short TTL + conditional If-None-Match. The list ETag lives in sync_state (no per-row home);
// 304s are free against the rate limit. Rows are user-scoped (private PRs never cross users).
const STALE_AFTER_MS = 45_000 // ~45s — "fast-changing" list data (docs/caching.md)
const CLOSED_PAGE_SIZE = 50 // closed PRs load on demand, one page at a time (load-more)

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

  const resolved = await resolveRepoForUser(db, user.token, userId, owner, repo)
  if (!resolved.ok) return c.json({ error: resolved.failure.error }, resolved.failure.status)
  const repoId = resolved.value.repoId

  // Closed PRs are historical/effectively-immutable and unbounded — no point mirroring them in D1
  // with a short TTL. Proxy GitHub one page at a time; the client load-mores via createInfiniteQuery.
  if (state === 'closed') {
    const page = Math.max(1, Math.trunc(Number(c.req.query('page'))) || 1)
    const res = await gh(
      user.token,
      `/repos/${owner}/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=${CLOSED_PAGE_SIZE}&page=${page}`,
    )
    if (res.status === 401) return c.json({ error: 'reauth' }, 401)
    const err = ghError(res)
    if (err) return c.json({ error: err.error }, err.status)
    const body = (await res.json()) as GitHubPull[]
    const hasNext = /\brel="next"/.test(res.headers.get('link') ?? '')
    return c.json({ pulls: body.map(ghToPublic), nextPage: hasNext ? page + 1 : null })
  }

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
  const readPublicRows = async () => (await readRows()).map(toPublic)

  const revalidate = async (): Promise<RouteResult<ReturnType<typeof toPublic>[]>> => {
    const res = await gh(user.token, `/repos/${owner}/${repo}/pulls?state=${state}&sort=updated&direction=desc&per_page=100`, {
      headers: sync?.etag ? { 'If-None-Match': sync.etag } : {},
    })
    if (res.status === 401) return { ok: false, failure: { error: 'reauth', status: 401 } }

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
      return { ok: true, value: await readPublicRows() }
    }

    // 401 + 304 already handled above; everything else (rate-limit, SSO, upstream failure) maps here.
    const err = ghError(res)
    if (err) return { ok: false, failure: err }

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
      // Not in the conflict `set` (detail route owns it), but must be a row key: Drizzle binds a
      // param for an omitted NOT NULL-default column, which would desync chunkRowsByColumnBudget's
      // per-row param count and overflow D1's 100-param cap.
      autoMergeEnabled: false,
      fetchedAt: now,
      staleAfter: STALE_AFTER_MS,
      etag: null,
    }))

    // Full-list refresh: upsert list-level fields (preserving detail fields like body fetched by
    // the GraphQL detail route), then prune rows no longer in the list. sync_state last so a
    // mid-upsert failure leaves it stale and the next request retries.
    for (const part of chunkRowsByColumnBudget(rows)) {
      await db.insert(schema.pullRequests).values(part).onConflictDoUpdate({
        target: [schema.pullRequests.userId, schema.pullRequests.repoId, schema.pullRequests.number],
        set: {
          nodeId: sql`excluded.node_id`,
          state: sql`excluded.state`,
          draft: sql`excluded.draft`,
          title: sql`excluded.title`,
          headRef: sql`excluded.head_ref`,
          baseRef: sql`excluded.base_ref`,
          author: sql`excluded.author`,
          updatedAt: sql`excluded.updated_at`,
          fetchedAt: sql`excluded.fetched_at`,
          staleAfter: sql`excluded.stale_after`,
          etag: sql`excluded.etag`,
        },
      })
    }
    await db.delete(schema.pullRequests).where(and(scope, lt(schema.pullRequests.fetchedAt, now)))
    // Flow B (docs/workspaces 02): a local-first task inherits a PR once one is opened for its
    // branch. Match no-pullNumber active tasks for this repo against the just-mirrored headRefs.
    // Machine-scoped table (no userId); keyed by owner/repo name. Cheap: few tasks, runs only
    // on a real list refresh (not 304s).
    const branchToPull = new Map<string, number>()
    for (const p of body) if (p.head?.ref) branchToPull.set(p.head.ref, p.number)
    if (branchToPull.size) {
      const taskRows = await db
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.repoOwner, owner),
            eq(schema.tasks.repoName, repo),
            eq(schema.tasks.status, 'active'),
            isNull(schema.tasks.pullNumber),
          ),
        )
      for (const w of taskRows) {
        const num = branchToPull.get(w.branch)
        if (num != null) await db.update(schema.tasks).set({ pullNumber: num, updatedAt: now }).where(eq(schema.tasks.id, w.id))
      }
    }
    await db
      .insert(schema.syncState)
      .values({ userId, resource, etag, fetchedAt: now })
      .onConflictDoUpdate({
        target: [schema.syncState.userId, schema.syncState.resource],
        set: { etag, fetchedAt: now },
      })

    return { ok: true, value: rows.map(toPublic) }
  }

  const force = c.req.query('force') === 'true'

  // Fresh → serve the mirror, no GitHub call.
  if (!force && sync && sync.fetchedAt + STALE_AFTER_MS > Date.now()) {
    return c.json(await readPublicRows())
  }

  // Stale but cached → serve immediately and revalidate in the background, unless forced.
  if (!force && sync) {
    const cached = await readPublicRows()
    waitUntilLogged(`pulls:${owner}/${repo}`, revalidate())
    return c.json(cached)
  }

  // force=true or no prior sync → block on a real GitHub fetch.
  const refreshed = await revalidate()
  if (!refreshed.ok) return c.json({ error: refreshed.failure.error }, refreshed.failure.status)
  return c.json(refreshed.value)
})

// Same public shape as toPublic, but mapped straight from a GitHub payload (closed path, no mirror row).
const ghToPublic = (p: GitHubPull) => ({
  number: p.number,
  title: p.title,
  state: p.state,
  draft: p.draft,
  author: p.user?.login ?? null,
  headRef: p.head?.ref ?? null,
  baseRef: p.base?.ref ?? null,
  updatedAt: p.updated_at ? Date.parse(p.updated_at) : null,
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
