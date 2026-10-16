import { and, desc, eq, sql } from 'drizzle-orm'
import {
  chunkRowsByColumnBudget,
  type CoreServices,
  type PluginDatabase,
  type RefreshResult,
  type RouteResult,
} from '@acorn/plugin-api/node'
import type { PullRequestRow } from '../../shared/api'
import { pullRequests, syncState } from '../../node/schema'
import { bbPages, BITBUCKET_PROVIDER, repositoryPath, type BitbucketSession } from '../bitbucketApi'
import { type BitbucketEmit, NO_EMIT } from '../events'
import { avatarOf, login, type BitbucketPullRequest } from '../types'
import { pullRequestState, time } from './vocabulary'

// A repository's pull requests. The open list is mirrored and refreshed on a short clock, because it's
// what the rail shows and what adopts a task onto its pull request. The closed list is one page read
// live, because nobody waits on it.
//
// A list row carries no statuses, participants, or comments: each is a request of its own per pull
// request, so they're read only when someone opens one or a task links it (./detail.ts).

export const openListResource = (repository: string) => `prs:${repository}:open`

// Bitbucket's largest page of pull requests.
const PAGE_SIZE = 50

/** The fork a pull request comes from, lowercased, or null when its branch is in this repository. */
export const forkOf = (pull: Pick<BitbucketPullRequest, 'source' | 'destination'>): string | null => {
  const source = pull.source.repository?.full_name?.toLowerCase()
  const destination = pull.destination.repository?.full_name?.toLowerCase()
  return source && destination && source !== destination ? source : null
}

const toRow = (pull: BitbucketPullRequest): PullRequestRow => ({
  number: pull.id,
  title: pull.title,
  state: pullRequestState(pull.state),
  draft: pull.draft === true,
  author: login(pull.author),
  authorAvatar: avatarOf(pull.author),
  headRef: pull.source.branch?.name ?? null,
  baseRef: pull.destination.branch?.name ?? null,
  updatedAt: time(pull.updated_on),
  sourceRepository: forkOf(pull),
})

/** Up to `pages` pages in the given states, newest first. */
export async function fetchPullRequests(
  session: BitbucketSession,
  repository: string,
  states: ('OPEN' | 'MERGED' | 'DECLINED' | 'SUPERSEDED')[],
  pages: number,
): Promise<RouteResult<PullRequestRow[]>> {
  const state = states.map((value) => `state=${value}`).join('&')
  const listed = await bbPages<BitbucketPullRequest>(
    session,
    `${repositoryPath(repository)}/pullrequests?${state}&sort=-updated_on&pagelen=${PAGE_SIZE}`,
    pages,
  )
  return listed.ok ? { ok: true, value: listed.value.values.map(toRow) } : listed
}

export const readOpenPullRequests = async (db: PluginDatabase, connectionId: string, repository: string) =>
  (
    await db
      .select()
      .from(pullRequests)
      .where(
        and(
          eq(pullRequests.connectionId, connectionId),
          eq(pullRequests.repo, repository),
          eq(pullRequests.state, 'open'),
        ),
      )
      .orderBy(desc(pullRequests.updatedAt))
  ).map((row): PullRequestRow => ({
    number: row.number,
    title: row.title,
    state: 'open',
    draft: row.draft,
    author: row.author,
    authorAvatar: row.authorAvatar,
    headRef: row.headRef,
    baseRef: row.baseRef,
    updatedAt: row.updatedAt,
    sourceRepository: row.sourceRepo,
  }))

/**
 * Refresh a repository's open pull requests. A row the detail already filled keeps its detail columns,
 * and a pull request that left the open list is marked closed until its detail is read again. Then
 * every task on a source branch adopts its pull request, with the fork it comes from.
 */
export async function refreshOpenPullRequests(
  session: BitbucketSession,
  db: PluginDatabase,
  core: Pick<CoreServices, 'tasks'>,
  scope: { connectionId: string; repository: string },
  pages: number,
  emit: BitbucketEmit = NO_EMIT,
): Promise<RefreshResult> {
  const listed = await fetchPullRequests(session, scope.repository, ['OPEN'], pages)
  if (!listed.ok) return listed
  const now = Date.now()
  const where = and(eq(pullRequests.connectionId, scope.connectionId), eq(pullRequests.repo, scope.repository))
  const rows = listed.value.map((row) => ({
    connectionId: scope.connectionId,
    repo: scope.repository,
    number: row.number,
    state: 'open',
    draft: row.draft,
    title: row.title,
    headRef: row.headRef,
    baseRef: row.baseRef,
    sourceRepo: row.sourceRepository,
    author: row.author,
    authorAvatar: row.authorAvatar,
    updatedAt: row.updatedAt,
    fetchedAt: now,
  }))
  await db.batch([
    db
      .update(pullRequests)
      .set({ state: 'closed' })
      .where(and(where, eq(pullRequests.state, 'open'))),
    ...chunkRowsByColumnBudget(rows).map((part) =>
      db
        .insert(pullRequests)
        .values(part)
        .onConflictDoUpdate({
          target: [pullRequests.connectionId, pullRequests.repo, pullRequests.number],
          set: {
            state: 'open',
            draft: excluded('draft'),
            title: excluded('title'),
            headRef: excluded('head_ref'),
            baseRef: excluded('base_ref'),
            sourceRepo: excluded('source_repo'),
            updatedAt: excluded('updated_at'),
          },
        }),
    ),
    db
      .insert(syncState)
      .values({ connectionId: scope.connectionId, resource: openListResource(scope.repository), fetchedAt: now })
      .onConflictDoUpdate({ target: [syncState.connectionId, syncState.resource], set: { fetchedAt: now } }),
  ])
  const byBranch = new Map(
    listed.value.flatMap((row) =>
      row.headRef
        ? [
            [
              row.headRef,
              row.sourceRepository ? { number: row.number, sourceRepository: row.sourceRepository } : row.number,
            ] as const,
          ]
        : [],
    ),
  )
  await core.tasks.adoptChangeRequests(BITBUCKET_PROVIDER, scope.repository, byBranch)
  emit('pulls-changed', { repository: scope.repository })
  return { ok: true }
}

const excluded = (column: string) => sql.raw(`excluded.${column}`)
