import { createHash } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import {
  chunkRowsByColumnBudget,
  type Cached,
  type PluginDatabase,
  type RefreshResult,
  type RouteResult,
  serveThenRevalidate,
} from '@acorn/plugin-api/node'
import { patchBlobKey, topologyOf, writePatchDocument, type PatchBlobStore } from '@acorn/diff-document/store'
import type { Check, Review, ReviewState, Thread } from '@acorn/change-request-ui/model'
import type { PullRequestDetail, PullRequestDiff, PullRequestFiles } from '../../shared/api'
import { comments, commits, participants, prFiles, pullRequests, statuses, syncState } from '../../node/schema'
import { bb, bbError, bbJson, bbPages, repositoryPath, type BitbucketSession } from '../bitbucketApi'
import { type BitbucketEmit, NO_EMIT, pullRequestPayload } from '../events'
import { avatarOf, login, type BitbucketPullRequest, type BitbucketUser } from '../types'
import { forkOf } from './pullRequests'
import { checkStatus, pullRequestState, sameCommit, time, verdict } from './vocabulary'

// One pull request, as two resources. Its detail is four requests, because Bitbucket's REST API keeps
// each part apart: the pull request with its participants, its comments, its commits, and the build
// statuses on its commits. Its files are the diffstat and one unified diff, with each file's patch in
// the blob cache. Each resource's rows are replaced together, so a read never mixes two refreshes.
// The detail alone is what a background reader, such as the CI policy, refreshes.

/** A pull request's detail goes stale this fast while someone reviews it. */
const DETAIL_STALE_AFTER_MS = 45_000
// Page budgets: 100 comments, commits, or statuses a page, and 500 diffstat entries. Past them the
// mirror keeps what it read and the file list says it stopped.
const COMMENT_PAGES = 5
const DIFFSTAT_PAGES = 4

const detailResource = (repository: string, number: number) => `pr:${repository}:${number}`
const filesResource = (repository: string, number: number) => `files:${repository}:${number}`

export type MirrorKey = { connectionId: string; repository: string; number: number }

type BitbucketComment = {
  id: number
  content?: { raw?: string | null; html?: string | null } | null
  user?: BitbucketUser | null
  created_on?: string | null
  deleted?: boolean
  pending?: boolean
  inline?: { path: string; from?: number | null; to?: number | null; outdated?: boolean } | null
  parent?: { id: number } | null
  resolution?: unknown
}
type BitbucketCommit = {
  hash: string
  message: string
  date?: string | null
  author?: { raw?: string | null; user?: BitbucketUser | null } | null
}
type BitbucketStatus = {
  key: string
  name?: string | null
  state: string
  url?: string | null
  commit?: { hash: string } | null
}
type DiffstatEntry = {
  status: string
  lines_added?: number | null
  lines_removed?: number | null
  old?: { path: string } | null
  new?: { path: string } | null
}

const pullPath = (key: Pick<MirrorKey, 'repository' | 'number'>) =>
  `${repositoryPath(key.repository)}/pullrequests/${key.number}`

const patchDigest = (patch: string) => `sha256:${createHash('sha256').update(patch).digest('hex')}`

/** Each file's hunks in a unified diff, by the path the file has after the change (its old path when
 *  it was removed). A file with no hunks, such as a binary or a pure rename, has none. */
