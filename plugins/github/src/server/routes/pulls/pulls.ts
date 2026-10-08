import { and, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { pullsResource } from '../../resourceKeys'
import { gh, ghError } from '../../githubApi'
import type { ClosedPullsPage, Pull, PullSearchPage } from '../../../shared/api'
import { MAX_COMMAND_SEARCH_QUERY } from '@acorn/protocol/commands.ts'
import { type AppEnv, type Cached, type CoreServices, ownerId, type PluginDatabase, respondError, serveThenRevalidate } from '@acorn/plugin-api/node'
import { PULLS_STALE_AFTER_MS } from '../../syncPolicy'
import { refreshOpenPulls } from './pullRefresh'
import { type GithubEmit, NO_EMIT } from '../../events'
import { resolveRepoForUser } from '../mirror/repoMirror'
import { githubToken } from '../../githubToken'
import { pullRequests, syncState } from '../../../node/schema'

// PR list for a repo (docs/caching.md serve-then-revalidate, via server/sync/engine.ts). PR data is
// "fast-changing": short TTL + conditional If-None-Match. The list ETag lives in sync_state (no
// per-row home); 304s are free against the rate limit. Rows are user-scoped (private PRs never
// cross users). The engine owns fresh/stale/cold/dedupe; the ETag/304 branch stays here because it
// is specific to the sync_state ETag store.
const CLOSED_PAGE_SIZE = 50 // closed PRs load on demand, one page at a time (load-more)
const SEARCH_PAGE_SIZE = 50

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

// Factory over this plugin's own database, not a module-scope router (docs/data-layer/plugin-databases.md § Plugin
// databases).
export const pulls = (db: PluginDatabase, core: Pick<CoreServices, 'tasks'>, emit: GithubEmit = NO_EMIT) => new Hono<AppEnv>().get('/:owner/:repo/pulls', async (c) => {
  const uid = ownerId(c)
  const token = await githubToken(c)

  const userId = uid
  const owner = c.req.param('owner')
  const repo = c.req.param('repo')
  // open | closed (closed covers merged, since GitHub's list reports merged PRs as "closed").
  const state = c.req.query('state') === 'closed' ? 'closed' : 'open'

  const resolved = await resolveRepoForUser(db, token, userId, owner, repo, { emit })
  if (!resolved.ok) return respondError(c, resolved.failure.status, resolved.failure.error)
  const repoId = resolved.value.repoId

  // Closed PRs are historical, effectively immutable, and unbounded. No point mirroring them
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

  const refresh = () => refreshOpenPulls(token, db, core, { userId, repoId, owner, repo }, undefined, emit)

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
  // The list's Search field: GitHub's search within this repository and the selected tab, so it finds
  // pull requests past the loaded pages (docs/github-integration/surfaces.md § Searching pull requests).
  // Registered before `pullDetail`, whose `/pulls/:number` would otherwise claim `search`.
  .get('/:owner/:repo/pulls/search', async (c) => {
    const token = await githubToken(c)
    const userId = ownerId(c)
    const owner = c.req.param('owner')
    const repo = c.req.param('repo')
    const state = c.req.query('state') === 'closed' ? 'closed' : 'open'
    const text = (c.req.query('q') ?? '').trim().slice(0, MAX_COMMAND_SEARCH_QUERY)
    if (!text) return c.json({ pulls: [], total: 0, incomplete: false } satisfies PullSearchPage)

    const resolved = await resolveRepoForUser(db, token, userId, owner, repo, { emit })
    if (!resolved.ok) return respondError(c, resolved.failure.status, resolved.failure.error)

    // A pasted number is a lookup, not a search. A miss, or a pull in the other tab, falls through to
    // text, since the digits may be in a title.
    const number = /^#?(\d{1,9})$/.exec(text)?.[1]
    if (number) {
      const res = await gh(token, `/repos/${owner}/${repo}/pulls/${number}`)
      if (res.ok) {
        const pull = ghToPublic((await res.json()) as GitHubPull)
        if (pull.state === state) return c.json({ pulls: [pull], total: 1, incomplete: false } satisfies PullSearchPage)
      }
    }

    const res = await gh(token, `/search/issues?q=${encodeURIComponent(pullSearchQuery(owner, repo, state, text))}`
      + `&sort=updated&order=desc&per_page=${SEARCH_PAGE_SIZE}`)
    const err = ghError(res)
    if (err) return respondError(c, err.status, err.error)
    const body = (await res.json()) as { total_count?: number; incomplete_results?: boolean; items?: GitHubSearchHit[] }
    const pulls = (body.items ?? []).map(searchHitToPublic)
    const total = body.total_count ?? pulls.length
    return c.json({ pulls, total, incomplete: body.incomplete_results === true || total > pulls.length } satisfies PullSearchPage)
  })

/**
 * The search expression. The repository, `is:pr` and the state come from the route, never from the
 * reader. Each typed word is quoted, so a word like `repo:other/name` or `is:merged` is text to match
 * rather than a qualifier that could widen or change the scope.
 */
export const pullSearchQuery = (owner: string, repo: string, state: 'open' | 'closed', text: string): string => {
  const words = text.split(/\s+/).map((word) => word.replace(/["\\]/g, '')).filter(Boolean)
  return [...words.map((word) => `"${word}"`), `repo:${owner}/${repo}`, 'is:pr', `is:${state}`].join(' ')
}

// What `/search/issues` answers for a pull request. No branches: those are on the pull itself.
type GitHubSearchHit = {
  number: number
  title: string
  state: string
  draft?: boolean
  user: { login: string } | null
  updated_at: string | null
}

const searchHitToPublic = (hit: GitHubSearchHit) =>
  ({
    number: hit.number,
    title: hit.title,
    state: hit.state,
    draft: hit.draft === true,
    author: hit.user?.login ?? null,
    headRef: null,
    baseRef: null,
    updatedAt: hit.updated_at ? Date.parse(hit.updated_at) : null,
    mergeable: null,
    mergeStateStatus: null,
    autoMergeEnabled: false,
  }) satisfies Pull

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

// Public projection: the fields the SPA PR list needs; no staleness bookkeeping. Reads the full
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
