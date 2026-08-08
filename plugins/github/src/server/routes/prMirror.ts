import { and, eq, inArray } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { Check, Comment, Label, PullCommit, PullDetail, PullFile, Review, Thread } from '../../contract/api'
import { chunkRowsByColumnBudget, type Env, patchBlobKey, type PluginDatabase, type RouteResult } from '@acorn/plugin-api/node'
import { filesResource, prResource } from '../resourceKeys'
import { gh, ghError } from '..'
import { checks as checksTable, comments as commentsTable, prCommits as prCommitsTable, prFiles as prFilesTable, prLabels as prLabelsTable, pullRequests as pullRequestsTable, reviewRequests as reviewRequestsTable, reviewThreads as reviewThreadsTable, reviews as reviewsTable, syncState as syncStateTable, viewedFiles as viewedFilesTable } from '../../node/schema'

// Shared PR mirror helpers: the GraphQL detail mirror and the REST files mirror (SQLite rows +
// on-disk patch blobs), plus their read-backs. Both the single-PR routes (pullDetail / pullFiles)
// and the batch route (pullsBatch) read+write the same mirror tables, so the logic lives here
// once to avoid drift. PR data is "fast-changing" (docs/caching.md) — freshness is a TTL gate in
// sync_state (PULLS_STALE_AFTER_MS, server/sync/policy.ts).

// Every exported helper here already took the handle as a parameter, which is why this module needed no
// reshaping when the tables moved — only the type of the thing being passed in changed.
type Db = PluginDatabase
export type PrKey = { userId: string; repoId: number; number: number }

// ─── Detail (GraphQL composite) ──────────────────────────────────────────────

// The per-PR selection set, shared by the single-PR query and the batch multi-alias query.
export const PR_FRAGMENT = `
fragment PrFields on PullRequest {
  id number title state isDraft bodyHTML headRefOid
  author { login }
  baseRefName headRefName updatedAt
  labels(first: 20) { nodes { name color } }
  reviews(first: 50) { nodes { id author { login } state bodyHTML submittedAt } }
  reviewRequests(first: 50) { nodes { requestedReviewer { ... on User { login } } } }
  comments(first: 50) { nodes { id author { login } bodyHTML createdAt } }
  commitTimeline: commits(first: 100) { nodes { commit { oid messageHeadline committedDate author { name user { login } } } } }
  reviewThreads(first: 50) { nodes {
    id isResolved path line originalLine diffSide
    comments(first: 50) { nodes { id databaseId author { login } bodyHTML createdAt } }
  } }
  latestCommit: commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 50) { nodes {
    __typename
    ... on CheckRun { name status conclusion detailsUrl checkSuite { workflowRun { databaseId } } }
    ... on StatusContext { context state targetUrl }
  } } } } } }
  mergeable
  mergeStateStatus
  autoMergeRequest { mergeMethod }
}`
export type GqlPull = {
  id: string
  number: number
  title: string
  state: string
  isDraft: boolean
  bodyHTML: string | null
  headRefOid: string | null
  author: { login: string } | null
  baseRefName: string | null
  headRefName: string | null
  updatedAt: string | null
  labels: { nodes: { name: string; color: string | null }[] }
  reviews: { nodes: { id: string; author: { login: string } | null; state: string; bodyHTML: string | null; submittedAt: string | null }[] }
  reviewRequests: { nodes: { requestedReviewer: { login?: string } | null }[] }
  comments: { nodes: { id: string; author: { login: string } | null; bodyHTML: string | null; createdAt: string | null }[] }
  commitTimeline: {
    nodes: {
      commit: {
        oid: string
        messageHeadline: string
        committedDate: string | null
        author: { name: string | null; user: { login: string } | null } | null
      }
    }[]
  }
  reviewThreads: { nodes: GqlThread[] }
  latestCommit: { nodes: { commit: { statusCheckRollup: { contexts: { nodes: GqlContext[] } } | null } }[] }
  mergeable: string | null
  mergeStateStatus: string | null
  autoMergeRequest: { mergeMethod: string } | null
}
type GqlThreadComment = {
  id: string
  databaseId: number | null
  author: { login: string } | null
  bodyHTML: string | null
  createdAt: string | null
}
type GqlThread = {
  id: string
  isResolved: boolean
  path: string | null
  line: number | null
  originalLine: number | null
  diffSide: string | null
  comments: { nodes: GqlThreadComment[] }
}
type GqlContext =
  | {
      __typename: 'CheckRun'
      name: string
      status: string | null
      conclusion: string | null
      detailsUrl: string | null
      checkSuite: { workflowRun: { databaseId: number | null } | null } | null
    }
  | { __typename: 'StatusContext'; context: string; state: string | null; targetUrl: string | null }

