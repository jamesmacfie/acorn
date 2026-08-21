import { and, desc, eq } from 'drizzle-orm'
import { chunkRowsByColumnBudget, type PluginDatabase, type RefreshResult, type RouteFailure, type RouteResult } from '@acorn/plugin-api/node'
import { reposResource } from '../resourceKeys'
import { gh, ghError } from '..'
import type { Repo } from '../../contract/api'
import { deleteRepoMirrorStatements } from '../mirrorRetention'
import { repoMatches } from '../repoMatch'
import { repos, syncState } from '../../node/schema'

// Every exported helper here already took the handle as a parameter, which is why this module needed no
// reshaping when the tables moved.
type Db = PluginDatabase
type GitHubFetcher = (token: string, path: string, init?: RequestInit) => Promise<Response>

type GitHubRepo = {
  id: number
  name: string
  private: boolean
  default_branch: string | null
  pushed_at: string | null
  owner: { login: string }
}

export type ResolvedRepo = { repoId: number }

export const readCachedRepos = (db: Db, userId: string) =>
  db.select().from(repos).where(eq(repos.userId, userId)).orderBy(desc(repos.pushedAt))

export const toPublicRepo = (r: {
  id: number
  owner: string
  name: string
  private: boolean
  defaultBranch: string | null
  pushedAt: number | null
}) =>
  ({
    id: r.id,
    owner: r.owner,
    name: r.name,
    private: r.private,
    defaultBranch: r.defaultBranch,
    pushedAt: r.pushedAt,
  }) satisfies Repo

const routeFailureFromGithub = (res: Response): RouteFailure | null => {
  if (res.status === 404) return { error: 'repo_not_found', status: 404 }
  const err = ghError(res)
  if (!err) return null
  // Deliberate fold: a 403 "forbidden" repo is reported as repo_not_found. GitHub itself 404s repos you
  // can't see, so matching that gives the UI one "can't get there" state and avoids confirming that a
  // private repo exists.
  if (err.error === 'forbidden') return { error: 'repo_not_found', status: 404 }
  return err
}

const repoRow = (userId: string, repo: GitHubRepo, fetchedAt: number) => ({
  userId,
  id: repo.id,
  owner: repo.owner.login,
  name: repo.name,
  private: repo.private,
  defaultBranch: repo.default_branch ?? null,
  pushedAt: repo.pushed_at ? Date.parse(repo.pushed_at) : null,
  fetchedAt,
})

// Refresh the user's repo mirror from GitHub, atomically (one db.batch, like mirrorPr). The repos list
// carries an ETag in sync_state, so a 304 costs no rate budget. Returns RouteResult<void>, because the
// sync engine re-reads the mirror after a cold refresh.
export const refreshRepos = async (token: string, db: Db, userId: string, fetcher: GitHubFetcher = gh): Promise<RefreshResult> => {
  const resource = reposResource()
  const [sync] = await db
    .select()
    .from(syncState)
    .where(and(eq(syncState.userId, userId), eq(syncState.resource, resource)))

  const res = await fetcher(token, '/user/repos?sort=pushed&direction=desc&per_page=100', {
    headers: sync?.etag ? { 'If-None-Match': sync.etag } : {},
  })
  const now = Date.now()

  // 304 Not Modified: the mirror is still valid, so bump freshness only. Free against the rate limit.
  if (res.status === 304) {
    await db
      .insert(syncState)
      .values({ userId, resource, etag: sync?.etag ?? null, fetchedAt: now })
      .onConflictDoUpdate({ target: [syncState.userId, syncState.resource], set: { fetchedAt: now } })
    return { ok: true }
  }

  const err = ghError(res)
  if (err) return { ok: false, failure: err }

  const etag = res.headers.get('etag')
  const body = (await res.json()) as GitHubRepo[]
  const previous = await db.select({ id: repos.id }).from(repos).where(eq(repos.userId, userId))
  const retainedIds = new Set(body.map((repo) => repo.id))
  const removedRepoIds = previous.map((repo) => repo.id).filter((id) => !retainedIds.has(id))
  const rows = body.map((repo) => repoRow(userId, repo, now))

  // Full-list replace plus sync bump, all or nothing: a mid-refresh failure leaves the prior mirror and
  // stale sync intact, and the next request retries.
  await db.batch([
    db.delete(repos).where(eq(repos.userId, userId)),
    ...deleteRepoMirrorStatements(db, userId, removedRepoIds),
    ...chunkRowsByColumnBudget(rows).map((part) => db.insert(repos).values(part)),
    db
      .insert(syncState)
      .values({ userId, resource, etag, fetchedAt: now })
      .onConflictDoUpdate({ target: [syncState.userId, syncState.resource], set: { etag, fetchedAt: now } }),
  ])

  return { ok: true }
}

// Read-path repo resolution: a mirror miss falls through to a live GitHub fetch and mirror, so a
// never-seen repo still resolves. Looser than the write path, where resolvePr in prContext.ts is
// mirror-only. A mirror hit is served with no TTL check, because repo rows only refresh via
// refreshRepos, so a renamed or transferred repo resolves to its old repoId until then. Accepted
// staleness (docs/data-layer.md).
export const resolveRepoForUser = async (
  db: Db,
  token: string,
  userId: string,
  owner: string,
  repo: string,
  fetcher: GitHubFetcher = gh,
): Promise<RouteResult<ResolvedRepo>> => {
  const [cached] = await db
    .select({ id: repos.id })
    .from(repos)
    .where(and(eq(repos.userId, userId), repoMatches(owner, repo)))
  if (cached) return { ok: true, value: { repoId: cached.id } }

  const res = await fetcher(token, `/repos/${owner}/${repo}`)
  const failure = routeFailureFromGithub(res)
  if (failure) return { ok: false, failure }

  const body = (await res.json()) as GitHubRepo
  const row = repoRow(userId, body, Date.now())
  await db
    .insert(repos)
    .values(row)
    .onConflictDoUpdate({
      target: [repos.userId, repos.id],
      set: row,
    })

  return { ok: true, value: { repoId: body.id } }
}