export function splitDiff(diff: string): Map<string, string> {
  const patches = new Map<string, string>()
  for (const section of diff.split(/^diff --git /m).slice(1)) {
    const lines = section.split('\n')
    const newPath = lines.find((line) => line.startsWith('+++ '))?.slice(4)
    const oldPath = lines.find((line) => line.startsWith('--- '))?.slice(4)
    const path = newPath && newPath !== '/dev/null' ? newPath.replace(/^b\//, '') : oldPath?.replace(/^a\//, '')
    const start = lines.findIndex((line) => line.startsWith('@@'))
    if (path && start >= 0) patches.set(path, lines.slice(start).join('\n'))
  }
  return patches
}

/** The name in a commit's `Name <email>` author, without the email. */
const authorName = (raw: string | null | undefined): string | null => raw?.replace(/\s*<[^>]*>\s*$/, '').trim() || null

/**
 * Read one pull request's files from Bitbucket into the mirror. Patch bodies go to the blob cache first,
 * keyed by their digest, which is safe because an orphan is only cache data. Then the rows swap in one
 * batch, with the revision the diff was read at.
 */
export async function refreshFiles(
  session: BitbucketSession,
  db: PluginDatabase,
  blobs: PatchBlobStore,
  key: MirrorKey,
  emit: BitbucketEmit = NO_EMIT,
): Promise<RefreshResult> {
  const [pull, diffstat, diff] = await Promise.all([
    bbJson<BitbucketPullRequest>(session, pullPath(key)),
    bbPages<DiffstatEntry>(session, `${pullPath(key)}/diffstat?pagelen=500`, DIFFSTAT_PAGES),
    bb(session, `${pullPath(key)}/diff`, { headers: { accept: 'text/plain' } }),
  ])
  if (!pull.ok) return pull
  if (!diffstat.ok) return diffstat
  const failure = bbError(diff)
  if (failure) return { ok: false, failure }
  const patches = splitDiff(await diff.text())
  const scope = { connectionId: key.connectionId, repo: key.repository, number: key.number }
  const fileRows = []
  for (const [position, entry] of diffstat.value.values.entries()) {
    const path = entry.new?.path ?? entry.old?.path
    if (!path) continue
    const patch = patches.get(path)
    const patchKey = patch ? patchDigest(patch) : null
    if (patch && patchKey) {
      await blobs.put(patchBlobKey(patchKey), patch)
      await writePatchDocument(blobs, patchKey, path, patch)
    }
    fileRows.push({
      ...scope,
      path,
      status: entry.status === 'merge conflict' ? 'modified' : entry.status,
      additions: entry.lines_added ?? null,
      deletions: entry.lines_removed ?? null,
      position,
      patchState: patch ? 'available' : 'unavailable',
      patchKey,
    })
  }
  const head = pull.value.source.commit?.hash
  const revision = head ? `${pull.value.destination.commit?.hash ?? ''}:${head}` : null
  const now = Date.now()
  await db.batch([
    db.delete(prFiles).where(ownRows(key).files),
    ...chunkRowsByColumnBudget(fileRows).map((part) => db.insert(prFiles).values(part)),
    db.update(pullRequests).set({ filesCapped: diffstat.value.capped }).where(ownRows(key).pull),
    db
      .insert(syncState)
      .values({
        connectionId: key.connectionId,
        resource: filesResource(key.repository, key.number),
        revision,
        fetchedAt: now,
      })
      .onConflictDoUpdate({ target: [syncState.connectionId, syncState.resource], set: { revision, fetchedAt: now } }),
  ])
  emit('pr-synced', pullRequestPayload(key.repository, key.number))
  return { ok: true }
}

/**
 * Read one pull request's detail from Bitbucket into the mirror, every row in one batch. Announces
 * `pr-synced`, and `checks-changed` when a build status moved.
 */
export async function refreshPullRequest(
  session: BitbucketSession,
  db: PluginDatabase,
  key: MirrorKey,
  emit: BitbucketEmit = NO_EMIT,
): Promise<RefreshResult> {
  const [pull, commentPages, commitPages, statusPages] = await Promise.all([
    bbJson<BitbucketPullRequest>(session, pullPath(key)),
    bbPages<BitbucketComment>(session, `${pullPath(key)}/comments?pagelen=100`, COMMENT_PAGES),
    bbPages<BitbucketCommit>(session, `${pullPath(key)}/commits?pagelen=100`, 1),
    bbPages<BitbucketStatus>(session, `${pullPath(key)}/statuses?pagelen=100`, 1),
  ])
  if (!pull.ok) return pull
  if (!commentPages.ok) return commentPages
  if (!commitPages.ok) return commitPages
  if (!statusPages.ok) return statusPages
  const node = pull.value
  const scope = { connectionId: key.connectionId, repo: key.repository, number: key.number }
  const now = Date.now()
  // The pull request names its head by a short hash, and its commit list by the whole one, which is
  // what a build status and the editor's line markers compare against.
  const shortHead = node.source.commit?.hash ?? null
  const headSha =
    (shortHead && commitPages.value.values.find((commit) => sameCommit(commit.hash, shortHead))?.hash) || shortHead

  const peopleRows = (node.participants ?? []).flatMap((participant, position) => {
    const name = login(participant.user)
    return name
      ? [
          {
            ...scope,
            login: name,
            uuid: participant.user.uuid,
            avatarUrl: avatarOf(participant.user),
            reviewer: participant.role === 'REVIEWER',
            state: verdict(participant),
            at: time(participant.participated_on),
            position,
          },
        ]
      : []
  })

  // A reply names its parent, so its thread is the root at the end of that chain.
  const kept = commentPages.value.values.filter((comment) => !comment.deleted && !comment.pending)
  const parents = new Map(kept.map((comment) => [comment.id, comment.parent?.id ?? null]))
  const rootOf = (id: number): number => {
    let at = id
    for (let hops = 0; hops < 100; hops++) {
      const parent = parents.get(at)
      if (parent == null || !parents.has(parent)) return at
      at = parent
    }
    return at
  }
  const byId = new Map(kept.map((comment) => [comment.id, comment]))
  const commentRows = kept.map((comment, position) => {
    const root = byId.get(rootOf(comment.id)) ?? comment
    const inline = root.inline
    return {
      ...scope,
      id: comment.id,
      threadId: root.id,
      onDiff: !!inline?.path,
      path: inline?.path ?? null,
      line: inline?.to ?? inline?.from ?? null,
      side: inline?.to != null ? 'new' : inline?.from != null ? 'old' : null,
      outdated: inline?.outdated === true,
      resolved: root.resolution != null,
      author: login(comment.user),
      authorAvatar: avatarOf(comment.user),
      authorIsBot: comment.user?.type === 'app_user',
      body: comment.content?.html ?? null,
      createdAt: time(comment.created_on),
      position,
    }
  })
  const statusRows = statusPages.value.values.map((status, position) => ({
    ...scope,
    key: status.key,
    commitSha: status.commit?.hash ?? headSha ?? '',
    name: status.name || status.key,
    status: checkStatus(status.state),
    url: status.url ?? null,
    position,
  }))
  const previous = await db
    .select({ key: statuses.key, commitSha: statuses.commitSha, status: statuses.status })
    .from(statuses)
    .where(ownRows(key).statuses)

  const where = ownRows(key)
  const columns = {
    state: pullRequestState(node.state),
    draft: node.draft === true,
    title: node.title,
    body: node.summary?.html ?? null,
    headRef: node.source.branch?.name ?? null,
    baseRef: node.destination.branch?.name ?? null,
    headSha,
    baseSha: node.destination.commit?.hash ?? null,
    sourceRepo: forkOf(node),
    author: login(node.author),
    authorAvatar: avatarOf(node.author),
    updatedAt: time(node.updated_on),
    fetchedAt: now,
  }
  await db.batch([
    db
      .insert(pullRequests)
      .values({ ...scope, ...columns })
      .onConflictDoUpdate({
        target: [pullRequests.connectionId, pullRequests.repo, pullRequests.number],
        set: columns,
      }),
    db.delete(participants).where(where.participants),
    db.delete(comments).where(where.comments),
    db.delete(commits).where(where.commits),
    db.delete(statuses).where(where.statuses),
    ...chunkRowsByColumnBudget(peopleRows).map((part) => db.insert(participants).values(part)),
    ...chunkRowsByColumnBudget(commentRows).map((part) => db.insert(comments).values(part)),
    ...chunkRowsByColumnBudget(
      commitPages.value.values.map((commit, position) => ({
        ...scope,
        sha: commit.hash,
        message: commit.message.split('\n')[0] ?? '',
        author: authorName(commit.author?.raw) ?? login(commit.author?.user),
        authorLogin: login(commit.author?.user),
        committedAt: time(commit.date),
        position,
      })),
    ).map((part) => db.insert(commits).values(part)),
    ...chunkRowsByColumnBudget(statusRows).map((part) => db.insert(statuses).values(part)),
    db
      .insert(syncState)
      .values({ connectionId: key.connectionId, resource: detailResource(key.repository, key.number), fetchedAt: now })
      .onConflictDoUpdate({ target: [syncState.connectionId, syncState.resource], set: { fetchedAt: now } }),
  ])

  emit('pr-synced', pullRequestPayload(key.repository, key.number))
  const before = new Map(previous.map((row) => [`${row.key}@${row.commitSha}`, row.status]))
  if (
    statusRows.length !== before.size ||
    statusRows.some((row) => before.get(`${row.key}@${row.commitSha}`) !== row.status)
  )
    emit('checks-changed', pullRequestPayload(key.repository, key.number))
  return { ok: true }
}

type Scoped = { connectionId: AnySQLiteColumn; repo: AnySQLiteColumn; number: AnySQLiteColumn }

const ownRows = (key: MirrorKey) => {
  const of = (table: Scoped) =>
    and(eq(table.connectionId, key.connectionId), eq(table.repo, key.repository), eq(table.number, key.number))
  return {
    pull: of(pullRequests),
    files: of(prFiles),
    participants: of(participants),
    comments: of(comments),
    commits: of(commits),
    statuses: of(statuses),
  }
}

export async function mirroredPullRequest(db: PluginDatabase, key: MirrorKey) {
  const [row] = await db.select().from(pullRequests).where(ownRows(key).pull)
  return row ?? null
}

async function syncOf(db: PluginDatabase, key: MirrorKey, resource: string) {
  const [sync] = await db
    .select()
    .from(syncState)
    .where(and(eq(syncState.connectionId, key.connectionId), eq(syncState.resource, resource)))
  return sync ?? null
}

/** The build statuses the mirror holds, on any of the pull request's commits. */
export const readStatuses = (db: PluginDatabase, key: MirrorKey) =>
  db.select().from(statuses).where(ownRows(key).statuses).orderBy(asc(statuses.position))

/** The mirror's pull request as the shared review views read it. Null until its detail is read. A row
 *  the open list wrote has no detail behind it. */
export async function readDetail(db: PluginDatabase, key: MirrorKey): Promise<PullRequestDetail | null> {
  const [row, sync] = await Promise.all([
    mirroredPullRequest(db, key),
    syncOf(db, key, detailResource(key.repository, key.number)),
  ])
  if (!row || !sync) return null
  const where = ownRows(key)
  const [people, commentRows, commitRows, statusRows] = await Promise.all([
    db.select().from(participants).where(where.participants).orderBy(asc(participants.position)),
    db.select().from(comments).where(where.comments).orderBy(asc(comments.position)),
    db.select().from(commits).where(where.commits).orderBy(asc(commits.position)),
    readStatuses(db, key),
  ])
  const avatars: Record<string, string> = {}
  const remember = (name: string | null, url: string | null) => {
    if (name && url) avatars[name] = url
  }
  remember(row.author, row.authorAvatar)
  for (const person of people) remember(person.login, person.avatarUrl)
  for (const comment of commentRows) remember(comment.author, comment.authorAvatar)

  // A verdict has no body: each is a person's latest approval or request for changes.
  const reviews: Review[] = people.flatMap((person) =>
    person.state
      ? [
          {
            id: `participant:${person.login}`,
            author: person.login,
            state: person.state as ReviewState,
            body: null,
            submittedAt: person.at,
          },
        ]
      : [],
  )
  const threads = new Map<number, Thread>()
  const conversation: PullRequestDetail['comments'] = []
  for (const comment of commentRows) {
    if (!comment.onDiff) {
      conversation.push({
        id: String(comment.id),
        author: comment.author,
        body: comment.body,
        createdAt: comment.createdAt,
      })
      continue
    }
    const thread = threads.get(comment.threadId) ?? {
      threadId: String(comment.threadId),
      path: comment.path,
      line: comment.line,
      outdated: comment.outdated,
      side: comment.side === 'old' || comment.side === 'new' ? comment.side : null,
      resolved: comment.resolved,
      comments: [],
    }
    thread.comments.push({
      id: String(comment.id),
      databaseId: comment.id,
      author: comment.author,
      avatarUrl: comment.authorAvatar,
      body: comment.body,
      createdAt: comment.createdAt,
    })
    threads.set(comment.threadId, thread)
  }
  const checks: Check[] = statusRows
    .filter((status) => sameCommit(status.commitSha, row.headSha))
    .map((status) => ({ name: status.name, status: status.status, url: status.url, runId: null }))

  return {
    revision: row.headSha ? `${row.baseSha ?? ''}:${row.headSha}` : null,
    request: {
      number: row.number,
      title: row.title,
      state: row.state === 'merged' ? 'merged' : row.state === 'open' ? 'open' : 'closed',
      draft: row.draft,
      author: row.author,
      headRef: row.headRef,
      baseRef: row.baseRef,
      updatedAt: row.updatedAt,
      body: row.body,
      headSha: row.headSha,
    },
    labels: [],
    reviews,
    reviewers: people.filter((person) => person.reviewer).map((person) => person.login),
    comments: conversation,
    commits: commitRows.map((commit) => ({
      sha: commit.sha,
      message: commit.message,
      author: commit.author,
      authorLogin: commit.authorLogin,
      committedAt: commit.committedAt,
    })),
    checks,
    threads: [...threads.values()],
    avatars,
    sourceRepository: row.sourceRepo,
  }
}

const capWarning = (count: number) =>
  `Bitbucket sent ${count.toLocaleString('en-US')} changed files before acorn stopped reading. It might have more.`

async function readFiles(db: PluginDatabase, key: MirrorKey) {
  const [row, files] = await Promise.all([
    mirroredPullRequest(db, key),
    db.select().from(prFiles).where(ownRows(key).files).orderBy(asc(prFiles.position)),
  ])
  return { files, warning: row?.filesCapped ? capWarning(files.length) : null }
}

/** The changed files through the mirror, read from Bitbucket when the mirror has none or they're
 *  stale. */
export function pullRequestFiles(
  session: BitbucketSession,
  db: PluginDatabase,
  blobs: PatchBlobStore,
  key: MirrorKey,
  options: { force?: boolean; emit?: BitbucketEmit } = {},
): Promise<RouteResult<PullRequestFiles>> {
  const resource = filesResource(key.repository, key.number)
  return serveThenRevalidate({
    resource,
    userId: key.connectionId,
    ttlMs: DETAIL_STALE_AFTER_MS,
    force: options.force === true,
    read: async (): Promise<Cached<PullRequestFiles> | null> => {
      const sync = await syncOf(db, key, resource)
      if (!sync) return null
      const { files, warning } = await readFiles(db, key)
      return {
        data: {
          files: files.map(({ path, status, additions, deletions }) => ({ path, status, additions, deletions })),
          warning,
        },
        fetchedAt: sync.fetchedAt,
      }
    },
    refresh: () => refreshFiles(session, db, blobs, key, options.emit),
  })
}

/**
 * The files as a diff document, with no patch text in it. A patch body missing from the blob cache
 * is cache loss: the read refreshes the files, which writes it again.
 */
export async function pullRequestDiff(
  session: BitbucketSession,
  db: PluginDatabase,
  blobs: PatchBlobStore,
  key: MirrorKey,
  options: { force?: boolean; emit?: BitbucketEmit } = {},
): Promise<RouteResult<PullRequestDiff>> {
  const listed = await pullRequestFiles(session, db, blobs, key, options)
  if (!listed.ok) return listed
  const build = async (): Promise<PullRequestDiff | null> => {
    const [sync, { files, warning }] = await Promise.all([
      syncOf(db, key, filesResource(key.repository, key.number)),
      readFiles(db, key),
    ])
    const topology = await topologyOf(
      blobs,
      files.map((file) => ({
        path: file.path,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        // The head commit, not a blob: gap expansion reads the file at that commit by its path.
        sha: sync?.revision?.split(':')[1] ?? null,
        patchState: file.patchState === 'available' ? 'available' : 'unavailable',
        patchKey: file.patchKey,
      })),
    )
    if (!topology.ok) return null
    const revision = sync?.revision ?? null
    return { document: { ...topology.document, revision: revision ?? topology.document.revision }, revision, warning }
  }
  const built = await build()
  if (built) return { ok: true, value: built }
  const repaired = await refreshFiles(session, db, blobs, key, options.emit)
  if (!repaired.ok) return repaired
  const rebuilt = await build()
  return rebuilt
    ? { ok: true, value: rebuilt }
    : { ok: false, failure: { error: 'bitbucket_unavailable', status: 502 } }
}

/**
 * The pull request's detail through the mirror: fresh within its window, served stale while a refresh
 * runs, and read from Bitbucket when the mirror has none. Every reader of one pull request goes through
 * here.
 */
export function pullRequestDetail(
  session: BitbucketSession,
  db: PluginDatabase,
  key: MirrorKey,
  options: { force?: boolean; emit?: BitbucketEmit } = {},
): Promise<RouteResult<PullRequestDetail>> {
  const resource = detailResource(key.repository, key.number)
  return serveThenRevalidate({
    resource,
    userId: key.connectionId,
    ttlMs: DETAIL_STALE_AFTER_MS,
    force: options.force === true,
    read: async (): Promise<Cached<PullRequestDetail> | null> => {
      const [sync, detail] = await Promise.all([syncOf(db, key, resource), readDetail(db, key)])
      return detail && sync ? { data: detail, fetchedAt: sync.fetchedAt } : null
    },
    refresh: () => refreshPullRequest(session, db, key, options.emit),
  })
}

/** The changed file paths the mirror holds, for the agent's `pr_current` tool. */
export async function readFilePaths(db: PluginDatabase, key: MirrorKey): Promise<string[]> {
  const rows = await db.select({ path: prFiles.path }).from(prFiles).where(ownRows(key).files)
  return rows.map((row) => row.path)
}

export type ReviewActivity = {
  kind: 'approval' | 'changes-requested' | 'thread-comment' | 'comment'
  author: string | null
  body: string | null
  at: number
  path?: string | null
}

/**
 * Verdicts and comments on the pull request after `since`, oldest first, with its state. For the
 * review-received policy. The pull request's author answering their reviewers isn't a review.
 */
export async function reviewActivitySince(
  db: PluginDatabase,
  key: MirrorKey,
  since: number,
  options: { includeBots: boolean },
): Promise<{ state: string; activity: ReviewActivity[] } | null> {
  const row = await mirroredPullRequest(db, key)
  if (!row) return null
  const where = ownRows(key)
  const [people, commentRows] = await Promise.all([
    db.select().from(participants).where(where.participants),
    db.select().from(comments).where(where.comments),
  ])
  const activity: ReviewActivity[] = [
    ...people
      .filter((person) => person.state && person.at != null && person.at > since && person.login !== row.author)
      .map((person) => ({
        kind: person.state === 'approved' ? ('approval' as const) : ('changes-requested' as const),
        author: person.login,
        body: null,
        at: person.at!,
      })),
    ...commentRows
      .filter(
        (comment) =>
          comment.createdAt != null &&
          comment.createdAt > since &&
          comment.author !== row.author &&
          (options.includeBots || !comment.authorIsBot),
      )
      .map((comment) => ({
        kind: comment.onDiff ? ('thread-comment' as const) : ('comment' as const),
        author: comment.author,
        body: comment.body,
        at: comment.createdAt!,
        ...(comment.onDiff ? { path: comment.path } : {}),
      })),
  ]
  return { state: row.state, activity: activity.sort((a, b) => a.at - b.at) }
}