const ms = (s: string | null) => (s ? Date.parse(s) : null)

// A commit can carry duplicate context names across check runs; keep the last (PK is name).
const dedupeByName = <T extends { name: string }>(rows: T[]) => [...new Map(rows.map((r) => [r.name, r])).values()]

const childWhere = (t: { userId: SQLiteColumn; repoId: SQLiteColumn; number: SQLiteColumn }, key: PrKey) =>
  and(eq(t.userId, key.userId), eq(t.repoId, key.repoId), eq(t.number, key.number))

// Atomically re-mirror one PR's detail composite: upsert the pull row, replace all child rows,
// bump sync_state. Rows per insert are capped by the bound-parameter budget in db/batch.ts.
// Runs in one db.batch; callers can fan these out in parallel across PRs.
export const mirrorPr = async (db: Db, key: PrKey, pr: GqlPull, now: number) => {
  const pullRow = {
    ...key,
    nodeId: pr.id,
    state: pr.state.toLowerCase(),
    draft: pr.isDraft,
    title: pr.title,
    body: pr.bodyHTML,
    headSha: pr.headRefOid,
    headRef: pr.headRefName,
    baseRef: pr.baseRefName,
    author: pr.author?.login ?? null,
    updatedAt: ms(pr.updatedAt),
    mergeable: pr.mergeable ?? null,
    mergeStateStatus: pr.mergeStateStatus ?? null,
    autoMergeEnabled: pr.autoMergeRequest != null,
    fetchedAt: now,
  }
  const labelRows = pr.labels.nodes.map((l) => ({ ...key, name: l.name, color: l.color }))
  const reviewRows = pr.reviews.nodes.map((r) => ({
    ...key,
    id: r.id,
    author: r.author?.login ?? null,
    state: r.state,
    body: r.bodyHTML,
    submittedAt: ms(r.submittedAt),
  }))
  const reviewRequestRows = pr.reviewRequests.nodes
    .map((rr) => rr.requestedReviewer?.login)
    .filter((login): login is string => !!login)
    .map((login) => ({ ...key, login }))
  const commentRows = pr.comments.nodes.map((m) => ({
    ...key,
    id: m.id,
    author: m.author?.login ?? null,
    body: m.bodyHTML,
    createdAt: ms(m.createdAt),
  }))
  const commitRows = pr.commitTimeline.nodes.map(({ commit }) => ({
    ...key,
    sha: commit.oid,
    message: commit.messageHeadline,
    author: commit.author?.name ?? commit.author?.user?.login ?? null,
    authorLogin: commit.author?.user?.login ?? null,
    committedAt: ms(commit.committedDate),
  }))
  const threadRows = pr.reviewThreads.nodes.flatMap((t) =>
    t.comments.nodes.map((cm) => ({
      ...key,
      threadId: t.id,
      id: cm.id,
      databaseId: cm.databaseId,
      path: t.path,
      line: t.line ?? t.originalLine,
      side: t.diffSide,
      resolved: t.isResolved,
      author: cm.author?.login ?? null,
      body: cm.bodyHTML,
      createdAt: ms(cm.createdAt),
    })),
  )
  const checkRows = dedupeByName(
    (pr.latestCommit.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? []).map((ctx) =>
      ctx.__typename === 'CheckRun'
        ? { ...key, name: ctx.name, status: ctx.conclusion ?? ctx.status, url: ctx.detailsUrl, runId: ctx.checkSuite?.workflowRun?.databaseId ?? null }
        : { ...key, name: ctx.context, status: ctx.state, url: ctx.targetUrl, runId: null },
    ),
  )

  const chunk = <T,>(table: Parameters<typeof db.insert>[0], rows: T[]) => {
    if (rows.length === 0) return []
    return chunkRowsByColumnBudget(rows as object[]).map((part) => db.insert(table).values(part as never))
  }

  const resource = prResource(key.repoId, key.number)
  await db.batch([
    db
      .insert(pullRequestsTable)
      .values(pullRow)
      .onConflictDoUpdate({
        target: [pullRequestsTable.userId, pullRequestsTable.repoId, pullRequestsTable.number],
        set: pullRow,
      }),
    db.delete(prLabelsTable).where(childWhere(prLabelsTable, key)),
    db.delete(reviewsTable).where(childWhere(reviewsTable, key)),
    db.delete(reviewRequestsTable).where(childWhere(reviewRequestsTable, key)),
    db.delete(commentsTable).where(childWhere(commentsTable, key)),
    db.delete(prCommitsTable).where(childWhere(prCommitsTable, key)),
    db.delete(checksTable).where(childWhere(checksTable, key)),
    db.delete(reviewThreadsTable).where(childWhere(reviewThreadsTable, key)),
    ...chunk(prLabelsTable, labelRows),
    ...chunk(reviewsTable, reviewRows),
    ...chunk(reviewRequestsTable, reviewRequestRows),
    ...chunk(commentsTable, commentRows),
    ...chunk(prCommitsTable, commitRows),
    ...chunk(checksTable, checkRows),
    ...chunk(reviewThreadsTable, threadRows),
    db
      .insert(syncStateTable)
      .values({ userId: key.userId, resource, etag: null, fetchedAt: now })
      .onConflictDoUpdate({ target: [syncStateTable.userId, syncStateTable.resource], set: { fetchedAt: now } }),
  ])
}

