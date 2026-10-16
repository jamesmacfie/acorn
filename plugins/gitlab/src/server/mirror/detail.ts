import { createHash } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import {
  chunkRowsByColumnBudget,
  type Cached,
  type PluginDatabase,
  type RefreshResult,
  type RouteResult,
  serveThenRevalidate,
} from '@acorn/plugin-api/node'
import { patchBlobKey, topologyOf, writePatchDocument, type PatchBlobStore } from '@acorn/diff-document/store'
import type { Check, Review, Thread } from '@acorn/change-request-ui/model'
import type { MergeRequestDetail, MergeRequestDiff, MergeRequestFiles } from '../../shared/api'
import { jobs, mergeRequests, mrCommits, mrFiles, mrLabels, mrPeople, notes, syncState } from '../../node/schema'
import { gidNumber, gidTail, gl, glError, glGraphQL, glJson, projectRef, type GitlabSession } from '../gitlabApi'
import { mergeRequestPayload, type GitlabEmit, NO_EMIT } from '../events'
import { absoluteUrl, checkStatus, mergeRequestState, standaloneHtml } from './vocabulary'

// One merge request, as two resources. Its detail comes from one GraphQL request, which carries its
// approvals, reviewers, discussions and head pipeline. Its files come from REST, with their patches in
// the blob cache. Each resource's rows are replaced together, so a read never mixes two refreshes.
// The detail alone is what a background reader, such as the CI policy, refreshes.

/** A merge request's detail goes stale this fast while someone reviews it. */
const DETAIL_STALE_AFTER_MS = 45_000
// Page budgets: 100 discussions or diff files a page. Past them the mirror keeps what it read and the
// file list says it stopped.
const DISCUSSION_PAGES = 5
const DIFF_PAGES = 10
const PAGE_SIZE = 100

const detailResource = (projectId: number, iid: number) => `mr:${projectId}:${iid}`
const filesResource = (projectId: number, iid: number) => `files:${projectId}:${iid}`

type Person = { username: string; avatarUrl: string | null; bot?: boolean }
type NoteNode = {
  id: string
  body: string | null
  bodyHtml: string | null
  system: boolean
  createdAt: string | null
  author: Person | null
  position: {
    filePath: string | null
    newLine: number | null
    oldLine: number | null
    diffRefs: { headSha: string } | null
  } | null
}
type DiscussionPage = {
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
  nodes: { id: string; resolved: boolean; notes: { nodes: NoteNode[] } }[]
}
type DetailNode = {
  iid: string
  title: string
  state: string
  draft: boolean
  descriptionHtml: string | null
  sourceBranch: string | null
  targetBranch: string | null
  updatedAt: string | null
  conflicts: boolean
  diffRefs: { baseSha: string | null; headSha: string | null; startSha: string | null } | null
  author: Person | null
  labels: { nodes: { title: string; color: string | null }[] }
  reviewers: { nodes: Person[] }
  approvedBy: { nodes: Person[] }
  headPipeline: {
    sha: string | null
    jobs: {
      nodes: {
        id: string
        name: string
        status: string
        allowFailure: boolean
        stage: { name: string } | null
        webPath: string | null
      }[]
    }
  } | null
  commits: {
    nodes: {
      sha: string
      title: string
      authoredDate: string | null
      authorName: string | null
      author: { username: string } | null
    }[]
  }
  discussions: DiscussionPage
}

const PERSON = 'username avatarUrl'
const DISCUSSIONS = `pageInfo { hasNextPage endCursor }
      nodes {
        id resolved
        notes { nodes { id body bodyHtml system createdAt author { ${PERSON} bot } position { filePath newLine oldLine diffRefs { headSha } } } }
      }`
