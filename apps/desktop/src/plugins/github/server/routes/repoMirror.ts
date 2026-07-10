import { and, desc, eq } from 'drizzle-orm'
import { getDb, schema } from '../../../../core/server/db'
import { chunkRowsByColumnBudget } from '../../../../core/server/db/batch'
import { reposResource } from '../../../../core/server/db/resourceKeys'
import { gh, ghError } from '..'
import type { RefreshResult, RouteFailure, RouteResult } from '../../../../core/server/sync/engine'
import type { Repo } from '../../../../core/shared/api'

// Failure/result taxonomy now lives with the sync engine (the shared flow layer); re-exported here
// so the pulls / pullDetail / pullFiles / prMirror routes keep importing it from repoMirror.
export type { RouteFailure, RouteResult } from '../../../../core/server/sync/engine'

type Db = ReturnType<typeof getDb>
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
  db.select().from(schema.repos).where(eq(schema.repos.userId, userId)).orderBy(desc(schema.repos.pushedAt))

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
  // Deliberate fold: a 403 "forbidden" repo is reported as repo_not_found. GitHub itself 404s
  // repos you can't see; matching that gives the UI one "can't get there" state and avoids
  // confirming that a private repo exists. Revisit only if the UI ever wants a distinct
  // "no access" message.
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

// Refresh the user's repo mirror from GitHub, atomically (one db.batch, like mirrorPr). The repos
// list carries an ETag in sync_state (`repos`), so a 304 costs no rate budget — just bump freshness
// and keep the mirror. Returns RouteResult<void>: the sync engine re-reads the mirror after a cold
// refresh, so there is no value to hand back.
export const refreshRepos = async (token: string, db: Db, userId: string, fetcher: GitHubFetcher = gh): Promise<RefreshResult> => {
  const resource = reposResource()
  const [sync] = await db
    .select()
    .from(schema.syncState)
    .where(and(eq(schema.syncState.userId, userId), eq(schema.syncState.resource, resource)))

  const res = await fetcher(token, '/user/repos?sort=pushed&direction=desc&per_page=100', {
    headers: sync?.etag ? { 'If-None-Match': sync.etag } : {},
  })
  const now = Date.now()

  // 304 Not Modified → mirror still valid; bump freshness only (free against the rate limit).
  if (res.status === 304) {
    await db
      .insert(schema.syncState)
      .values({ userId, resource, etag: sync?.etag ?? null, fetchedAt: now })
      .onConflictDoUpdate({ target: [schema.syncState.userId, schema.syncState.resource], set: { fetchedAt: now } })
    return { ok: true }
  }

  const err = ghError(res)
  if (err) return { ok: false, failure: err }

  const etag = res.headers.get('etag')
  const body = (await res.json()) as GitHubRepo[]
  const rows = body.map((repo) => repoRow(userId, repo, now))

  // Full-list replace + sync bump, all-or-nothing: a mid-refresh failure leaves the prior mirror and
  // stale sync intact, and the next request retries.
  await db.batch([
    db.delete(schema.repos).where(eq(schema.repos.userId, userId)),
    ...chunkRowsByColumnBudget(rows).map((part) => db.insert(schema.repos).values(part)),
    db
      .insert(schema.syncState)
      .values({ userId, resource, etag, fetchedAt: now })
      .onConflictDoUpdate({ target: [schema.syncState.userId, schema.syncState.resource], set: { etag, fetchedAt: now } }),
  ])

  return { ok: true }
}

// Read-path repo resolution: a mirror miss falls through to a live GitHub fetch (+ mirror), so a
// never-seen repo still resolves. Deliberately looser than the write path — resolvePr in
// prContext.ts is mirror-only, so PR writes require a previously-mirrored repo (see the note
// there). A mirror HIT is served with no TTL check: repo rows only refresh via the repos-list
// refresh (refreshRepos), so a renamed/transferred repo resolves to its old repoId until then —
// accepted staleness (docs/data-layer.md).
export const resolveRepoForUser = async (
  db: Db,
  token: string,
  userId: string,
  owner: string,
  repo: string,
  fetcher: GitHubFetcher = gh,
): Promise<RouteResult<ResolvedRepo>> => {
  const [cached] = await db
    .select({ id: schema.repos.id })
    .from(schema.repos)
    .where(and(eq(schema.repos.userId, userId), eq(schema.repos.owner, owner), eq(schema.repos.name, repo)))
  if (cached) return { ok: true, value: { repoId: cached.id } }

  const res = await fetcher(token, `/repos/${owner}/${repo}`)
  const failure = routeFailureFromGithub(res)
  if (failure) return { ok: false, failure }

  const body = (await res.json()) as GitHubRepo
  const row = repoRow(userId, body, Date.now())
  await db
    .insert(schema.repos)
    .values(row)
    .onConflictDoUpdate({
      target: [schema.repos.userId, schema.repos.id],
      set: row,
    })

  return { ok: true, value: { repoId: body.id } }
}
