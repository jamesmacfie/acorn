import { and, desc, eq, isNull, lt, ne, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb, schema } from '../db'
import { chunkRowsByColumnBudget } from '../db/batch'
import { pullsResource } from '../db/resourceKeys'
import { gh, ghError } from '../github'
import type { ClosedPullsPage, Pull } from '../../shared/api'
import type { AppEnv } from '../middleware/auth'
import { getUser } from '../middleware/requireUser'
import { respondError } from '../respond'
import { type Cached, type RefreshResult, serveThenRevalidate } from '../sync/engine'
import { PULLS_STALE_AFTER_MS } from '../sync/policy'
import { resolveRepoForUser } from './repoMirror'

// PR list for a repo (docs/caching.md serve-then-revalidate, via server/sync/engine.ts). PR data is
// "fast-changing": short TTL + conditional If-None-Match. The list ETag lives in sync_state (no
// per-row home); 304s are free against the rate limit. Rows are user-scoped (private PRs never
// cross users). The engine owns fresh/stale/cold/dedupe; the ETag/304 branch stays here because it
// is specific to the sync_state ETag store.
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
  const user = getUser(c)

  const db = getDb(c.env)
  const userId = user.login
  const owner = c.req.param('owner')
  const repo = c.req.param('repo')
  // open | closed (closed covers merged — GitHub's list reports merged PRs as "closed").
  const state = c.req.query('state') === 'closed' ? 'closed' : 'open'

  const resolved = await resolveRepoForUser(db, user.token, userId, owner, repo)
  if (!resolved.ok) return respondError(c, resolved.failure.status, resolved.failure.error)
  const repoId = resolved.value.repoId

  // Closed PRs are historical/effectively-immutable and unbounded — no point mirroring them
  // locally with a short TTL. Proxy GitHub one page at a time; the client load-mores via
  // createInfiniteQuery.
  if (state === 'closed') {
    const page = Math.max(1, Math.trunc(Number(c.req.query('page'))) || 1)
    const res = await gh(
      user.token,
      `/repos/${owner}/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=${CLOSED_PAGE_SIZE}&page=${page}`,
    )
    const err = ghError(res)
    if (err) return respondError(c, err.status, err.error)
    const body = (await res.json()) as GitHubPull[]
    const hasNext = /\brel="next"/.test(res.headers.get('link') ?? '')
    return c.json({ pulls: body.map(ghToPublic), nextPage: hasNext ? page + 1 : null } satisfies ClosedPullsPage)
  }

  const resource = pullsResource(repoId, state)

  // Partition open vs closed within the shared table so the two tabs don't clobber each other.
  const stateFilter = state === 'open' ? eq(schema.pullRequests.state, 'open') : ne(schema.pullRequests.state, 'open')
  const scope = and(eq(schema.pullRequests.userId, userId), eq(schema.pullRequests.repoId, repoId), stateFilter)

  const readRows = () =>
    db.select().from(schema.pullRequests).where(scope).orderBy(desc(schema.pullRequests.updatedAt))
  const readPublicRows = async () => (await readRows()).map(toPublic)
  const readSync = async () =>
    (await db.select().from(schema.syncState).where(and(eq(schema.syncState.userId, userId), eq(schema.syncState.resource, resource))))[0]

  // Cold only when the list was never fetched (no sync row). A synced-but-empty repo returns
  // `{ data: [], fetchedAt }` so it serves as fresh/stale, never re-blocks.
  const read = async (): Promise<Cached<Pull[]> | null> => {
    const sync = await readSync()
    if (!sync) return null
    return { data: await readPublicRows(), fetchedAt: sync.fetchedAt }
  }

  const refresh = async (): Promise<RefreshResult> => {
    const sync = await readSync()
    const res = await gh(user.token, `/repos/${owner}/${repo}/pulls?state=${state}&sort=updated&direction=desc&per_page=100`, {
      headers: sync?.etag ? { 'If-None-Match': sync.etag } : {},
    })

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
      return { ok: true }
    }

    // 304 handled above; auth, rate-limit, SSO, and upstream failures all map here.
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
      // per-row param count and overflow the statement's bound-parameter budget (db/batch.ts).
      autoMergeEnabled: false,
      fetchedAt: now,
    }))

    // Flow B (docs/workspaces 02): a local-first task inherits a PR once one is opened for its
    // branch. Match no-pullNumber active tasks for this repo against the just-fetched headRefs.
    // Machine-scoped table (no userId); keyed by owner/repo name. Cheap: few tasks, runs only
    // on a real list refresh (not 304s).
    const branchToPull = new Map<string, number>()
    for (const p of body) if (p.head?.ref) branchToPull.set(p.head.ref, p.number)
    const taskRows = branchToPull.size
      ? await db
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
      : []
    const taskUpdates = taskRows.flatMap((w) => {
      const num = branchToPull.get(w.branch)
      return num != null ? [db.update(schema.tasks).set({ pullNumber: num, updatedAt: now }).where(eq(schema.tasks.id, w.id))] : []
    })

    // Full-list refresh, atomic (one transaction like refreshRepos/mirrorPr): upsert list-level
    // fields (preserving detail fields like body fetched by the GraphQL detail route), prune rows
    // no longer in the list, apply Flow B task updates, and bump sync_state — all or nothing, so
    // a mid-refresh failure leaves the previous mirror + stale sync intact and the next request
    // retries.
    await db.batch([
      db
        .insert(schema.syncState)
        .values({ userId, resource, etag, fetchedAt: now })
        .onConflictDoUpdate({
          target: [schema.syncState.userId, schema.syncState.resource],
          set: { etag, fetchedAt: now },
        }),
      ...chunkRowsByColumnBudget(rows).map((part) =>
        db.insert(schema.pullRequests).values(part).onConflictDoUpdate({
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
          },
        }),
      ),
      db.delete(schema.pullRequests).where(and(scope, lt(schema.pullRequests.fetchedAt, now))),
      ...taskUpdates,
    ])

    // The engine re-reads the mirror after a cold refresh (not the write-shaped `rows`), so the
    // detail-route-owned mergeable/mergeStateStatus the list upsert preserves rides along.
    return { ok: true }
  }

  const result = await serveThenRevalidate({
    resource,
    userId,
    ttlMs: PULLS_STALE_AFTER_MS,
    force: c.req.query('force') === 'true',
    read,
    refresh,
  })
  if (!result.ok) return respondError(c, result.failure.status, result.failure.error, result.failure.detail)
  return c.json(result.value)
})

// Same public shape as toPublic, but mapped straight from a GitHub payload (closed path, no mirror
// row). The closed-list endpoint carries no merge state, so those fields are null/false.
const ghToPublic = (p: GitHubPull) =>
  ({
    number: p.number,
    title: p.title,
    state: p.state,
    draft: p.draft,
    author: p.user?.login ?? null,
    headRef: p.head?.ref ?? null,
    baseRef: p.base?.ref ?? null,
    updatedAt: p.updated_at ? Date.parse(p.updated_at) : null,
    mergeable: null,
    mergeStateStatus: null,
    autoMergeEnabled: false,
  }) satisfies Pull

// Public projection — the fields the SPA PR list needs; no staleness bookkeeping. Reads the full
// mirror row so merge state (owned by the detail route) rides along.
const toPublic = (r: typeof schema.pullRequests.$inferSelect) =>
  ({
    number: r.number,
    title: r.title,
    state: r.state,
    draft: r.draft,
    author: r.author,
    headRef: r.headRef,
    baseRef: r.baseRef,
    updatedAt: r.updatedAt,
    mergeable: r.mergeable,
    mergeStateStatus: r.mergeStateStatus,
    autoMergeEnabled: r.autoMergeEnabled,
  }) satisfies Pull