const DETAIL_QUERY = `query MergeRequest($path: ID!, $iid: String!) {
  project(fullPath: $path) {
    mergeRequest(iid: $iid) {
      iid title state draft descriptionHtml sourceBranch targetBranch updatedAt conflicts
      diffRefs { baseSha headSha startSha }
      author { ${PERSON} }
      labels { nodes { title color } }
      reviewers { nodes { ${PERSON} } }
      approvedBy { nodes { ${PERSON} } }
      headPipeline { sha jobs { nodes { id name status allowFailure stage { name } webPath } } }
      commits(first: 100) { nodes { sha title authoredDate authorName author { username } } }
      discussions(first: ${PAGE_SIZE}) { ${DISCUSSIONS} }
    }
  }
}`
const MORE_DISCUSSIONS_QUERY = `query MergeRequestDiscussions($path: ID!, $iid: String!, $after: String) {
  project(fullPath: $path) { mergeRequest(iid: $iid) { discussions(first: ${PAGE_SIZE}, after: $after) { ${DISCUSSIONS} } } }
}`

type RestDiff = {
  old_path: string
  new_path: string
  new_file: boolean
  renamed_file: boolean
  deleted_file: boolean
  diff: string
}

const patchDigest = (patch: string) => `sha256:${createHash('sha256').update(patch).digest('hex')}`

const fileStatus = (diff: RestDiff) =>
  diff.new_file ? 'added' : diff.deleted_file ? 'removed' : diff.renamed_file ? 'renamed' : 'modified'

const lineCounts = (patch: string) => {
  let additions = 0
  let deletions = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+')) additions++
    else if (line.startsWith('-')) deletions++
  }
  return { additions, deletions }
}

async function fetchDetail(session: GitlabSession, path: string, iid: number): Promise<RouteResult<DetailNode>> {
  type Answer = { project: { mergeRequest: DetailNode | null } | null }
  const answer = await glGraphQL<Answer>(session, DETAIL_QUERY, { path, iid: String(iid) })
  if (!answer.ok) return answer
  const node = answer.value.project?.mergeRequest
  if (!node) return { ok: false, failure: { error: 'not_found', status: 404 } }
  let page = node.discussions
  for (let read = 1; read < DISCUSSION_PAGES && page.pageInfo.hasNextPage; read++) {
    type More = { project: { mergeRequest: { discussions: DiscussionPage } | null } | null }
    const more = await glGraphQL<More>(session, MORE_DISCUSSIONS_QUERY, {
      path,
      iid: String(iid),
      after: page.pageInfo.endCursor,
    })
    if (!more.ok) return more
    page = more.value.project?.mergeRequest?.discussions ?? {
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [],
    }
    node.discussions.nodes.push(...page.nodes)
  }
  return { ok: true, value: node }
}

async function fetchDiffs(
  session: GitlabSession,
  path: string,
  iid: number,
): Promise<RouteResult<{ diffs: RestDiff[]; capped: boolean }>> {
  const diffs: RestDiff[] = []
  for (let page = 1; page <= DIFF_PAGES; page++) {
    const response = await gl(
      session,
      `/projects/${projectRef(path)}/merge_requests/${iid}/diffs?per_page=${PAGE_SIZE}&page=${page}`,
    )
    const failure = glError(response)
    if (failure) return { ok: false, failure }
    const batch = (await response.json()) as RestDiff[]
    diffs.push(...batch)
    if (batch.length < PAGE_SIZE) return { ok: true, value: { diffs, capped: false } }
  }
  return { ok: true, value: { diffs, capped: true } }
}

export type MirrorKey = { userId: string; projectId: number; path: string; iid: number }

/**
 * Read one merge request's files from GitLab into the mirror. Patch bodies go to the blob cache first,
 * keyed by their digest, which is safe because an orphan is only cache data. Then the rows swap in one
 * batch, with the revision the diffs were read at.
 */
