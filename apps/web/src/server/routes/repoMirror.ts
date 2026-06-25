import { and, desc, eq } from 'drizzle-orm'
import { getDb, schema } from '../db'
import { chunkRowsByColumnBudget } from '../db/batch'
import { gh, ghError } from '../github'

// Repo metadata is "slow-changing"; D1 is a user-scoped cache, never the source
// of access truth. Cold misses resolve against GitHub, stale hits serve from D1.
export const REPOS_STALE_AFTER_MS = 300_000

type Db = ReturnType<typeof getDb>
type GitHubFetcher = (token: string, path: string, init?: RequestInit) => Promise<Response>
type WaitUntilContext = { waitUntil(promise: Promise<unknown>): void }
export type RouteFailure = { error: string; status: 401 | 403 | 404 | 429 | 502; detail?: string[] }
export type RouteResult<T> = { ok: true; value: T } | { ok: false; failure: RouteFailure }

type GitHubRepo = {
  id: number
  name: string
  private: boolean
  default_branch: string | null
  pushed_at: string | null
  owner: { login: string }
}

export type ResolvedRepo = { repoId: number; private: boolean }

export const waitUntilLogged = (ctx: WaitUntilContext, label: string, promise: Promise<unknown>) => {
  ctx.waitUntil(promise.catch((error) => console.error(`${label} background refresh failed`, error)))
}

export const readCachedRepos = (db: Db, userId: string) =>
  db.select().from(schema.repos).where(eq(schema.repos.userId, userId)).orderBy(desc(schema.repos.pushedAt))

export const toPublicRepo = (r: {
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

const routeFailureFromGithub = (res: Response): RouteFailure | null => {
  if (res.status === 404) return { error: 'repo_not_found', status: 404 }
  const err = ghError(res)
  if (!err) return null
  if (err.error === 'forbidden') return { error: 'repo_not_found', status: 404 }
  return err
}

const repoRow = (userId: string, repo: GitHubRepo, fetchedAt: number, etag: string | null) => ({
  userId,
  id: repo.id,
  owner: repo.owner.login,
  name: repo.name,
  private: repo.private,
  defaultBranch: repo.default_branch ?? null,
  pushedAt: repo.pushed_at ? Date.parse(repo.pushed_at) : null,
  fetchedAt,
  staleAfter: REPOS_STALE_AFTER_MS,
  etag,
})

export const refreshRepos = async (token: string, db: Db, userId: string, fetcher: GitHubFetcher = gh): Promise<RouteResult<Awaited<ReturnType<typeof readCachedRepos>>>> => {
  const res = await fetcher(token, '/user/repos?sort=pushed&direction=desc&per_page=100')
  const err = ghError(res)
  if (err) return { ok: false, failure: err }

  const etag = res.headers.get('etag')
  const fetchedAt = Date.now()
  const body = (await res.json()) as GitHubRepo[]
  const rows = body.map((repo) => repoRow(userId, repo, fetchedAt, etag))

  const del = db.delete(schema.repos).where(eq(schema.repos.userId, userId))
  const inserts = chunkRowsByColumnBudget(rows).map((part) => db.insert(schema.repos).values(part))
  await db.batch([del, ...inserts])

  return { ok: true, value: rows }
}

export const resolveRepoForUser = async (
  db: Db,
  token: string,
  userId: string,
  owner: string,
  repo: string,
  fetcher: GitHubFetcher = gh,
): Promise<RouteResult<ResolvedRepo>> => {
  const [cached] = await db
    .select({ id: schema.repos.id, private: schema.repos.private })
    .from(schema.repos)
    .where(and(eq(schema.repos.userId, userId), eq(schema.repos.owner, owner), eq(schema.repos.name, repo)))
  if (cached) return { ok: true, value: { repoId: cached.id, private: cached.private } }

  const res = await fetcher(token, `/repos/${owner}/${repo}`)
  const failure = routeFailureFromGithub(res)
  if (failure) return { ok: false, failure }

  const body = (await res.json()) as GitHubRepo
  const row = repoRow(userId, body, Date.now(), res.headers.get('etag'))
  await db
    .insert(schema.repos)
    .values(row)
    .onConflictDoUpdate({
      target: [schema.repos.userId, schema.repos.id],
      set: row,
    })

  return { ok: true, value: { repoId: body.id, private: body.private } }
}
