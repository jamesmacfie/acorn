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
  DiffSearchBody,
  DiffSegmentsBody,
  GitlabProject,
  Member,
  MergeRequestRow,
  ProjectLabel,
} from '../../shared/api'
import { syncState } from '../../node/schema'
import { gitlabSession, gl, glError, glJson, projectRef } from '../gitlabApi'
import { type GitlabEmit, NO_EMIT } from '../events'
import { PROJECTS_RESOURCE, readCachedProjects, refreshProjects, toPublicProject } from '../mirror/projects'
import {
  fetchMergeRequests,
  openListResource,
  readOpenMergeRequests,
  refreshOpenMergeRequests,
} from '../mirror/mergeRequests'
import { mergeRequestDetail, mergeRequestDiff, mergeRequestFiles } from '../mirror/detail'
import { fail, mergeRequestKey, projectRequest } from './context'
import type { GitlabServers } from '../servers'

const PROJECTS_STALE_AFTER_MS = 300_000
const LIST_STALE_AFTER_MS = 45_000
// The closed tab reads one page of each state from GitLab, newest first.
const CLOSED_PAGE = 50

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

type Reads = { core: Pick<CoreServices, 'tasks'>; emit?: GitlabEmit; maxPages: number }

// Everything under /v1/p/gitlab/projects that reads: the project list, a project's merge requests,
// one merge request's detail, files and diff, and the project's labels, members, file text and job
// logs. The mirror answers what it holds; GitLab answers the rest.
export const projectReads = (db: PluginDatabase, servers: GitlabServers, { core, emit = NO_EMIT, maxPages }: Reads) =>
  new Hono<AppEnv>()
    // Every connected server's projects. A server whose read fails is left out, so one that's down
    // doesn't hide the rest. With every one failing, the first failure answers.
    .get('/', async (c) => {
      const reads = await Promise.all(
        servers.all().map(async (server) => {
          const session = await gitlabSession(c, server)
          if (!session.token) return { ok: false as const, failure: { error: 'reauth', status: 401 as const } }
          const scope = server.connectionId
          return serveThenRevalidate({
            resource: PROJECTS_RESOURCE,
            userId: scope,
            ttlMs: PROJECTS_STALE_AFTER_MS,
            force: c.req.query('force') === 'true',
            read: async (): Promise<Cached<GitlabProject[]> | null> => {
              const [[sync], rows] = await Promise.all([
                db
                  .select()
                  .from(syncState)
                  .where(and(eq(syncState.connectionId, scope), eq(syncState.resource, PROJECTS_RESOURCE))),
                readCachedProjects(db, scope),
              ])
              return sync
                ? { data: rows.map((row) => toPublicProject(server.host, row)), fetchedAt: sync.fetchedAt }
                : null
            },
            refresh: () => refreshProjects(session, db, scope, maxPages, emit),
          })
        }),
      )
      const read = reads.flatMap((result) => (result.ok ? [result.value] : []))
      const failed = reads.find((result) => !result.ok)
      if (!read.length) return fail(c, failed && !failed.ok ? failed.failure : { error: 'reauth', status: 401 })
      return c.json(read.flat())
    })
    .post('/refresh', async (c) => {
      for (const server of servers.all())
        await db
          .update(syncState)
          .set({ fetchedAt: 0 })
          .where(and(eq(syncState.connectionId, server.connectionId), eq(syncState.resource, PROJECTS_RESOURCE)))
      return c.body(null, 204)
    })
    .get('/:host/:path/merge-requests', async (c) => {
      const request = await projectRequest(c, db, servers)
      if (!request.ok) return request.response
      const { session, project } = request.value
      if (c.req.query('state') === 'closed') {
        const [closed, merged] = await Promise.all([
          fetchMergeRequests(session, project.path, 'closed', 1, CLOSED_PAGE),
          fetchMergeRequests(session, project.path, 'merged', 1, CLOSED_PAGE),
        ])
        if (!closed.ok) return fail(c, closed.failure)
        if (!merged.ok) return fail(c, merged.failure)
        const rows: MergeRequestRow[] = [...closed.value, ...merged.value].sort(
          (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
        )
        return c.json(rows)
      }
      const resource = openListResource(project.id)
      const result = await serveThenRevalidate({
        resource,
        userId: project.connectionId,
        ttlMs: LIST_STALE_AFTER_MS,
        force: c.req.query('force') === 'true',
        read: async (): Promise<Cached<MergeRequestRow[]> | null> => {
          const [sync] = await db
            .select()
            .from(syncState)
            .where(and(eq(syncState.connectionId, project.connectionId), eq(syncState.resource, resource)))
          return sync
            ? { data: await readOpenMergeRequests(db, project.connectionId, project.id), fetchedAt: sync.fetchedAt }
            : null
        },
        refresh: () => refreshOpenMergeRequests(session, db, core, project, maxPages, emit),
      })
      return result.ok ? c.json(result.value) : fail(c, result.failure)
    })
    .get('/:host/:path/merge-requests/:number', async (c) => {
      const request = await projectRequest(c, db, servers)
      if (!request.ok) return request.response
      const key = mergeRequestKey(c, request.value)
      if (!key) return respondError(c, 400, 'bad_number')
      const result = await mergeRequestDetail(request.value.session, db, key, {
        force: c.req.query('force') === 'true',
        emit,
      })
      return result.ok ? c.json(result.value) : fail(c, result.failure)
    })
    .get('/:host/:path/merge-requests/:number/files', async (c) => {
      const request = await projectRequest(c, db, servers)
      if (!request.ok) return request.response
      const key = mergeRequestKey(c, request.value)
      if (!key) return respondError(c, 400, 'bad_number')
      const result = await mergeRequestFiles(request.value.session, db, request.value.blobs, key, {
        force: c.req.query('force') === 'true',
        emit,
      })
      return result.ok ? c.json(result.value) : fail(c, result.failure)
    })
    .get('/:host/:path/merge-requests/:number/diff', async (c) => {
      const request = await projectRequest(c, db, servers)
      if (!request.ok) return request.response
      const key = mergeRequestKey(c, request.value)
      if (!key) return respondError(c, 400, 'bad_number')
      const result = await mergeRequestDiff(request.value.session, db, request.value.blobs, key, {
        force: c.req.query('force') === 'true',
        emit,
      })
      return result.ok ? c.json(result.value) : fail(c, result.failure)
    })
    // A segment is addressed by its patch's digest, which the request checks before it becomes part of
    // a blob key, so a request can't address any other kind of blob. The project access is the
    // owner's, checked by resolving the project.
    .post('/:host/:path/diff/segments', async (c) => {
      const parsed = segmentsBody.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) return respondError(c, 400, 'bad_request')
      const request = await projectRequest(c, db, servers)
      if (!request.ok) return request.response
      const result = await segmentsOf(request.value.blobs, parsed.data.requests)
      return result.ok ? c.json(result.segments) : respondError(c, result.status, result.error)
    })
    .post('/:host/:path/diff/search', async (c) => {
      const parsed = searchBody.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) return respondError(c, 400, 'bad_request')
      const request = await projectRequest(c, db, servers)
      if (!request.ok) return request.response
      const { files, ...search } = parsed.data
      const page = await searchPatches(request.value.blobs, files, search)
      return page ? c.json(page) : respondError(c, 400, 'bad_cursor')
    })
    .get('/:host/:path/files/:commit', async (c) => {
      const file = c.req.query('path')
      const commit = c.req.param('commit')
      if (!file || !/^[0-9a-f]{7,64}$/i.test(commit)) return respondError(c, 400, 'bad_request')
      const request = await projectRequest(c, db, servers)
      if (!request.ok) return request.response
      const response = await gl(
        request.value.session,
        `/projects/${projectRef(request.value.project.path)}/repository/files/${encodeURIComponent(file)}/raw?ref=${commit}`,
      )
      const failure = glError(response)
      return failure ? fail(c, failure) : c.json({ text: await response.text() })
    })
    .get('/:host/:path/labels', async (c) => {
      const request = await projectRequest(c, db, servers)
      if (!request.ok) return request.response
      const labels = await glJson<{ name: string; color: string | null }[]>(
        request.value.session,
        `/projects/${projectRef(request.value.project.path)}/labels?per_page=100`,
      )
      if (!labels.ok) return fail(c, labels.failure)
      return c.json(labels.value.map((label): ProjectLabel => ({ name: label.name, color: label.color })))
    })
    .get('/:host/:path/members', async (c) => {
      const request = await projectRequest(c, db, servers)
      if (!request.ok) return request.response
      const members = await glJson<{ username: string; avatar_url: string | null; state?: string }[]>(
        request.value.session,
        `/projects/${projectRef(request.value.project.path)}/members/all?per_page=100`,
      )
      if (!members.ok) return fail(c, members.failure)
      return c.json(
        members.value
          .filter((member) => member.state !== 'blocked')
          .map((member): Member => ({ login: member.username, avatarUrl: member.avatar_url })),
      )
    })
    .get('/:host/:path/jobs/:jobId/log', async (c) => {
      const jobId = Number(c.req.param('jobId'))
      if (!Number.isSafeInteger(jobId) || jobId <= 0) return respondError(c, 400, 'bad_request')
      const request = await projectRequest(c, db, servers)
      if (!request.ok) return request.response
      const response = await gl(
        request.value.session,
        `/projects/${projectRef(request.value.project.path)}/jobs/${jobId}/trace`,
        { headers: { accept: 'text/plain' } },
      )
      const failure = glError(response)
      return failure ? fail(c, failure) : c.json({ text: await response.text() })
    })