export async function refreshFiles(
  session: GitlabSession,
  db: PluginDatabase,
  blobs: PatchBlobStore,
  key: MirrorKey,
  emit: GitlabEmit = NO_EMIT,
): Promise<RefreshResult> {
  type Refs = { diff_refs: { base_sha: string | null; head_sha: string | null } | null }
  const refs = await glJson<Refs>(session, `/projects/${projectRef(key.path)}/merge_requests/${key.iid}`)
  if (!refs.ok) return refs
  const diffs = await fetchDiffs(session, key.path, key.iid)
  if (!diffs.ok) return diffs
  const scope = { userId: key.userId, projectId: key.projectId, iid: key.iid }
  const fileRows = []
  for (const [position, diff] of diffs.value.diffs.entries()) {
    const available = diff.diff.trim().length > 0
    const patchKey = available ? patchDigest(diff.diff) : null
    if (patchKey) {
      await blobs.put(patchBlobKey(patchKey), diff.diff)
      await writePatchDocument(blobs, patchKey, diff.new_path, diff.diff)
    }
    fileRows.push({
      ...scope,
      path: diff.new_path,
      status: fileStatus(diff),
      ...(available ? lineCounts(diff.diff) : { additions: null, deletions: null }),
      position,
      patchState: available ? 'available' : 'unavailable',
      patchKey,
    })
  }
  const head = refs.value.diff_refs?.head_sha
  const revision = head ? `${refs.value.diff_refs?.base_sha ?? ''}:${head}` : null
  const now = Date.now()
  const resource = filesResource(key.projectId, key.iid)
  await db.batch([
    db.delete(mrFiles).where(ownRows(key).files),
    ...chunkRowsByColumnBudget(fileRows).map((part) => db.insert(mrFiles).values(part)),
    db
      .update(mergeRequests)
      .set({ filesCapped: diffs.value.capped })
      .where(
        and(
          eq(mergeRequests.userId, key.userId),
          eq(mergeRequests.projectId, key.projectId),
          eq(mergeRequests.iid, key.iid),
        ),
      ),
    db
      .insert(syncState)
      .values({ userId: key.userId, resource, revision, fetchedAt: now })
      .onConflictDoUpdate({ target: [syncState.userId, syncState.resource], set: { revision, fetchedAt: now } }),
  ])
  emit('pr-synced', mergeRequestPayload(key.path, key.iid))
  return { ok: true }
}

/**
 * Read one merge request's detail from GitLab into the mirror, every row in one batch. Announces
 * `pr-synced`, and `checks-changed` when a job's status moved.
 */
