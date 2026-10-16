import { and, desc, eq, sql } from 'drizzle-orm'
import {
  chunkRowsByColumnBudget,
  type CoreServices,
  type PluginDatabase,
  type RefreshResult,
  type RouteResult,
} from '@acorn/plugin-api/node'
import type { MergeRequestRow } from '../../shared/api'
import { mergeRequests, syncState } from '../../node/schema'
import { glGraphQL, GITLAB_PROVIDER, type GitlabSession } from '../gitlabApi'
import { type GitlabEmit, NO_EMIT } from '../events'
import { absoluteUrl, checkStatus, mergeRequestState } from './vocabulary'

// A project's merge requests. The open list is mirrored and refreshed on a short clock, because it's
// what the rail shows and what adopts a task onto its merge request. The closed list is one page read
// live, because nobody waits on it.

export const openListResource = (projectId: number) => `mrs:${projectId}:open`

const LIST_QUERY = `query MergeRequests($path: ID!, $state: MergeRequestState!, $after: String, $first: Int!) {
  project(fullPath: $path) {
    mergeRequests(state: $state, first: $first, after: $after, sort: UPDATED_DESC) {
      pageInfo { hasNextPage endCursor }
      nodes {
        iid title state draft sourceBranch targetBranch updatedAt
        author { username avatarUrl }
        headPipeline { status }
      }
    }
  }
}`

type ListNode = {
  iid: string
  title: string
  state: string
  draft: boolean
  sourceBranch: string | null
  targetBranch: string | null
  updatedAt: string | null
  author: { username: string; avatarUrl: string | null } | null
  headPipeline: { status: string } | null
}
type ListPage = { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ListNode[] }
type ListAnswer = { project: { mergeRequests: ListPage } | null }

const toRow = (node: ListNode): MergeRequestRow => ({
  number: Number(node.iid),
  title: node.title,
  state: mergeRequestState(node.state),
  draft: node.draft,
  author: node.author?.username ?? null,
  authorAvatar: absoluteUrl(node.author?.avatarUrl),
  headRef: node.sourceBranch,
  baseRef: node.targetBranch,
  updatedAt: node.updatedAt ? Date.parse(node.updatedAt) : null,
  pipelineStatus: checkStatus(node.headPipeline?.status ?? null),
})

/** Up to `pages` pages of one state, newest first. */
export async function fetchMergeRequests(
  session: GitlabSession,
  path: string,
  state: 'opened' | 'closed' | 'merged',
  pages: number,
  pageSize = 100,
): Promise<RouteResult<MergeRequestRow[]>> {
  const rows: MergeRequestRow[] = []
  let after: string | null = null
  for (let page = 0; page < pages; page++) {
    const answer: RouteResult<ListAnswer> = await glGraphQL<ListAnswer>(session, LIST_QUERY, {
      path,
      state,
      after,
      first: pageSize,
    })
    if (!answer.ok) return answer
    const list: ListPage | undefined = answer.value.project?.mergeRequests
    if (!list) return { ok: false, failure: { error: 'not_found', status: 404 } }
    rows.push(...list.nodes.map(toRow))
    if (!list.pageInfo.hasNextPage) break
    after = list.pageInfo.endCursor
  }
  return { ok: true, value: rows }
}

export const readOpenMergeRequests = async (db: PluginDatabase, userId: string, projectId: number) =>
  (
    await db
      .select()
      .from(mergeRequests)
      .where(
        and(eq(mergeRequests.userId, userId), eq(mergeRequests.projectId, projectId), eq(mergeRequests.state, 'open')),
      )
      .orderBy(desc(mergeRequests.updatedAt))
  ).map((row): MergeRequestRow => ({
    number: row.iid,
    title: row.title,
    state: 'open',
    draft: row.draft,
    author: row.author,
    authorAvatar: row.authorAvatar,
    headRef: row.headRef,
    baseRef: row.baseRef,
    updatedAt: row.updatedAt,
    pipelineStatus: row.pipelineStatus,
  }))

/**
 * Refresh a project's open merge requests. A row the detail already filled keeps its detail columns,
 * and a merge request that left the open list is marked closed until its detail is read again. Then
 * every task on a source branch adopts its merge request.
 */
export async function refreshOpenMergeRequests(
  session: GitlabSession,
  db: PluginDatabase,
  core: Pick<CoreServices, 'tasks'>,
  project: { userId: string; id: number; path: string },
  pages: number,
  emit: GitlabEmit = NO_EMIT,
): Promise<RefreshResult> {
  const listed = await fetchMergeRequests(session, project.path, 'opened', pages)
  if (!listed.ok) return listed
  const now = Date.now()
  const scope = and(eq(mergeRequests.userId, project.userId), eq(mergeRequests.projectId, project.id))
  const rows = listed.value.map((row) => ({
    userId: project.userId,
    projectId: project.id,
    iid: row.number,
    state: 'open',
    draft: row.draft,
    title: row.title,
    headRef: row.headRef,
    baseRef: row.baseRef,
    author: row.author,
    authorAvatar: row.authorAvatar,
    updatedAt: row.updatedAt,
    pipelineStatus: row.pipelineStatus,
    fetchedAt: now,
  }))
  await db.batch([
    db
      .update(mergeRequests)
      .set({ state: 'closed' })
      .where(and(scope, eq(mergeRequests.state, 'open'))),
    ...chunkRowsByColumnBudget(rows).map((part) =>
      db
        .insert(mergeRequests)
        .values(part)
        .onConflictDoUpdate({
          target: [mergeRequests.userId, mergeRequests.projectId, mergeRequests.iid],
          set: {
            state: 'open',
            draft: sqlExcluded('draft'),
            title: sqlExcluded('title'),
            headRef: sqlExcluded('head_ref'),
            baseRef: sqlExcluded('base_ref'),
            updatedAt: sqlExcluded('updated_at'),
            pipelineStatus: sqlExcluded('pipeline_status'),
          },
        }),
    ),
    db
      .insert(syncState)
      .values({ userId: project.userId, resource: openListResource(project.id), fetchedAt: now })
      .onConflictDoUpdate({ target: [syncState.userId, syncState.resource], set: { fetchedAt: now } }),
  ])
  const byBranch = new Map(listed.value.flatMap((row) => (row.headRef ? [[row.headRef, row.number] as const] : [])))
  await core.tasks.adoptChangeRequests(GITLAB_PROVIDER, project.path.toLowerCase(), byBranch)
  emit('pulls-changed', { projectPath: project.path })
  return { ok: true }
}

const sqlExcluded = (column: string) => sql.raw(`excluded.${column}`)
