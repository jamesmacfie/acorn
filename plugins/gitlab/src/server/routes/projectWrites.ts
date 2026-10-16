import type { Context } from 'hono'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { type AppEnv, type PluginDatabase, respondError, type RouteResult } from '@acorn/plugin-api/node'
import { notes } from '../../node/schema'
import { gl, glError, glGraphQL, glJson, projectRef, type GitlabSession } from '../gitlabApi'
import { type GitlabEmit, NO_EMIT } from '../events'
import { mirroredMergeRequest, refreshMergeRequest, type MirrorKey } from '../mirror/detail'
import { mirroredProject } from '../mirror/projects'
import { createMergeRequest } from '../createMergeRequest'
import { fail, mergeRequestKey, projectRequest } from './context'
import type { GitlabServers } from '../servers'

// Everything under /v1/p/gitlab/projects that writes. Each verb is one GitLab call, then a read of the
// merge request's detail into the mirror, so the reader's next fetch already shows what changed.

const text = z.object({ body: z.string().trim().min(1).max(65_536) })
const name = z.object({ name: z.string().trim().min(1).max(255) })
const login = z.object({ login: z.string().trim().min(1).max(255) })
const merge = z.object({ method: z.enum(['merge', 'squash']).default('merge') })
const draft = z.object({ draft: z.boolean() })
const resolved = z.object({ resolved: z.boolean() })
const diffNote = text.extend({
  path: z.string().min(1).max(4096),
  oldLine: z.number().int().positive().nullable(),
  newLine: z.number().int().positive().nullable(),
})
const create = z.object({
  title: z.string().trim().min(1).max(255),
  body: z.string().max(65_536).default(''),
  base: z.string().min(1).max(255).optional(),
  head: z.string().min(1).max(255),
  draft: z.boolean().default(false),
})

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})
const put = (body: unknown): RequestInit => ({ ...json(body), method: 'PUT' })

type Write = (args: {
  session: GitlabSession
  key: MirrorKey
  base: string
  input: Record<string, unknown>
}) => Promise<RouteResult<unknown>>

const rest =
  (
    path: (base: string, input: Record<string, unknown>) => string,
    init: (input: Record<string, unknown>) => RequestInit,
  ) =>
  async ({ session, base, input }: Parameters<Write>[0]): Promise<RouteResult<unknown>> =>
    glJson(session, path(base, input), init(input))

const graphQL =
  (
    mutation: string,
    field: string,
    variables: (key: MirrorKey, input: Record<string, unknown>) => Record<string, unknown>,
  ) =>
  async ({ session, key, input }: Parameters<Write>[0]): Promise<RouteResult<unknown>> => {
    const answer = await glGraphQL<Record<string, { errors: string[] }>>(session, mutation, variables(key, input))
    if (!answer.ok) return answer
    const errors = answer.value[field]?.errors ?? []
    return errors.length ? { ok: false, failure: { error: 'gitlab_refused', status: 403, detail: errors } } : answer
  }

const SET_DRAFT = `mutation SetDraft($projectPath: ID!, $iid: String!, $draft: Boolean!) {
  mergeRequestSetDraft(input: { projectPath: $projectPath, iid: $iid, draft: $draft }) { errors }
}`
const SET_REVIEWERS = `mutation SetReviewers($projectPath: ID!, $iid: String!, $logins: [String!]!, $mode: MutationOperationMode!) {
  mergeRequestSetReviewers(input: { projectPath: $projectPath, iid: $iid, reviewerUsernames: $logins, operationMode: $mode }) { errors }
}`

