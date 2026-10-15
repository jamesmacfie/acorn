import { and, eq, sql } from 'drizzle-orm'
import {
  chunkRowsByColumnBudget,
  type CoreServices,
  type PluginDatabase,
  type RefreshResult,
} from '@acorn/plugin-api/node'
import { pullsResource } from '../../resourceKeys'
import { gh, ghError } from '../../githubApi'
import { mirrorFiles, mirrorPr, type PatchBlobStore } from '../mirror/prMirror'
import { deletePullMirrorStatements } from '../../mirrorRetention'
import { pullRequests, syncState } from '../../../node/schema'
import { type GithubEmit, NO_EMIT } from '../../events'

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

/** Force-refresh the mirrored open-PR list for one repository. */
export async function refreshOpenPulls(
  token: string,
  db: PluginDatabase,
  core: Pick<CoreServices, 'tasks'>,
  key: PullRefreshKey,
  fetcher: GitHubFetcher = gh,
  emit: GithubEmit = NO_EMIT,
): Promise<RefreshResult> {
  const { userId, repoId, owner, repo } = key
  const resource = pullsResource(repoId, 'open')
  const [sync] = await db
    .select()
    .from(syncState)
    .where(and(eq(syncState.userId, userId), eq(syncState.resource, resource)))
  const res = await fetcher(
    token,
    `/repos/${owner}/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=100`,
    {
      headers: sync?.etag ? { 'If-None-Match': sync.etag } : {},
    },
  )
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
      .where(and(eq(pullRequests.userId, userId), eq(pullRequests.repoId, repoId), eq(pullRequests.state, 'open')))
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
  await core.tasks.adoptChangeRequests('github', `${owner}/${repo}`, branchToPull)
  emit('pulls-changed', { repoOwner: owner, repoName: repo })
  return { ok: true }
}

/** Force-refresh one PR's GraphQL composite. Every connection is walked before anything is written.
 *  The fetcher loads on demand, which keeps provider pagination out of the Node service's startup
 *  graph. On success it also says which commit the checks belong to, which can trail the head for a
 *  moment after a push. */
export async function refreshPullDetail(
  token: string,
  db: PluginDatabase,
  key: PullRefreshKey & { number: number },
  emit: GithubEmit = NO_EMIT,
): Promise<Exclude<RefreshResult, { ok: true }> | { ok: true; headSha: string | null; checksSha: string | null }> {
  const { fetchPullComposite } = await import('../mirror/prFetch')
  const pull = await fetchPullComposite(token, key.owner, key.repo, key.number)
  if (!pull.ok) return pull
  const { checksChanged } = await mirrorPr(
    db,
    { userId: key.userId, repoId: key.repoId, number: key.number },
    pull.value,
    Date.now(),
  )
  announcePrSynced(emit, key, pull.value.headRefOid, checksChanged)
  return { ok: true, headSha: pull.value.headRefOid, checksSha: pull.value.checksOid ?? null }
}

/** Force-refresh one PR's changed files: every page GitHub lists, then one swap. */
export async function refreshPullFiles(
  token: string,
  db: PluginDatabase,
  blobs: PatchBlobStore,
  key: PullRefreshKey & { number: number },
  emit: GithubEmit = NO_EMIT,
): Promise<RefreshResult> {
  const { fetchFiles } = await import('../mirror/prFetch')
  const files = await fetchFiles(token, key.owner, key.repo, key.number)
  if (!files.ok) return files
  await mirrorFiles(blobs, db, { userId: key.userId, repoId: key.repoId, number: key.number }, files.value)
  announcePrSynced(emit, key, null, false)
  return { ok: true }
}

/** One PR's composite landed. `checks-changed` rides alongside only when a check flipped: it is the
 *  verb a consumer keys a green-to-red alert on, so it must not fire on every sync. */
export function announcePrSynced(
  emit: GithubEmit,
  key: PullRefreshKey & { number: number },
  headSha: string | null,
  checksChanged: boolean,
): void {
  const payload = { repoOwner: key.owner, repoName: key.repo, pullNumber: key.number, headSha }
  emit('pr-synced', payload)
  if (checksChanged) emit('checks-changed', payload)
}
