import { createHash } from 'node:crypto'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { Check, Comment, Label, PullCommit, PullDetail, PullFile, PullTopologyCompleteness, Review, Thread } from '../../../shared/api'
import { chunkRowsByColumnBudget, createLogger, patchBlobKey, type PluginDatabase } from '@acorn/plugin-api/node'
import { filesResource, prResource } from '../../resourceKeys'
import { mapLimited } from '../../mapLimited'
import { COMPLETE, type FilesFetch, type PullComposite } from './prFetch'
import { checks as checksTable, comments as commentsTable, prCommits as prCommitsTable, prFiles as prFilesTable, prLabels as prLabelsTable, pullRequests as pullRequestsTable, reviewRequests as reviewRequestsTable, reviewThreads as reviewThreadsTable, reviews as reviewsTable, syncState as syncStateTable, viewedFiles as viewedFilesTable } from '../../../node/schema'

// Shared PR mirror helpers: the GraphQL detail mirror and the REST files mirror (SQLite rows +
// on-disk patch blobs), plus their read-backs. Both the single-PR routes (pullDetail / pullFiles)
// and the batch route (pullsBatch) read+write the same mirror tables, so the logic lives here
// once to avoid drift. PR data is "fast-changing" (docs/caching.md); freshness is a TTL gate in
// sync_state (PULLS_STALE_AFTER_MS, server/syncPolicy.ts).
//
// Writers take a value prFetch.ts has already fetched in full, and swap it in with one db.batch, so
// the rows, their order, and sync_state move together or not at all. Every child row carries its
// provider `position`, and every read orders by it.

// Every exported helper here already took the handle as a parameter, which is why this module needed
// no reshaping when the tables moved. Only the type of the thing being passed in changed.
type Db = PluginDatabase
const log = createLogger('github', 'github')
export type PrKey = { userId: string; repoId: number; number: number }

// ─── Detail (GraphQL composite) ──────────────────────────────────────────────

const ms = (s: string | null) => (s ? Date.parse(s) : null)

// A commit can carry duplicate context names across check runs; keep the last (PK is name), in the
// place the first one held.
const dedupeByName = <T extends { name: string }>(rows: T[]) => [...new Map(rows.map((r) => [r.name, r])).values()]

const childWhere = (t: { userId: SQLiteColumn; repoId: SQLiteColumn; number: SQLiteColumn }, key: PrKey) =>
  and(eq(t.userId, key.userId), eq(t.repoId, key.repoId), eq(t.number, key.number))