export async function refreshMergeRequest(
  session: GitlabSession,
  db: PluginDatabase,
  key: MirrorKey,
  emit: GitlabEmit = NO_EMIT,
): Promise<RefreshResult> {
  const detail = await fetchDetail(session, key.path, key.iid)
  if (!detail.ok) return detail
  const node = detail.value
  const scope = { userId: key.userId, projectId: key.projectId, iid: key.iid }
  const now = Date.now()
  const headSha = node.diffRefs?.headSha ?? null

  // GitLab writes a system note each time someone approves, which is the only time an approval has.
  const approvedAt = new Map<string, number>()
  for (const discussion of node.discussions.nodes)
    for (const note of discussion.notes.nodes)
      if (note.system && note.author && note.createdAt && /^approved this merge request/i.test(note.body ?? ''))
        approvedAt.set(
          note.author.username,
          Math.max(approvedAt.get(note.author.username) ?? 0, Date.parse(note.createdAt)),
        )
  const people = [
    ...node.approvedBy.nodes.map((person, position) => ({ role: 'approver', person, position })),
    ...node.reviewers.nodes.map((person, position) => ({ role: 'reviewer', person, position })),
  ].map(({ role, person, position }) => ({
    ...scope,
    role,
    login: person.username,
    avatarUrl: absoluteUrl(person.avatarUrl),
    at: role === 'approver' ? (approvedAt.get(person.username) ?? null) : null,
    position,
  }))
  let notePosition = 0
  const noteRows = node.discussions.nodes.flatMap((discussion) => {
    // A discussion on the diff is placed by its first positioned note, and every reply belongs to it.
    const at = discussion.notes.nodes.find((note) => note.position?.filePath)?.position ?? null
    return discussion.notes.nodes
      .filter((note) => !note.system)
      .map((note) => {
        const side = at?.newLine != null ? 'new' : at?.oldLine != null ? 'old' : null
        return {
          ...scope,
          id: gidNumber(note.id),
          discussionId: gidTail(discussion.id),
          onDiff: !!at?.filePath,
          path: at?.filePath ?? null,
          line: at?.newLine ?? at?.oldLine ?? null,
          side,
          outdated: !!at?.diffRefs && !!headSha && at.diffRefs.headSha !== headSha,
          resolved: discussion.resolved,
          author: note.author?.username ?? null,
          authorAvatar: absoluteUrl(note.author?.avatarUrl),
          authorIsBot: note.author?.bot === true,
          body: standaloneHtml(note.bodyHtml),
          createdAt: note.createdAt ? Date.parse(note.createdAt) : null,
          position: notePosition++,
        }
      })
  })
  const jobRows = (node.headPipeline?.jobs.nodes ?? []).map((job, position) => ({
    ...scope,
    jobId: gidNumber(job.id),
    name: job.name,
    stage: job.stage?.name ?? null,
    status: checkStatus(job.status, job.allowFailure),
    url: job.webPath ? absoluteUrl(job.webPath) : null,
    pipelineSha: node.headPipeline?.sha ?? null,
    position,
  }))
  const previousJobs = await db.select({ jobId: jobs.jobId, status: jobs.status }).from(jobs).where(ownRows(key).jobs)

  const where = ownRows(key)

  await db.batch([
    db
      .insert(mergeRequests)
      .values({
        ...scope,
        state: mergeRequestState(node.state),
        draft: node.draft,
        title: node.title,
        body: standaloneHtml(node.descriptionHtml),
        headRef: node.sourceBranch,
        baseRef: node.targetBranch,
        headSha,
        baseSha: node.diffRefs?.baseSha ?? null,
        startSha: node.diffRefs?.startSha ?? null,
        author: node.author?.username ?? null,
        authorAvatar: absoluteUrl(node.author?.avatarUrl),
        updatedAt: node.updatedAt ? Date.parse(node.updatedAt) : null,
        conflicting: node.conflicts,
        pipelineStatus: null,
        fetchedAt: now,
      })
      .onConflictDoUpdate({
        target: [mergeRequests.userId, mergeRequests.projectId, mergeRequests.iid],
        set: {
          state: mergeRequestState(node.state),
          draft: node.draft,
          title: node.title,
          body: standaloneHtml(node.descriptionHtml),
          headRef: node.sourceBranch,
          baseRef: node.targetBranch,
          headSha,
          baseSha: node.diffRefs?.baseSha ?? null,
          startSha: node.diffRefs?.startSha ?? null,
          author: node.author?.username ?? null,
          authorAvatar: absoluteUrl(node.author?.avatarUrl),
          updatedAt: node.updatedAt ? Date.parse(node.updatedAt) : null,
          conflicting: node.conflicts,
          fetchedAt: now,
        },
      }),
    db.delete(mrPeople).where(where.people),
    db.delete(mrLabels).where(where.labels),
    db.delete(notes).where(where.notes),
    db.delete(mrCommits).where(where.commits),
    db.delete(jobs).where(where.jobs),
    ...chunkRowsByColumnBudget(people).map((part) => db.insert(mrPeople).values(part)),
    ...chunkRowsByColumnBudget(
      node.labels.nodes.map((label, position) => ({ ...scope, name: label.title, color: label.color, position })),
    ).map((part) => db.insert(mrLabels).values(part)),
    ...chunkRowsByColumnBudget(noteRows).map((part) => db.insert(notes).values(part)),
    ...chunkRowsByColumnBudget(
      node.commits.nodes.map((commit, position) => ({
        ...scope,
        sha: commit.sha,
        message: commit.title,
        author: commit.authorName,
        authorLogin: commit.author?.username ?? null,
        committedAt: commit.authoredDate ? Date.parse(commit.authoredDate) : null,
        position,
      })),
    ).map((part) => db.insert(mrCommits).values(part)),
    ...chunkRowsByColumnBudget(jobRows).map((part) => db.insert(jobs).values(part)),
    db
      .insert(syncState)
      .values({ userId: key.userId, resource: detailResource(key.projectId, key.iid), fetchedAt: now })
      .onConflictDoUpdate({ target: [syncState.userId, syncState.resource], set: { fetchedAt: now } }),
  ])

  emit('pr-synced', mergeRequestPayload(key.path, key.iid))
  const before = new Map(previousJobs.map((job) => [job.jobId, job.status]))
  if (jobRows.length !== before.size || jobRows.some((job) => before.get(job.jobId) !== job.status))
    emit('checks-changed', mergeRequestPayload(key.path, key.iid))
  return { ok: true }
}