export const projectWrites = (db: PluginDatabase, servers: GitlabServers, emit: GitlabEmit = NO_EMIT) => {
  async function run(c: Context<AppEnv>, schema: z.ZodType<Record<string, unknown>> | null, write: Write) {
    const parsed = schema
      ? schema.safeParse(await c.req.json().catch(() => null))
      : { success: true as const, data: {} }
    if (!parsed.success) return respondError(c, 400, 'bad_request')
    const request = await projectRequest(c, db, servers)
    if (!request.ok) return request.response
    const key = mergeRequestKey(c, request.value)
    if (!key) return respondError(c, 400, 'bad_number')
    const base = `/projects/${projectRef(key.path)}/merge_requests/${key.iid}`
    const result = await write({ session: request.value.session, key, base, input: parsed.data })
    if (!result.ok) return fail(c, result.failure)
    await refreshMergeRequest(request.value.session, db, key, emit)
    return c.json({ ok: true })
  }

  // A reply goes to the note's discussion, which the mirror knows. A note the mirror hasn't seen can't
  // be replied to.
  async function discussionOf(key: MirrorKey, noteId: number) {
    const [note] = await db
      .select({ discussionId: notes.discussionId })
      .from(notes)
      .where(
        and(
          eq(notes.connectionId, key.connectionId),
          eq(notes.projectId, key.projectId),
          eq(notes.iid, key.iid),
          eq(notes.id, noteId),
        ),
      )
    return note?.discussionId ?? null
  }

  return (
    new Hono<AppEnv>()
      .post('/:host/:path/merge-requests', async (c) => {
        const parsed = create.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return respondError(c, 400, 'bad_request')
        const request = await projectRequest(c, db, servers)
        if (!request.ok) return request.response
        const project = await mirroredProject(db, request.value.server.connectionId, request.value.project.path)
        const created = await createMergeRequest(
          request.value.session,
          { path: request.value.project.path, defaultBranch: project?.defaultBranch ?? null },
          parsed.data,
        )
        return created.ok ? c.json(created.value) : fail(c, created.failure)
      })
      .post('/:host/:path/merge-requests/:number/comments', (c) =>
        run(
          c,
          text,
          rest(
            (base) => `${base}/notes`,
            (input) => json({ body: input.body }),
          ),
        ),
      )
      .post('/:host/:path/merge-requests/:number/approve', (c) =>
        run(
          c,
          null,
          rest(
            (base) => `${base}/approve`,
            () => json({}),
          ),
        ),
      )
      .post('/:host/:path/merge-requests/:number/merge', (c) =>
        run(c, merge, async ({ session, base, input }) => {
          const response = await gl(session, `${base}/merge`, put({ squash: input.method === 'squash' }))
          // GitLab says 405, 406, 409 or 422 when the merge request can't merge as it stands.
          if ([405, 406, 409, 422].includes(response.status))
            return { ok: false, failure: { error: 'merge_failed', status: 403 } }
          const failure = glError(response)
          return failure ? { ok: false, failure } : { ok: true, value: null }
        }),
      )
      .post('/:host/:path/merge-requests/:number/close', (c) =>
        run(
          c,
          null,
          rest(
            (base) => base,
            () => put({ state_event: 'close' }),
          ),
        ),
      )
      .post('/:host/:path/merge-requests/:number/reopen', (c) =>
        run(
          c,
          null,
          rest(
            (base) => base,
            () => put({ state_event: 'reopen' }),
          ),
        ),
      )
      .post('/:host/:path/merge-requests/:number/draft', (c) =>
        run(
          c,
          draft,
          graphQL(SET_DRAFT, 'mergeRequestSetDraft', (key, input) => ({
            projectPath: key.path,
            iid: String(key.iid),
            draft: input.draft,
          })),
        ),
      )
      .post('/:host/:path/merge-requests/:number/labels', (c) =>
        run(
          c,
          name,
          rest(
            (base) => base,
            (input) => put({ add_labels: input.name }),
          ),
        ),
      )
      .delete('/:host/:path/merge-requests/:number/labels', (c) =>
        run(
          c,
          name,
          rest(
            (base) => base,
            (input) => put({ remove_labels: input.name }),
          ),
        ),
      )
      .post('/:host/:path/merge-requests/:number/reviewers', (c) =>
        run(
          c,
          login,
          graphQL(SET_REVIEWERS, 'mergeRequestSetReviewers', (key, input) => ({
            projectPath: key.path,
            iid: String(key.iid),
            logins: [input.login],
            mode: 'APPEND',
          })),
        ),
      )
      .delete('/:host/:path/merge-requests/:number/reviewers', (c) =>
        run(
          c,
          login,
          graphQL(SET_REVIEWERS, 'mergeRequestSetReviewers', (key, input) => ({
            projectPath: key.path,
            iid: String(key.iid),
            logins: [input.login],
            mode: 'REMOVE',
          })),
        ),
      )
      // A new thread on a line. GitLab places it by the merge request's three diff commits, from the
      // mirror, and by the line on each side: both for an unchanged line, one for an added or a deleted one.
      .post('/:host/:path/merge-requests/:number/notes', (c) =>
        run(c, diffNote, async ({ session, key, base, input }) => {
          const row = await mirroredMergeRequest(db, key)
          if (!row?.headSha || !row.baseSha || !row.startSha)
            return { ok: false, failure: { error: 'head_sha_unknown', status: 404 } }
          return glJson(
            session,
            `${base}/discussions`,
            json({
              body: input.body,
              position: {
                position_type: 'text',
                base_sha: row.baseSha,
                start_sha: row.startSha,
                head_sha: row.headSha,
                old_path: input.path,
                new_path: input.path,
                ...(input.oldLine != null ? { old_line: input.oldLine } : {}),
                ...(input.newLine != null ? { new_line: input.newLine } : {}),
              },
            }),
          )
        }),
      )
      .post('/:host/:path/merge-requests/:number/notes/:noteId/replies', async (c) => {
        const noteId = Number(c.req.param('noteId'))
        if (!Number.isSafeInteger(noteId)) return respondError(c, 400, 'bad_request')
        return run(c, text, async ({ session, key, base, input }) => {
          const discussion = await discussionOf(key, noteId)
          if (!discussion) return { ok: false, failure: { error: 'not_found', status: 404 } }
          return glJson(session, `${base}/discussions/${discussion}/notes`, json({ body: input.body }))
        })
      })
      .post('/:host/:path/merge-requests/:number/discussions/:discussionId/resolve', (c) =>
        run(c, resolved, ({ session, base, input }) =>
          glJson(
            session,
            `${base}/discussions/${encodeURIComponent(c.req.param('discussionId'))}?resolved=${input.resolved === true}`,
            { method: 'PUT' },
          ),
        ),
      )
      .post('/:host/:path/jobs/:jobId/retry', async (c) => {
        const jobId = Number(c.req.param('jobId'))
        if (!Number.isSafeInteger(jobId) || jobId <= 0) return respondError(c, 400, 'bad_request')
        const request = await projectRequest(c, db, servers)
        if (!request.ok) return request.response
        const retried = await glJson(
          request.value.session,
          `/projects/${projectRef(request.value.project.path)}/jobs/${jobId}/retry`,
          json({}),
        )
        return retried.ok ? c.json({ ok: true }) : fail(c, retried.failure)
      })
  )
}