// Atomically re-mirror one PR's detail composite: upsert the pull row, replace all child rows,
// bump sync_state. Rows per insert are capped by the bound-parameter budget in db/batch.ts.
// Runs in one db.batch; callers can fan these out in parallel across PRs.
//
// Reports whether the checks rows differ from what was mirrored before, so the caller can announce
// `checks-changed` only when a check actually flipped rather than on every sync.
export const mirrorPr = async (db: Db, key: PrKey, pr: PullComposite, now: number): Promise<{ checksChanged: boolean }> => {
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
  const labelRows = pr.labels.map((l, position) => ({ ...key, name: l.name, color: l.color, position }))
  const reviewRows = pr.reviews.map((r, position) => ({
    ...key,
    id: r.id,
    author: r.author?.login ?? null,
    state: r.state,
    body: r.bodyHTML,
    submittedAt: ms(r.submittedAt),
    position,
  }))
  const reviewRequestRows = [...new Set(pr.reviewRequests
    .map((rr) => rr.requestedReviewer?.login)
    .filter((login): login is string => !!login))]
    .map((login, position) => ({ ...key, login, position }))
  const commentRows = pr.comments.map((m, position) => ({
    ...key,
    id: m.id,
    author: m.author?.login ?? null,
    body: m.bodyHTML,
    createdAt: ms(m.createdAt),
    position,
  }))
  const commitRows = pr.commits.map(({ commit }, position) => ({
    ...key,
    sha: commit.oid,
    message: commit.messageHeadline,
    author: commit.author?.name ?? commit.author?.user?.login ?? null,
    authorLogin: commit.author?.user?.login ?? null,
    committedAt: ms(commit.committedDate),
    position,
  }))
  const threadRows = pr.threads
    .flatMap((t) =>
      t.comments.map((cm) => ({
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
    .map((row, position) => ({ ...row, position }))
  const checkRows = dedupeByName(
    pr.checks.map((ctx) =>
      ctx.__typename === 'CheckRun'
        ? { ...key, name: ctx.name, status: ctx.conclusion ?? ctx.status, url: ctx.detailsUrl, runId: ctx.checkSuite?.workflowRun?.databaseId ?? null }
        : { ...key, name: ctx.context, status: ctx.state, url: ctx.targetUrl, runId: null },
    ),
  ).map((row, position) => ({ ...row, position }))

  const chunk = <T,>(table: Parameters<typeof db.insert>[0], rows: T[]) => {
    if (rows.length === 0) return []
    return chunkRowsByColumnBudget(rows as object[]).map((part) => db.insert(table).values(part as never))
  }

  const before = await db.select({ name: checksTable.name, status: checksTable.status }).from(checksTable).where(childWhere(checksTable, key))
  const signature = (rows: { name: string; status: string | null }[]) => rows.map((r) => `${r.name}=${r.status ?? ''}`).sort().join('\n')
  const checksChanged = signature(before) !== signature(checkRows)

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
  return { checksChanged }
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
    db.select().from(prLabelsTable).where(childWhere(prLabelsTable, key)).orderBy(asc(prLabelsTable.position)),
    db.select().from(reviewsTable).where(childWhere(reviewsTable, key)).orderBy(asc(reviewsTable.position)),
    db.select().from(reviewRequestsTable).where(childWhere(reviewRequestsTable, key)).orderBy(asc(reviewRequestsTable.position)),
    db.select().from(commentsTable).where(childWhere(commentsTable, key)).orderBy(asc(commentsTable.position)),
    db.select().from(prCommitsTable).where(childWhere(prCommitsTable, key)).orderBy(asc(prCommitsTable.position)),
    db.select().from(checksTable).where(childWhere(checksTable, key)).orderBy(asc(checksTable.position)),
    db.select().from(reviewThreadsTable).where(childWhere(reviewThreadsTable, key)).orderBy(asc(reviewThreadsTable.position)),
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

// Stated structurally rather than as `Pick<Env['BLOBS'], …>`: naming core's runtime bindings put
// `SECRETS`, `ACTIVE_IDENTITY` and `INTERNAL_TOKEN` on the plugin contract to reach one blob cache, and
// a plugin should be reading what it needs off `ctx` or off the two methods it actually calls.
export type PatchBlobStore = { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> }

// Patch bodies are written a few at a time; a 2,200-file pull is 2,200 files on disk.
const BLOB_WRITE_CONCURRENCY = 8

// A patch's identity is its own text. The head blob sha is not: the same new file has a different
// patch against a different base, so a sha-keyed patch could serve another pull's diff.
export const patchDigest = (patch: string) => `sha256:${createHash('sha256').update(patch).digest('hex')}`

// Re-mirror one PR's files from a fetch that already holds every page. Patch bodies go to on-disk
// BLOBS first, keyed by their digest. That is safe before the swap because an orphaned body is only
// cache data. Only when every write has landed do the rows, their order, and the files sync row
// (with its completeness) replace the old ones in one db.batch. A failed write throws and leaves the
// previous mirror untouched.
export const mirrorFiles = async (blobs: PatchBlobStore, db: Db, key: PrKey, fetched: FilesFetch, now = Date.now()) => {
  const rows = fetched.files.map((f, position) => {
    const patchKey = f.patch != null ? patchDigest(f.patch) : null
    return {
      ...key,
      path: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      sha: f.sha,
      position,
      patchState: patchKey ? 'available' : 'unavailable',
      patchKey,
    }
  })
  await mapLimited(fetched.files, BLOB_WRITE_CONCURRENCY, async (f, i) => {
    const patchKey = rows[i]!.patchKey
    if (patchKey) await blobs.put(patchBlobKey(patchKey), f.patch as string)
  })
  const c = fetched.completeness
  const state = c.kind === 'complete'
    ? { incompleteCause: null, received: null, reportedTotal: null, upstreamLimit: null }
    : { incompleteCause: c.cause, received: c.received, reportedTotal: c.reportedTotal, upstreamLimit: c.limit }
  const resource = filesResource(key.repoId, key.number)
  await db.batch([
    db.delete(prFilesTable).where(childWhere(prFilesTable, key)),
    ...chunkRowsByColumnBudget(rows).map((part) => db.insert(prFilesTable).values(part)),
    db
      .insert(syncStateTable)
      .values({ userId: key.userId, resource, etag: null, fetchedAt: now, ...state })
      .onConflictDoUpdate({ target: [syncStateTable.userId, syncStateTable.resource], set: { fetchedAt: now, ...state } }),
  ])
}

// The stored outcome of the last files refresh. A files sync row with no cause is complete.
export const filesCompleteness = (row: typeof syncStateTable.$inferSelect): PullTopologyCompleteness =>
  row.incompleteCause === 'upstream-cap' && row.received != null && row.upstreamLimit != null
    ? { kind: 'incomplete', cause: 'upstream-cap', resource: 'files', received: row.received, reportedTotal: row.reportedTotal, limit: row.upstreamLimit }
    : COMPLETE

type ReadFilesOptions = { includePatches?: boolean; paths?: string[] }

// `missing` counts available patches whose body was not in BLOBS. That is a broken cache, not a file
// without a diff, so the caller repairs it with a refresh rather than serving `patch: null`.
export type ReadFilesResult = { ok: true; files: PullFile[] } | { ok: false; missing: number }

// Read one PR's files back out of the mirror, in provider order. `viewed` is app-state
// (viewed_files), merged in fresh on every read so it survives mirror re-syncs. Callers can skip
// patch bodies for cheap summary reads, which touch no blob at all.
export const readFiles = async (blobs: PatchBlobStore, db: Db, key: PrKey, options: ReadFilesOptions = {}): Promise<ReadFilesResult> => {
  const includePatches = options.includePatches ?? true
  const paths = options.paths?.length ? Array.from(new Set(options.paths)) : undefined
  const fileWhere = and(childWhere(prFilesTable, key), ...(paths ? [inArray(prFilesTable.path, paths)] : []))
  const [files, viewed] = await Promise.all([
    db.select().from(prFilesTable).where(fileWhere).orderBy(asc(prFilesTable.position)),
    db.select({ path: viewedFilesTable.path }).from(viewedFilesTable).where(childWhere(viewedFilesTable, key)),
  ])
  const seen = new Set(viewed.map((v) => v.path))
  let missing = 0
  const out = await Promise.all(
    files.map(async (f): Promise<PullFile> => {
      const available = f.patchState === 'available' && !!f.patchKey
      const patch = includePatches && available ? await blobs.get(patchBlobKey(f.patchKey!)) : null
      if (includePatches && available && patch == null) missing++
      return {
        path: f.path,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        sha: f.sha,
        viewed: seen.has(f.path),
        position: f.position,
        patchState: available ? 'available' : 'unavailable',
        patchKey: available ? f.patchKey : null,
        patch,
      }
    }),
  )
  if (missing) {
    log.warn(`pull files read found ${missing} available patch bodies missing from the blob cache`)
    return { ok: false, missing }
  }
  return { ok: true, files: out }
}