const ownRows = (key: Omit<MirrorKey, 'path'>) => ({
  files: and(eq(mrFiles.userId, key.userId), eq(mrFiles.projectId, key.projectId), eq(mrFiles.iid, key.iid)),
  people: and(eq(mrPeople.userId, key.userId), eq(mrPeople.projectId, key.projectId), eq(mrPeople.iid, key.iid)),
  labels: and(eq(mrLabels.userId, key.userId), eq(mrLabels.projectId, key.projectId), eq(mrLabels.iid, key.iid)),
  notes: and(eq(notes.userId, key.userId), eq(notes.projectId, key.projectId), eq(notes.iid, key.iid)),
  commits: and(eq(mrCommits.userId, key.userId), eq(mrCommits.projectId, key.projectId), eq(mrCommits.iid, key.iid)),
  jobs: and(eq(jobs.userId, key.userId), eq(jobs.projectId, key.projectId), eq(jobs.iid, key.iid)),
})

export async function mirroredMergeRequest(db: PluginDatabase, key: Omit<MirrorKey, 'path'>) {
  const [row] = await db
    .select()
    .from(mergeRequests)
    .where(
      and(
        eq(mergeRequests.userId, key.userId),
        eq(mergeRequests.projectId, key.projectId),
        eq(mergeRequests.iid, key.iid),
      ),
    )
  return row ?? null
}

/** When the merge request's detail was last read into the mirror, or null if it never was. A row the
 *  open list wrote has no detail behind it. */
async function detailFetchedAt(db: PluginDatabase, key: Omit<MirrorKey, 'path'>): Promise<number | null> {
  const [sync] = await db
    .select()
    .from(syncState)
    .where(and(eq(syncState.userId, key.userId), eq(syncState.resource, detailResource(key.projectId, key.iid))))
  return sync?.fetchedAt ?? null
}

