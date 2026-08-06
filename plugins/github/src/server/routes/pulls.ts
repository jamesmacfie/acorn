import { and, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { pullsResource } from '../resourceKeys'
import { gh, ghError } from '..'
import type { ClosedPullsPage, Pull } from '@acorn/protocol/api.ts'
import type { AppEnv } from '@acorn/node-core/server/middleware/auth.ts'
import { ownerId } from '@acorn/node-core/server/middleware/requireUser.ts'
import { respondError } from '@acorn/node-core/server/respond.ts'
import { type Cached, serveThenRevalidate } from '@acorn/node-core/server/sync/engine.ts'
import { PULLS_STALE_AFTER_MS } from '@acorn/node-core/server/sync/policy.ts'
import { refreshOpenPulls } from './pullRefresh'
import { resolveRepoForUser } from './repoMirror'
import { githubToken } from '../githubToken'
import { pullRequests, syncState } from '../../node/schema'
import type { PluginDatabase } from '@acorn/node-core/main/pluginStorage.ts'
import type { CoreServices } from '@acorn/node-core/main/core/index.ts'

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

// A FACTORY over this plugin's own database, not a module-scope router reading getDb(c.env). The tables
// live in <data-root>/plugins/github.sqlite now, and `c.env` deliberately carries no per-plugin handles
// (docs/vNext/data.md § Plugin DBs). The handle arrives at plugin init, so no request can reach an
// unmigrated database — and a second startServiceRuntime in one process builds fresh routers over its own
// handle instead of inheriting a closed one.
export const pulls = (db: PluginDatabase, core: Pick<CoreServices, 'tasks'>) => new Hono<AppEnv>().get('/:owner/:repo/pulls', async (c) => {
  const uid = ownerId(c)
  const token = await githubToken(c)

  const userId = uid
  const owner = c.req.param('owner')
  const repo = c.req.param('repo')
  // open | closed (closed covers merged — GitHub's list reports merged PRs as "closed").
  const state = c.req.query('state') === 'closed' ? 'closed' : 'open'

  const resolved = await resolveRepoForUser(db, token, userId, owner, repo)
  if (!resolved.ok) return respondError(c, resolved.failure.status, resolved.failure.error)
  const repoId = resolved.value.repoId

  // Closed PRs are historical/effectively-immutable and unbounded — no point mirroring them
  // locally with a short TTL. Proxy GitHub one page at a time; the client load-mores via
  // createInfiniteQuery.
  if (state === 'closed') {
    const page = Math.max(1, Math.trunc(Number(c.req.query('page'))) || 1)
    const res = await gh(
      token,
      `/repos/${owner}/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=${CLOSED_PAGE_SIZE}&page=${page}`,
    )
    const err = ghError(res)
    if (err) return respondError(c, err.status, err.error)
    const body = (await res.json()) as GitHubPull[]
    const hasNext = /\brel="next"/.test(res.headers.get('link') ?? '')
    return c.json({ pulls: body.map(ghToPublic), nextPage: hasNext ? page + 1 : null } satisfies ClosedPullsPage)
  }

  const resource = pullsResource(repoId, 'open')
  const scope = and(
    eq(pullRequests.userId, userId),
    eq(pullRequests.repoId, repoId),
    eq(pullRequests.state, 'open'),
  )

  const readRows = () =>
    db.select().from(pullRequests).where(scope).orderBy(desc(pullRequests.updatedAt))
  const readPublicRows = async () => (await readRows()).map(toPublic)
  const readSync = async () =>
    (await db.select().from(syncState).where(and(eq(syncState.userId, userId), eq(syncState.resource, resource))))[0]

  // Cold only when the list was never fetched (no sync row). A synced-but-empty repo returns
  // `{ data: [], fetchedAt }` so it serves as fresh/stale, never re-blocks.
  const read = async (): Promise<Cached<Pull[]> | null> => {
    const sync = await readSync()
    if (!sync) return null
    return { data: await readPublicRows(), fetchedAt: sync.fetchedAt }
  }

  const refresh = () => refreshOpenPulls(token, db, core, { userId, repoId, owner, repo })

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
const toPublic = (r: typeof pullRequests.$inferSelect) =>
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
