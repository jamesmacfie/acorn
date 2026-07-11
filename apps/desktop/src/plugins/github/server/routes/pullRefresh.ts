import { and, eq, isNull, lt, sql } from 'drizzle-orm'
import type { AppDatabase } from '../../../../core/server/db'
import { schema } from '../../../../core/server/db'
import { chunkRowsByColumnBudget } from '../../../../core/server/db/batch'
import { pullsResource } from '../../../../core/server/db/resourceKeys'
import type { RefreshResult, RouteResult } from '../../../../core/server/sync/engine'
import { gh, ghError, ghGraphQL, ghGraphQLResult } from '..'
import { fetchFiles, mirrorFiles, mirrorPr, PR_FRAGMENT, type GqlPull, type PatchBlobStore } from './prMirror'

type GitHubFetcher = (token: string, path: string, init?: RequestInit) => Promise<Response>

type GitHubPull = {
  number: number
  node_id: string
  state: string
  draft: boolean
  title: string
  head: { ref: string } | null
  base: { ref: string } | null
  user: { login: string } | null
  updated_at: string | null
}

export type PullRefreshKey = {
  userId: string
  repoId: number
  owner: string
  repo: string
}

const COMPOSITE_QUERY = `
query PR($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) { ...PrFields }
  }
}${PR_FRAGMENT}`

/** Force-refresh the mirrored open-PR list for one repository. */
export async function refreshOpenPulls(
  token: string,
  db: AppDatabase,
  key: PullRefreshKey,
  fetcher: GitHubFetcher = gh,
): Promise<RefreshResult> {
  const { userId, repoId, owner, repo } = key
  const resource = pullsResource(repoId, 'open')
  const [sync] = await db
    .select()
    .from(schema.syncState)
    .where(and(eq(schema.syncState.userId, userId), eq(schema.syncState.resource, resource)))
  const res = await fetcher(token, `/repos/${owner}/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=100`, {
    headers: sync?.etag ? { 'If-None-Match': sync.etag } : {},
  })
  const now = Date.now()

  if (res.status === 304) {
    await db
      .insert(schema.syncState)
      .values({ userId, resource, etag: sync?.etag ?? null, fetchedAt: now })
      .onConflictDoUpdate({ target: [schema.syncState.userId, schema.syncState.resource], set: { fetchedAt: now } })
    return { ok: true }
  }

  const failure = ghError(res)
  if (failure) return { ok: false, failure }

  const etag = res.headers.get('etag')
  const body = (await res.json()) as GitHubPull[]
  const rows = body.map((pull) => ({
    userId,
    repoId,
    number: pull.number,
    nodeId: pull.node_id,
    state: pull.state,
    draft: pull.draft,
    title: pull.title,
    headRef: pull.head?.ref ?? null,
    baseRef: pull.base?.ref ?? null,
    author: pull.user?.login ?? null,
    updatedAt: pull.updated_at ? Date.parse(pull.updated_at) : null,
    autoMergeEnabled: false,
    fetchedAt: now,
  }))

  const branchToPull = new Map<string, number>()
  for (const pull of body) if (pull.head?.ref) branchToPull.set(pull.head.ref, pull.number)
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
  const taskUpdates = taskRows.flatMap((task) => {
    const pullNumber = branchToPull.get(task.branch)
    return pullNumber == null
      ? []
      : [db.update(schema.tasks).set({ pullNumber, updatedAt: now }).where(eq(schema.tasks.id, task.id))]
  })

  await db.batch([
    db
      .insert(schema.syncState)
      .values({ userId, resource, etag, fetchedAt: now })
      .onConflictDoUpdate({
        target: [schema.syncState.userId, schema.syncState.resource],
        set: { etag, fetchedAt: now },
      }),
    ...chunkRowsByColumnBudget(rows).map((part) =>
      db
        .insert(schema.pullRequests)
        .values(part)
        .onConflictDoUpdate({
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
    db
      .delete(schema.pullRequests)
      .where(
        and(
          eq(schema.pullRequests.userId, userId),
          eq(schema.pullRequests.repoId, repoId),
          eq(schema.pullRequests.state, 'open'),
          lt(schema.pullRequests.fetchedAt, now),
        ),
      ),
    ...taskUpdates,
  ])
  return { ok: true }
}

async function fetchPullComposite(
  token: string,
  owner: string,
  repo: string,
  number: number,
): Promise<RouteResult<GqlPull>> {
  const res = await ghGraphQL(token, COMPOSITE_QUERY, { owner, repo, number })
  const result = await ghGraphQLResult<{ repository?: { pullRequest?: GqlPull | null } }>(res)
  if (!result.ok) {
    if (result.kind === 'graphql') {
      console.error('pullDetail GraphQL errors', JSON.stringify(result.messages))
      return { ok: false, failure: { error: 'graphql', status: 502, detail: result.messages } }
    }
    return { ok: false, failure: result.failure }
  }
  const pull = result.data?.repository?.pullRequest
  return pull
    ? { ok: true, value: pull }
    : { ok: false, failure: { error: 'pull_not_found', status: 404 } }
}

/** Force-refresh one PR's GraphQL composite. */
export async function refreshPullDetail(
  token: string,
  db: AppDatabase,
  key: PullRefreshKey & { number: number },
): Promise<RefreshResult> {
  const pull = await fetchPullComposite(token, key.owner, key.repo, key.number)
  if (!pull.ok) return pull
  await mirrorPr(db, { userId: key.userId, repoId: key.repoId, number: key.number }, pull.value, Date.now())
  return { ok: true }
}

/** Force-refresh one PR's composite and changed files, fetching both before mirror writes begin. */
export async function refreshPullWithFiles(
  token: string,
  db: AppDatabase,
  blobs: PatchBlobStore,
  key: PullRefreshKey & { number: number },
): Promise<RefreshResult> {
  const [pull, files] = await Promise.all([
    fetchPullComposite(token, key.owner, key.repo, key.number),
    fetchFiles(token, key.owner, key.repo, key.number),
  ])
  if (!pull.ok) return pull
  if (!files.ok) return files

  const mirrorKey = { userId: key.userId, repoId: key.repoId, number: key.number }
  await mirrorPr(db, mirrorKey, pull.value, Date.now())
  await mirrorFiles(blobs, db, mirrorKey, files.value)
  return { ok: true }
}
