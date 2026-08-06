import { and, eq, isNull, sql } from 'drizzle-orm'
import { chunkRowsByColumnBudget } from '@acorn/node-core/server/rows.ts'
import { pullsResource } from '../resourceKeys'
import type { RefreshResult, RouteResult } from '@acorn/node-core/server/sync/engine.ts'
import { gh, ghError, ghGraphQL, ghGraphQLResult } from '..'
import { fetchFiles, mirrorFiles, mirrorPr, PR_FRAGMENT, type GqlPull, type PatchBlobStore } from './prMirror'
import { deletePullMirrorStatements } from '../mirrorRetention'
import { pullRequests, syncState } from '../../node/schema'
import type { PluginDatabase } from '@acorn/node-core/main/pluginStorage.ts'
import type { CoreServices } from '@acorn/node-core/main/core/index.ts'

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
  db: PluginDatabase,
  core: Pick<CoreServices, 'tasks'>,
  key: PullRefreshKey,
  fetcher: GitHubFetcher = gh,
): Promise<RefreshResult> {
  const { userId, repoId, owner, repo } = key
  const resource = pullsResource(repoId, 'open')
  const [sync] = await db
    .select()
    .from(syncState)
    .where(and(eq(syncState.userId, userId), eq(syncState.resource, resource)))
  const res = await fetcher(token, `/repos/${owner}/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=100`, {
    headers: sync?.etag ? { 'If-None-Match': sync.etag } : {},
  })
  const now = Date.now()

  if (res.status === 304) {
    await db
      .insert(syncState)
      .values({ userId, resource, etag: sync?.etag ?? null, fetchedAt: now })
      .onConflictDoUpdate({ target: [syncState.userId, syncState.resource], set: { fetchedAt: now } })
    return { ok: true }
  }

  const failure = ghError(res)
  if (failure) return { ok: false, failure }

  const etag = res.headers.get('etag')
  const body = (await res.json()) as GitHubPull[]
  const retainedNumbers = new Set(body.map((pull) => pull.number))
  const removedPulls = (
    await db
      .select({ userId: pullRequests.userId, repoId: pullRequests.repoId, number: pullRequests.number })
      .from(pullRequests)
      .where(
        and(
          eq(pullRequests.userId, userId),
          eq(pullRequests.repoId, repoId),
          eq(pullRequests.state, 'open'),
        ),
      )
  ).filter((pull) => !retainedNumbers.has(pull.number))
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

  // Branch → PR for adopting a PR into a local-first task (Flow B). The adoption itself is CORE's write —
  // `tasks` is core's table, in core's SQLite file — so it can no longer ride in the mirror's `db.batch`
  // the way it used to. It runs AFTER the mirror commits, and `adoptPullNumbers` is idempotent (it only
  // ever fills a NULL), so a crash in between self-heals on the next refresh.
  const branchToPull = new Map<string, number>()
  for (const pull of body) if (pull.head?.ref) branchToPull.set(pull.head.ref, pull.number)

  await db.batch([
    db
      .insert(syncState)
      .values({ userId, resource, etag, fetchedAt: now })
      .onConflictDoUpdate({
        target: [syncState.userId, syncState.resource],
        set: { etag, fetchedAt: now },
      }),
    ...chunkRowsByColumnBudget(rows).map((part) =>
      db
        .insert(pullRequests)
        .values(part)
        .onConflictDoUpdate({
          target: [pullRequests.userId, pullRequests.repoId, pullRequests.number],
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
    ...deletePullMirrorStatements(db, removedPulls),
  ])
  // After the mirror commits, never inside it: two SQLite files cannot share a transaction.
  await core.tasks.adoptPullNumbers(owner, repo, branchToPull)
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
  db: PluginDatabase,
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
  db: PluginDatabase,
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
