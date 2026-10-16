import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  type AppEnv,
  type Cached,
  type CoreServices,
  type PluginDatabase,
  respondError,
  serveThenRevalidate,
} from '@acorn/plugin-api/node'
import { MAX_DOCUMENT_FILES, MAX_SEGMENTS_PER_REQUEST, SEARCH_MAX_QUERY } from '@acorn/diff-document/document'
import { searchPatches, segmentsOf } from '@acorn/diff-document/store'
import type {
  BitbucketRepository,
  DiffSearchBody,
  DiffSegmentsBody,
  Member,
  PullRequestList,
  PullRequestRow,
} from '../../shared/api'
import { syncState } from '../../node/schema'
import { bb, bbError, bbPages, bitbucketSession, repositoryPath } from '../bitbucketApi'
import { type BitbucketEmit, NO_EMIT } from '../events'
import {
  readCachedRepositories,
  refreshRepositories,
  REPOSITORIES_RESOURCE,
  toPublicRepository,
} from '../mirror/repositories'
import {
  fetchPullRequests,
  openListResource,
  readOpenPullRequests,
  refreshOpenPullRequests,
} from '../mirror/pullRequests'
import { pullRequestDetail, pullRequestDiff, pullRequestFiles } from '../mirror/detail'
import { avatarOf, login, type BitbucketUser } from '../types'
import { fail, pullRequestKey, repositoryRequest } from './context'
import type { BitbucketAccount } from '../account'

const REPOSITORIES_STALE_AFTER_MS = 300_000
const LIST_STALE_AFTER_MS = 45_000

const patchKey = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const filePath = z.string().min(1).max(4096)
const segmentsBody = z.object({
  requests: z
    .array(z.object({ path: filePath, patchKey, ordinal: z.number().int().min(0) }))
    .min(1)
    .max(MAX_SEGMENTS_PER_REQUEST),
}) satisfies z.ZodType<DiffSegmentsBody>
// The query is never logged: it is a piece of somebody's source.
const searchBody = z.object({
  query: z.string().min(1).max(SEARCH_MAX_QUERY),
  caseSensitive: z.boolean(),
  cursor: z.string().max(64).nullable(),
  files: z.array(z.object({ path: filePath, patchKey })).max(MAX_DOCUMENT_FILES),
}) satisfies z.ZodType<DiffSearchBody>

type Reads = { core: Pick<CoreServices, 'tasks'>; emit?: BitbucketEmit; maxPages: number }