const toThread = (row: typeof reviewThreadsTable.$inferSelect) =>
  ({
    threadId: row.threadId,
    path: row.path,
    line: row.line,
    side: row.side,
    resolved: row.resolved,
    comments: [] as Thread['comments'],
  }) satisfies Thread

const toPublicPull = (p: typeof pullRequestsTable.$inferSelect) =>
  ({
    number: p.number,
    title: p.title,
    body: p.body,
    state: p.state,
    draft: p.draft,
    author: p.author,
    headSha: p.headSha,
    headRef: p.headRef,
    baseRef: p.baseRef,
    updatedAt: p.updatedAt,
    mergeable: p.mergeable,
    mergeStateStatus: p.mergeStateStatus,
    autoMergeEnabled: p.autoMergeEnabled,
  }) satisfies NonNullable<PullDetail['pull']>

// Read one PR's detail composite back out of the mirror tables.
export const readComposite = async (db: Db, key: PrKey): Promise<PullDetail> => {
  const prWhere = and(
    eq(pullRequestsTable.userId, key.userId),
    eq(pullRequestsTable.repoId, key.repoId),
    eq(pullRequestsTable.number, key.number),
  )
  const [pull] = await db.select().from(pullRequestsTable).where(prWhere)
  const [labels, reviewRows, reviewRequestRows, commentRows, commits, checkRows, threadRows] = await Promise.all([
    db.select().from(prLabelsTable).where(childWhere(prLabelsTable, key)),
    db.select().from(reviewsTable).where(childWhere(reviewsTable, key)),
    db.select().from(reviewRequestsTable).where(childWhere(reviewRequestsTable, key)),
    db.select().from(commentsTable).where(childWhere(commentsTable, key)),
    db.select().from(prCommitsTable).where(childWhere(prCommitsTable, key)),
    db.select().from(checksTable).where(childWhere(checksTable, key)),
    db.select().from(reviewThreadsTable).where(childWhere(reviewThreadsTable, key)),
  ])
  const tmap = new Map<string, ReturnType<typeof toThread>>()
  for (const row of threadRows) {
    let t = tmap.get(row.threadId)
    if (!t) tmap.set(row.threadId, (t = toThread(row)))
    t.comments.push({ id: row.id, databaseId: row.databaseId, author: row.author, body: row.body, createdAt: row.createdAt })
  }
  return {
    pull: pull ? toPublicPull(pull) : null,
    labels: labels.map((l) => ({ name: l.name, color: l.color }) satisfies Label),
    reviews: reviewRows.map((r) => ({ id: r.id, author: r.author, state: r.state, body: r.body, submittedAt: r.submittedAt }) satisfies Review),
    requestedReviewers: reviewRequestRows.map((r) => r.login),
    comments: commentRows.map((m) => ({ id: m.id, author: m.author, body: m.body, createdAt: m.createdAt }) satisfies Comment),
    commits: commits.map((m) => ({ sha: m.sha, message: m.message, author: m.author, authorLogin: m.authorLogin, committedAt: m.committedAt }) satisfies PullCommit),
    checks: checkRows.map((k) => ({ name: k.name, status: k.status, url: k.url, runId: k.runId }) satisfies Check),
    threads: [...tmap.values()],
  }
}