/** The mirror's merge request as the shared review views read it. Null until its detail is read. */
export async function readDetail(db: PluginDatabase, key: Omit<MirrorKey, 'path'>): Promise<MergeRequestDetail | null> {
  const [row, fetchedAt] = await Promise.all([mirroredMergeRequest(db, key), detailFetchedAt(db, key)])
  if (!row || fetchedAt == null) return null
  const where = ownRows(key)
  const [people, labels, noteRows, commits, jobRows] = await Promise.all([
    db.select().from(mrPeople).where(where.people).orderBy(asc(mrPeople.position)),
    db.select().from(mrLabels).where(where.labels).orderBy(asc(mrLabels.position)),
    db.select().from(notes).where(where.notes).orderBy(asc(notes.position)),
    db.select().from(mrCommits).where(where.commits).orderBy(asc(mrCommits.position)),
    db.select().from(jobs).where(where.jobs).orderBy(asc(jobs.position)),
  ])
  const avatars: Record<string, string> = {}
  const remember = (login: string | null, url: string | null) => {
    if (login && url) avatars[login] = url
  }
  remember(row.author, row.authorAvatar)
  for (const person of people) remember(person.login, person.avatarUrl)
  for (const note of noteRows) remember(note.author, note.authorAvatar)

  // A GitLab approval has no body: each is an approved verdict, at the time its system note gives.
  const reviews: Review[] = people
    .filter((person) => person.role === 'approver')
    .map((person) => ({
      id: `approval:${person.login}`,
      author: person.login,
      state: 'approved',
      body: null,
      submittedAt: person.at,
    }))
  const threads = new Map<string, Thread>()
  const comments: MergeRequestDetail['comments'] = []
  for (const note of noteRows) {
    if (!note.onDiff) {
      comments.push({ id: String(note.id), author: note.author, body: note.body, createdAt: note.createdAt })
      continue
    }
    const thread = threads.get(note.discussionId) ?? {
      threadId: note.discussionId,
      path: note.path,
      line: note.line,
      outdated: note.outdated,
      side: note.side === 'old' || note.side === 'new' ? note.side : null,
      resolved: note.resolved,
      comments: [],
    }
    thread.comments.push({
      id: String(note.id),
      databaseId: note.id,
      author: note.author,
      avatarUrl: note.authorAvatar,
      body: note.body,
      createdAt: note.createdAt,
    })
    threads.set(note.discussionId, thread)
  }
  const checks: Check[] = jobRows.map((job) => ({ name: job.name, status: job.status, url: job.url, runId: job.jobId }))

  return {
    revision: revisionOf(row),
    request: {
      number: row.iid,
      title: row.title,
      state: row.state === 'merged' ? 'merged' : row.state === 'open' ? 'open' : 'closed',
      draft: row.draft,
      author: row.author,
      headRef: row.headRef,
      baseRef: row.baseRef,
      updatedAt: row.updatedAt,
      body: row.body,
      headSha: row.headSha,
      conflicting: row.conflicting,
    },
    labels: labels.map((label) => ({ name: label.name, color: label.color })),
    reviews,
    reviewers: people.filter((person) => person.role === 'reviewer').map((person) => person.login),
    comments,
    commits: commits.map((commit) => ({
      sha: commit.sha,
      message: commit.message,
      author: commit.author,
      authorLogin: commit.authorLogin,
      committedAt: commit.committedAt,
    })),
    checks,
    threads: [...threads.values()],
    avatars,
  }
}

// A thread's location holds only against the diff of the same base and head.
const revisionOf = (row: { baseSha: string | null; headSha: string | null }) =>
  row.headSha ? `${row.baseSha ?? ''}:${row.headSha}` : null

const capWarning = (count: number) =>
  `GitLab sent ${count.toLocaleString('en-US')} changed files before acorn stopped reading. It might have more.`

async function filesSync(db: PluginDatabase, key: Omit<MirrorKey, 'path'>) {
  const [sync] = await db
    .select()
    .from(syncState)
    .where(and(eq(syncState.userId, key.userId), eq(syncState.resource, filesResource(key.projectId, key.iid))))
  return sync ?? null
}

async function readFiles(db: PluginDatabase, key: Omit<MirrorKey, 'path'>) {
  const [row, files] = await Promise.all([
    mirroredMergeRequest(db, key),
    db.select().from(mrFiles).where(ownRows(key).files).orderBy(asc(mrFiles.position)),
  ])
  return { files, warning: row?.filesCapped ? capWarning(files.length) : null }
}