// Everything under /v1/p/bitbucket/repositories that reads: the repository list, a repository's pull
// requests, one pull request's detail, files and diff, and the workspace's people and a file's text.
// The mirror answers what it holds; Bitbucket answers the rest.
export const repositoryReads = (
  db: PluginDatabase,
  account: BitbucketAccount,
  { core, emit = NO_EMIT, maxPages }: Reads,
) =>
  new Hono<AppEnv>()
    .get('/', async (c) => {
      const connectionId = account.connectionId()
      const session = connectionId ? await bitbucketSession(c, connectionId) : null
      if (!connectionId || !session?.auth) return respondError(c, 401, 'reauth')
      const result = await serveThenRevalidate({
        resource: REPOSITORIES_RESOURCE,
        userId: connectionId,
        ttlMs: REPOSITORIES_STALE_AFTER_MS,
        read: async (): Promise<Cached<BitbucketRepository[]> | null> => {
          const [[sync], rows] = await Promise.all([
            db
              .select()
              .from(syncState)
              .where(and(eq(syncState.connectionId, connectionId), eq(syncState.resource, REPOSITORIES_RESOURCE))),
            readCachedRepositories(db, connectionId),
          ])
          return sync ? { data: rows.map(toPublicRepository), fetchedAt: sync.fetchedAt } : null
        },
        refresh: () => refreshRepositories(session, db, connectionId, maxPages, emit),
      })
      return result.ok ? c.json(result.value) : fail(c, result.failure)
    })
    .post('/refresh', async (c) => {
      const connectionId = account.connectionId()
      if (connectionId)
        await db
          .update(syncState)
          .set({ fetchedAt: 0 })
          .where(and(eq(syncState.connectionId, connectionId), eq(syncState.resource, REPOSITORIES_RESOURCE)))
      return c.body(null, 204)
    })
    .get('/:workspace/:repo/pull-requests', async (c) => {
      const request = await repositoryRequest(c, db, account)
      if (!request.ok) return request.response
      const { session, connectionId, repository } = request.value
      if (c.req.query('state') === 'closed') {
        const closed = await fetchPullRequests(session, repository.repo, ['MERGED', 'DECLINED', 'SUPERSEDED'], 1)
        if (!closed.ok) return fail(c, closed.failure)
        return c.json({ rows: closed.value, fetchedAt: Date.now() } satisfies PullRequestList)
      }
      const resource = openListResource(repository.repo)
      const readSync = async () =>
        (
          await db
            .select()
            .from(syncState)
            .where(and(eq(syncState.connectionId, connectionId), eq(syncState.resource, resource)))
        )[0]
      const result = await serveThenRevalidate({
        resource,
        userId: connectionId,
        ttlMs: LIST_STALE_AFTER_MS,
        force: c.req.query('force') === 'true',
        read: async (): Promise<Cached<PullRequestRow[]> | null> => {
          const sync = await readSync()
          return sync
            ? { data: await readOpenPullRequests(db, connectionId, repository.repo), fetchedAt: sync.fetchedAt }
            : null
        },
        refresh: () =>
          refreshOpenPullRequests(session, db, core, { connectionId, repository: repository.repo }, maxPages, emit),
      })
      if (!result.ok) return fail(c, result.failure)
      return c.json({
        rows: result.value,
        fetchedAt: (await readSync())?.fetchedAt ?? Date.now(),
      } satisfies PullRequestList)
    })
    .get('/:workspace/:repo/pull-requests/:number', async (c) => {
      const request = await repositoryRequest(c, db, account)
      if (!request.ok) return request.response
      const key = pullRequestKey(c, request.value)
      if (!key) return respondError(c, 400, 'bad_number')
      const result = await pullRequestDetail(request.value.session, db, key, {
        force: c.req.query('force') === 'true',
        emit,
      })
      return result.ok ? c.json(result.value) : fail(c, result.failure)
    })
    .get('/:workspace/:repo/pull-requests/:number/files', async (c) => {
      const request = await repositoryRequest(c, db, account)
      if (!request.ok) return request.response
      const key = pullRequestKey(c, request.value)
      if (!key) return respondError(c, 400, 'bad_number')
      const result = await pullRequestFiles(request.value.session, db, request.value.blobs, key, {
        force: c.req.query('force') === 'true',
        emit,
      })
      return result.ok ? c.json(result.value) : fail(c, result.failure)
    })
    .get('/:workspace/:repo/pull-requests/:number/diff', async (c) => {
      const request = await repositoryRequest(c, db, account)
      if (!request.ok) return request.response
      const key = pullRequestKey(c, request.value)
      if (!key) return respondError(c, 400, 'bad_number')
      const result = await pullRequestDiff(request.value.session, db, request.value.blobs, key, {
        force: c.req.query('force') === 'true',
        emit,
      })
      return result.ok ? c.json(result.value) : fail(c, result.failure)
    })
    // A segment is addressed by its patch's digest, which the request checks before it becomes part of
    // a blob key, so a request can't address any other kind of blob. The repository access is the
    // owner's, checked by resolving the repository.
    .post('/:workspace/:repo/diff/segments', async (c) => {
      const parsed = segmentsBody.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) return respondError(c, 400, 'bad_request')
      const request = await repositoryRequest(c, db, account)
      if (!request.ok) return request.response
      const result = await segmentsOf(request.value.blobs, parsed.data.requests)
      return result.ok ? c.json(result.segments) : respondError(c, result.status, result.error)
    })
    .post('/:workspace/:repo/diff/search', async (c) => {
      const parsed = searchBody.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) return respondError(c, 400, 'bad_request')
      const request = await repositoryRequest(c, db, account)
      if (!request.ok) return request.response
      const { files, ...search } = parsed.data
      const page = await searchPatches(request.value.blobs, files, search)
      return page ? c.json(page) : respondError(c, 400, 'bad_cursor')
    })
    .get('/:workspace/:repo/files/:commit', async (c) => {
      const file = c.req.query('path')
      const commit = c.req.param('commit')
      if (!file || !/^[0-9a-f]{7,64}$/i.test(commit)) return respondError(c, 400, 'bad_request')
      const request = await repositoryRequest(c, db, account)
      if (!request.ok) return request.response
      const encoded = file.split('/').map(encodeURIComponent).join('/')
      const response = await bb(
        request.value.session,
        `${repositoryPath(request.value.repository.repo)}/src/${commit}/${encoded}`,
        { headers: { accept: 'text/plain' } },
      )
      const failure = bbError(response)
      return failure ? fail(c, failure) : c.json({ text: await response.text() })
    })
    // The workspace's people, whom a reviewer is chosen from and a comment mentions.
    .get('/:workspace/:repo/members', async (c) => {
      const request = await repositoryRequest(c, db, account)
      if (!request.ok) return request.response
      const members = await bbPages<{ user: BitbucketUser }>(
        request.value.session,
        `/workspaces/${c.req.param('workspace').toLowerCase()}/members?pagelen=100`,
        1,
      )
      if (!members.ok) return fail(c, members.failure)
      return c.json(
        members.value.values.flatMap(({ user }): Member[] => {
          const name = login(user)
          return name ? [{ login: name, avatarUrl: avatarOf(user) }] : []
        }),
      )
    })
