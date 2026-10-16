import { and, desc, eq, notInArray } from 'drizzle-orm'
import {
  chunkRowsByColumnBudget,
  type PluginDatabase,
  type RefreshResult,
  type RouteResult,
} from '@acorn/plugin-api/node'
import type { BitbucketRepository } from '../../shared/api'
import {
  comments,
  commits,
  participants,
  prFiles,
  pullRequests,
  repositories,
  statuses,
  syncState,
} from '../../node/schema'
import { bbJson, bbPages, repositoryPath, type BitbucketSession } from '../bitbucketApi'
import { type BitbucketEmit, NO_EMIT } from '../events'
import type { BitbucketRepositoryAnswer } from '../types'
import { time } from './vocabulary'

// The repositories the person is a member of, which is what the importer lists.

export const REPOSITORIES_RESOURCE = 'repositories'
const PAGE_SIZE = 100

const repositoryRow = (connectionId: string, repository: BitbucketRepositoryAnswer, fetchedAt: number) => ({
  connectionId,
  repo: repository.full_name.toLowerCase(),
  path: repository.full_name,
  name: repository.name,
  defaultBranch: repository.mainbranch?.name ?? null,
  private: repository.is_private,
  updatedAt: time(repository.updated_on),
  fetchedAt,
})

export const toPublicRepository = (row: typeof repositories.$inferSelect): BitbucketRepository => ({
  path: row.path,
  name: row.name,
  private: row.private,
  defaultBranch: row.defaultBranch,
  updatedAt: row.updatedAt,
})

export const readCachedRepositories = (db: PluginDatabase, connectionId: string) =>
  db
    .select()
    .from(repositories)
    .where(eq(repositories.connectionId, connectionId))
    .orderBy(desc(repositories.updatedAt))

/** Replace the owner's repository mirror with Bitbucket's list, `maxPages` pages of 100 at most. */
export async function refreshRepositories(
  session: BitbucketSession,
  db: PluginDatabase,
  connectionId: string,
  maxPages: number,
  emit: BitbucketEmit = NO_EMIT,
): Promise<RefreshResult> {
  const listed = await bbPages<BitbucketRepositoryAnswer>(
    session,
    `/repositories?role=member&sort=-updated_on&pagelen=${PAGE_SIZE}`,
    maxPages,
  )
  if (!listed.ok) return listed
  const now = Date.now()
  const rows = listed.value.values.map((repository) => repositoryRow(connectionId, repository, now))
  await db.batch([
    db.delete(repositories).where(eq(repositories.connectionId, connectionId)),
    ...chunkRowsByColumnBudget(rows).map((part) => db.insert(repositories).values(part)),
    db
      .insert(syncState)
      .values({ connectionId, resource: REPOSITORIES_RESOURCE, fetchedAt: now })
      .onConflictDoUpdate({ target: [syncState.connectionId, syncState.resource], set: { fetchedAt: now } }),
  ])
  emit('repos-changed')
  return { ok: true }
}

/** A mirrored repository by full name, with no call to Bitbucket. */
export async function mirroredRepository(db: PluginDatabase, connectionId: string, repository: string) {
  const [row] = await db
    .select()
    .from(repositories)
    .where(and(eq(repositories.connectionId, connectionId), eq(repositories.repo, repository.toLowerCase())))
  return row ?? null
}

/** A repository by full name: from the mirror, or from Bitbucket and then into the mirror. */
export async function resolveRepository(
  session: BitbucketSession,
  db: PluginDatabase,
  connectionId: string,
  repository: string,
): Promise<RouteResult<typeof repositories.$inferSelect>> {
  const cached = await mirroredRepository(db, connectionId, repository)
  if (cached) return { ok: true, value: cached }
  const fetched = await bbJson<BitbucketRepositoryAnswer>(session, repositoryPath(repository.toLowerCase()))
  if (!fetched.ok) return fetched
  const row = repositoryRow(connectionId, fetched.value, Date.now())
  await db
    .insert(repositories)
    .values(row)
    .onConflictDoUpdate({ target: [repositories.connectionId, repositories.repo], set: row })
  return { ok: true, value: row }
}

/** Drop every mirror row that belongs to none of `connectionIds`, such as a disconnected account's. */
export async function forgetOtherConnections(db: PluginDatabase, connectionIds: string[]): Promise<void> {
  for (const table of [repositories, pullRequests, prFiles, participants, comments, commits, statuses, syncState])
    await db.delete(table).where(connectionIds.length ? notInArray(table.connectionId, connectionIds) : undefined)
}
