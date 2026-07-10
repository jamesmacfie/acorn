import { and, eq, inArray } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { Check, Comment, Label, PullCommit, PullDetail, PullFile, Review, Thread } from '../../../../core/shared/api'
import { patchBlobKey } from '../../../../core/server/blobs'
import { getDb, schema } from '../../../../core/server/db'
import { chunkRowsByColumnBudget } from '../../../../core/server/db/batch'
import { filesResource, prResource } from '../../../../core/server/db/resourceKeys'
import { gh, ghError } from '..'
import type { RouteResult } from './repoMirror'

// Shared PR mirror helpers: the GraphQL detail mirror and the REST files mirror (SQLite rows +
// on-disk patch blobs), plus their read-backs. Both the single-PR routes (pullDetail / pullFiles)
// and the batch route (pullsBatch) read+write the same mirror tables, so the logic lives here
// once to avoid drift. PR data is "fast-changing" (docs/caching.md) — freshness is a TTL gate in
// sync_state (PULLS_STALE_AFTER_MS, server/sync/policy.ts).

type Db = ReturnType<typeof getDb>
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
// ponytail: first-page only (reviews,comments 50) — cursor pagination deferred.

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
      .insert(schema.pullRequests)
      .values(pullRow)
      .onConflictDoUpdate({
        target: [schema.pullRequests.userId, schema.pullRequests.repoId, schema.pullRequests.number],
        set: pullRow,
      }),
    db.delete(schema.prLabels).where(childWhere(schema.prLabels, key)),
    db.delete(schema.reviews).where(childWhere(schema.reviews, key)),
    db.delete(schema.reviewRequests).where(childWhere(schema.reviewRequests, key)),
    db.delete(schema.comments).where(childWhere(schema.comments, key)),
    db.delete(schema.prCommits).where(childWhere(schema.prCommits, key)),
    db.delete(schema.checks).where(childWhere(schema.checks, key)),
    db.delete(schema.reviewThreads).where(childWhere(schema.reviewThreads, key)),
    ...chunk(schema.prLabels, labelRows),
    ...chunk(schema.reviews, reviewRows),
    ...chunk(schema.reviewRequests, reviewRequestRows),
    ...chunk(schema.comments, commentRows),
    ...chunk(schema.prCommits, commitRows),
    ...chunk(schema.checks, checkRows),
    ...chunk(schema.reviewThreads, threadRows),
    db
      .insert(schema.syncState)
      .values({ userId: key.userId, resource, etag: null, fetchedAt: now })
      .onConflictDoUpdate({ target: [schema.syncState.userId, schema.syncState.resource], set: { fetchedAt: now } }),
  ])
}

const toThread = (row: typeof schema.reviewThreads.$inferSelect) =>
  ({
    threadId: row.threadId,
    path: row.path,
    line: row.line,
    side: row.side,
    resolved: row.resolved,
    comments: [] as Thread['comments'],
  }) satisfies Thread

const toPublicPull = (p: typeof schema.pullRequests.$inferSelect) =>
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
    eq(schema.pullRequests.userId, key.userId),
    eq(schema.pullRequests.repoId, key.repoId),
    eq(schema.pullRequests.number, key.number),
  )
  const [pull] = await db.select().from(schema.pullRequests).where(prWhere)
  const [labels, reviews, reviewRequests, comments, commits, checks, threadRows] = await Promise.all([
    db.select().from(schema.prLabels).where(childWhere(schema.prLabels, key)),
    db.select().from(schema.reviews).where(childWhere(schema.reviews, key)),
    db.select().from(schema.reviewRequests).where(childWhere(schema.reviewRequests, key)),
    db.select().from(schema.comments).where(childWhere(schema.comments, key)),
    db.select().from(schema.prCommits).where(childWhere(schema.prCommits, key)),
    db.select().from(schema.checks).where(childWhere(schema.checks, key)),
    db.select().from(schema.reviewThreads).where(childWhere(schema.reviewThreads, key)),
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
    reviews: reviews.map((r) => ({ id: r.id, author: r.author, state: r.state, body: r.body, submittedAt: r.submittedAt }) satisfies Review),
    requestedReviewers: reviewRequests.map((r) => r.login),
    comments: comments.map((m) => ({ id: m.id, author: m.author, body: m.body, createdAt: m.createdAt }) satisfies Comment),
    commits: commits.map((m) => ({ sha: m.sha, message: m.message, author: m.author, authorLogin: m.authorLogin, committedAt: m.committedAt }) satisfies PullCommit),
    checks: checks.map((k) => ({ name: k.name, status: k.status, url: k.url, runId: k.runId }) satisfies Check),
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

// Fetch one PR's changed files from the REST API. ponytail: first 100 files — Link-header
// pagination deferred. Non-OK responses are normalized through ghError (same RouteResult shape
// as refreshRepos), so callers don't re-derive failures themselves.
export const fetchFiles = async (token: string, owner: string, repo: string, number: number): Promise<RouteResult<GitHubFile[]>> => {
  const res = await gh(token, `/repos/${owner}/${repo}/pulls/${number}/files?per_page=100`)
  const err = ghError(res)
  if (err) return { ok: false, failure: err }
  return { ok: true, value: (await res.json()) as GitHubFile[] }
}

// Re-mirror one PR's files: patch bodies → on-disk BLOBS by immutable sha (deduped, cached
// forever — see server/blobs.ts); only the metadata rows go to the DB. Bodies resolve back from
// BLOBS on read.
export const mirrorFiles = async (env: Env, db: Db, key: PrKey, body: GitHubFile[]) => {
  const now = Date.now()
  await Promise.all(body.filter((f) => f.patch != null).map((f) => env.BLOBS.put(patchBlobKey(f.sha), f.patch as string)))
  const rows = body.map((f) => ({
    ...key,
    path: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    sha: f.sha,
  }))
  const fileWhere = and(eq(schema.prFiles.userId, key.userId), eq(schema.prFiles.repoId, key.repoId), eq(schema.prFiles.number, key.number))
  const resource = filesResource(key.repoId, key.number)
  await db.batch([
    db.delete(schema.prFiles).where(fileWhere),
    ...rows.map((r) => db.insert(schema.prFiles).values(r)),
    db
      .insert(schema.syncState)
      .values({ userId: key.userId, resource, etag: null, fetchedAt: now })
      .onConflictDoUpdate({ target: [schema.syncState.userId, schema.syncState.resource], set: { fetchedAt: now } }),
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
    eq(schema.prFiles.userId, key.userId),
    eq(schema.prFiles.repoId, key.repoId),
    eq(schema.prFiles.number, key.number),
    ...(paths ? [inArray(schema.prFiles.path, paths)] : []),
  )
  const viewedWhere = and(eq(schema.viewedFiles.userId, key.userId), eq(schema.viewedFiles.repoId, key.repoId), eq(schema.viewedFiles.number, key.number))
  const [files, viewed] = await Promise.all([
    db.select().from(schema.prFiles).where(fileWhere),
    db.select({ path: schema.viewedFiles.path }).from(schema.viewedFiles).where(viewedWhere),
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