// ─── Files (REST /files → SQLite rows + BLOBS patch bodies) ──────────────────

export type GitHubFile = {
  filename: string
  status: string
  additions: number
  deletions: number
  sha: string
  patch?: string // omitted for binary / too-large / pure-rename files
}

export const fetchFiles = async (token: string, owner: string, repo: string, number: number): Promise<RouteResult<GitHubFile[]>> => {
  const res = await gh(token, `/repos/${owner}/${repo}/pulls/${number}/files?per_page=100`)
  const err = ghError(res)
  if (err) return { ok: false, failure: err }
  return { ok: true, value: (await res.json()) as GitHubFile[] }
}

// Re-mirror one PR's files: patch bodies → on-disk BLOBS by immutable sha (deduped, cached
// forever — see server/blobs.ts); only the metadata rows go to the DB. Bodies resolve back from
// BLOBS on read.
export type PatchBlobStore = Pick<Env['BLOBS'], 'get' | 'put'>

export const mirrorFiles = async (blobs: PatchBlobStore, db: Db, key: PrKey, body: GitHubFile[]) => {
  const now = Date.now()
  await Promise.all(body.filter((f) => f.patch != null).map((f) => blobs.put(patchBlobKey(f.sha), f.patch as string)))
  const rows = body.map((f) => ({
    ...key,
    path: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    sha: f.sha,
  }))
  const fileWhere = and(eq(prFilesTable.userId, key.userId), eq(prFilesTable.repoId, key.repoId), eq(prFilesTable.number, key.number))
  const resource = filesResource(key.repoId, key.number)
  await db.batch([
    db.delete(prFilesTable).where(fileWhere),
    ...rows.map((r) => db.insert(prFilesTable).values(r)),
    db
      .insert(syncStateTable)
      .values({ userId: key.userId, resource, etag: null, fetchedAt: now })
      .onConflictDoUpdate({ target: [syncStateTable.userId, syncStateTable.resource], set: { fetchedAt: now } }),
  ])
}

type ReadFilesOptions = { includePatches?: boolean; paths?: string[] }

// Read one PR's files back out of the mirror. `viewed` is app-state (viewed_files), merged in
// fresh on every read so it survives mirror re-syncs. Callers can skip patch bodies for cheap
// summary reads; patch bodies resolve from the on-disk BLOBS cache by sha when requested.
export const readFiles = async (env: Env, db: Db, key: PrKey, options: ReadFilesOptions = {}): Promise<PullFile[]> => {
  const includePatches = options.includePatches ?? true
  const paths = options.paths?.length ? Array.from(new Set(options.paths)) : undefined
  const fileWhere = and(
    eq(prFilesTable.userId, key.userId),
    eq(prFilesTable.repoId, key.repoId),
    eq(prFilesTable.number, key.number),
    ...(paths ? [inArray(prFilesTable.path, paths)] : []),
  )
  const viewedWhere = and(eq(viewedFilesTable.userId, key.userId), eq(viewedFilesTable.repoId, key.repoId), eq(viewedFilesTable.number, key.number))
  const [files, viewed] = await Promise.all([
    db.select().from(prFilesTable).where(fileWhere),
    db.select({ path: viewedFilesTable.path }).from(viewedFilesTable).where(viewedWhere),
  ])
  const seen = new Set(viewed.map((v) => v.path))
  return Promise.all(
    files.map(
      async (f) =>
        ({
          path: f.path,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          sha: f.sha,
          viewed: seen.has(f.path),
          patch: includePatches && f.sha ? await env.BLOBS.get(patchBlobKey(f.sha)) : null,
        }) satisfies PullFile,
    ),
  )
}