/** The changed files through the mirror, read from GitLab when the mirror has none or they're stale. */
export function mergeRequestFiles(
  session: GitlabSession,
  db: PluginDatabase,
  blobs: PatchBlobStore,
  key: MirrorKey,
  options: { force?: boolean; emit?: GitlabEmit } = {},
): Promise<RouteResult<MergeRequestFiles>> {
  return serveThenRevalidate({
    resource: filesResource(key.projectId, key.iid),
    userId: key.userId,
    ttlMs: DETAIL_STALE_AFTER_MS,
    force: options.force === true,
    read: async (): Promise<Cached<MergeRequestFiles> | null> => {
      const sync = await filesSync(db, key)
      if (!sync) return null
      const { files, warning } = await readFiles(db, key)
      return {
        data: {
          files: files.map((file) => ({
            path: file.path,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
          })),
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
export async function mergeRequestDiff(
  session: GitlabSession,
  db: PluginDatabase,
  blobs: PatchBlobStore,
  key: MirrorKey,
  options: { force?: boolean; emit?: GitlabEmit } = {},
): Promise<RouteResult<MergeRequestDiff>> {
  const listed = await mergeRequestFiles(session, db, blobs, key, options)
  if (!listed.ok) return listed
  const build = async (): Promise<MergeRequestDiff | null> => {
    const [sync, { files, warning }] = await Promise.all([filesSync(db, key), readFiles(db, key)])
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
  return rebuilt ? { ok: true, value: rebuilt } : { ok: false, failure: { error: 'gitlab_unavailable', status: 502 } }
}

/**
 * The merge request's detail through the mirror: fresh within its window, served stale while a
 * refresh runs, and read from GitLab when the mirror has none. Every reader of one merge request goes
 * through here.
 */
export function mergeRequestDetail(
  session: GitlabSession,
  db: PluginDatabase,
  key: MirrorKey,
  options: { force?: boolean; emit?: GitlabEmit } = {},
): Promise<RouteResult<MergeRequestDetail>> {
  return serveThenRevalidate({
    resource: detailResource(key.projectId, key.iid),
    userId: key.userId,
    ttlMs: DETAIL_STALE_AFTER_MS,
    force: options.force === true,
    read: async (): Promise<Cached<MergeRequestDetail> | null> => {
      const [fetchedAt, detail] = await Promise.all([detailFetchedAt(db, key), readDetail(db, key)])
      return detail && fetchedAt != null ? { data: detail, fetchedAt } : null
    },
    refresh: () => refreshMergeRequest(session, db, key, options.emit),
  })
}

/** The changed file paths the mirror holds, for the agent's `pr_current` tool. */
export async function readFilePaths(db: PluginDatabase, key: Omit<MirrorKey, 'path'>): Promise<string[]> {
  const rows = await db.select({ path: mrFiles.path }).from(mrFiles).where(ownRows(key).files)
  return rows.map((row) => row.path)
}

/** The commit the head pipeline ran on, or null when the merge request has none. */
export async function pipelineShaOf(db: PluginDatabase, key: Omit<MirrorKey, 'path'>): Promise<string | null> {
  const [job] = await db.select({ sha: jobs.pipelineSha }).from(jobs).where(ownRows(key).jobs).limit(1)
  return job?.sha ?? null
}

export type ReviewActivity = {
  kind: 'approval' | 'thread-comment' | 'comment'
  author: string | null
  body: string | null
  at: number
  path?: string | null
}

/**
 * Approvals and comments on the merge request after `since`, oldest first, with its state. For the
 * review-received policy. The merge request's author answering their reviewers isn't a review.
 */
export async function reviewActivitySince(
  db: PluginDatabase,
  key: Omit<MirrorKey, 'path'>,
  since: number,
  options: { includeBots: boolean },
): Promise<{ state: string; activity: ReviewActivity[] } | null> {
  const row = await mirroredMergeRequest(db, key)
  if (!row) return null
  const where = ownRows(key)
  const [people, noteRows] = await Promise.all([
    db
      .select()
      .from(mrPeople)
      .where(and(where.people, eq(mrPeople.role, 'approver'))),
    db.select().from(notes).where(where.notes),
  ])
  const activity: ReviewActivity[] = [
    ...people
      .filter((person) => person.at != null && person.at > since && person.login !== row.author)
      .map((person) => ({ kind: 'approval' as const, author: person.login, body: null, at: person.at! })),
    ...noteRows
      .filter(
        (note) =>
          note.createdAt != null &&
          note.createdAt > since &&
          note.author !== row.author &&
          (options.includeBots || !note.authorIsBot),
      )
      .map((note) => ({
        kind: note.onDiff ? ('thread-comment' as const) : ('comment' as const),
        author: note.author,
        body: note.body,
        at: note.createdAt!,
        ...(note.onDiff ? { path: note.path } : {}),
      })),
  ]
  return { state: row.state, activity: activity.sort((a, b) => a.at - b.at) }
}
