import { z } from 'zod'
import type { PluginFetchHandler } from '@acorn/plugin-api/node'
import { dataRecordRefSchema, type DataSourceQuery } from '@acorn/protocol/dataSources.ts'
import {
  jobSourceDescription,
  mergeRequestSourceDescription,
  reviewCommentSourceDescription,
} from './sourceDescriptions'
import { formatMergeRequestRef, mergeRequestUrl, projectAddress } from '../../shared/mergeRequestRef'
import { gl, glError, GITLAB_PROVIDER, projectRef, type GitlabSession } from '../gitlabApi'
import { serverOf } from '../servers'
import { createProjectSourceHandler } from './projectSource'

// GitLab's read sources over the projects a panel names. 100 records a project: past that the read
// says it's incomplete rather than reading on.
const PER_PROJECT = 100

const time = (value: string | null | undefined): number | null => (value ? Date.parse(value) : null)

async function list<T>(session: GitlabSession, path: string, signal: AbortSignal): Promise<T[]> {
  const response = await gl(session, path, { signal })
  if (glError(response)) throw new Error('gitlab_unavailable')
  return (await response.json()) as T[]
}

type RestMergeRequest = {
  iid: number
  title: string
  state: string
  draft: boolean
  author: { username: string } | null
  source_branch: string
  target_branch: string
  labels: string[]
  reviewers?: { username: string }[]
  created_at: string
  updated_at: string
  web_url: string
}

export const createMergeRequestSourceHandler = () =>
  createProjectSourceHandler({
    description: mergeRequestSourceDescription,
    read: async (session, project, connectionId, signal) => {
      const address = projectAddress(new URL(session.origin).hostname, project)
      const rows = await list<RestMergeRequest>(
        session,
        `/projects/${projectRef(project)}/merge_requests?state=all&order_by=updated_at&per_page=${PER_PROJECT}`,
        signal,
      )
      return {
        truncated: rows.length >= PER_PROJECT,
        records: rows.map((row) => {
          const url = row.web_url || mergeRequestUrl(address, row.iid)
          return {
            recordId: formatMergeRequestRef(address, row.iid),
            data: {
              project,
              remoteRepository: address,
              number: row.iid,
              title: row.title,
              state: row.state === 'opened' ? 'open' : row.state === 'merged' ? 'merged' : 'closed',
              draft: row.draft,
              author: row.author?.username ?? null,
              gitlabConnectionId: connectionId,
              sourceBranch: row.source_branch,
              targetBranch: row.target_branch,
              labels: row.labels,
              reviewers: (row.reviewers ?? []).map((reviewer) => reviewer.username),
              createdAt: time(row.created_at) ?? 0,
              updatedAt: time(row.updated_at) ?? 0,
              url,
            },
            display: { title: row.title, url },
            action: { verb: 'openUrl' as const, url },
          }
        }),
      }
    },
  })

// Review comments live under merge requests, so a read lists a project's merge requests and then each
// one's discussions. This many merge requests a project keeps that within a panel's time budget.
const COMMENTED_MERGE_REQUESTS = 25
const DISCUSSIONS = 100

type RestNote = {
  id: number
  type: string | null
  system: boolean
  author: { username: string } | null
  created_at: string
  resolvable: boolean
  resolved?: boolean
}

/** The latest lower bound a query sets on a comment's creation time, or null without one. A comment
 *  made after it is on a merge request updated after it, so only those need reading. */
function createdSince(query: DataSourceQuery): number | null {
  const predicate = query.predicate
  const bounds = (predicate?.kind === 'all' ? predicate.predicates : predicate ? [predicate] : []).flatMap((part) =>
    part.kind === 'comparison' &&
    part.left.address.from === 'item' &&
    part.left.address.pointer === '/createdAt' &&
    (part.operator === 'gt' || part.operator === 'gte') &&
    part.right?.address.from === 'literal' &&
    typeof part.right.address.value === 'number'
      ? [part.right.address.value]
      : [],
  )
  return bounds.length ? Math.max(...bounds) : null
}

export const createReviewCommentSourceHandler = () =>
  createProjectSourceHandler({
    description: reviewCommentSourceDescription,
    read: async (session, project, _connectionId, signal, query) => {
      const address = projectAddress(new URL(session.origin).hostname, project)
      const since = createdSince(query)
      // One more than the read keeps, to tell a full list from a longer one.
      const mergeRequests = await list<RestMergeRequest>(
        session,
        `/projects/${projectRef(project)}/merge_requests?state=all&order_by=updated_at&sort=desc&per_page=${COMMENTED_MERGE_REQUESTS + 1}${since === null ? '' : `&updated_after=${new Date(since).toISOString()}`}`,
        signal,
      )
      let truncated = mergeRequests.length > COMMENTED_MERGE_REQUESTS
      const records = []
      for (const row of mergeRequests.slice(0, COMMENTED_MERGE_REQUESTS)) {
        const discussions = await list<{ notes: RestNote[] }>(
          session,
          `/projects/${projectRef(project)}/merge_requests/${row.iid}/discussions?per_page=${DISCUSSIONS}`,
          signal,
        )
        truncated ||= discussions.length >= DISCUSSIONS
        const pullUrl = row.web_url || mergeRequestUrl(address, row.iid)
        const title = `${project}!${row.iid}: ${row.title}`
        const pullAuthor = row.author?.username ?? null
        for (const discussion of discussions)
          for (const [index, note] of discussion.notes.entries()) {
            // A system note is GitLab's own record of an event, such as a push, not a person's comment.
            if (note.system) continue
            const author = note.author?.username ?? null
            const url = `${pullUrl}#note_${note.id}`
            records.push({
              recordId: `${address}!${row.iid}:${note.id}`,
              data: {
                id: String(note.id),
                title,
                repository: project,
                number: row.iid,
                pullTitle: row.title,
                pullUrl,
                author,
                authorIsPullAuthor: author !== null && author === pullAuthor,
                kind: index > 0 ? 'reply' : note.type === 'DiffNote' ? 'inline' : 'conversation',
                reviewState: null,
                resolved: note.resolvable ? note.resolved === true : null,
                createdAt: time(note.created_at) ?? 0,
                url,
              },
              display: { title, url },
              // The merge request's address, which Acorn opens in its own merge request view when it can.
              action: { verb: 'openUrl' as const, url: pullUrl },
            })
          }
      }
      return { truncated, records }
    },
  })

type RestJob = {
  id: number
  name: string
  stage: string
  status: string
  ref: string
  created_at: string
  finished_at: string | null
  duration: number | null
  web_url: string
  pipeline?: { id: number } | null
}

const retryPath = '/v1/p/gitlab/data/jobs/retry'
const retryAction = {
  id: 'retry-job',
  label: 'Retry job',
  risk: 'execute' as const,
  action: { verb: 'runNodeAction' as const, path: retryPath },
}
// A job GitLab retries is one that finished.
const RETRYABLE = new Set(['success', 'failed', 'canceled'])

const retrySchema = z.strictObject({
  ref: dataRecordRefSchema,
  actionId: z.literal('retry-job'),
  idempotencyKey: z.string().uuid(),
})

// The job a record names, held to the projects its own query read, so a forged ref can't reach
// another project's jobs.
function jobReference(ref: z.infer<typeof dataRecordRefSchema>) {
  if (
    ref.pluginId !== 'gitlab' ||
    ref.sourceId !== 'pipeline-jobs' ||
    !ref.connectionId ||
    ref.scope?.connectionId !== ref.connectionId
  )
    return undefined
  const match = /^(.+):(\d+)$/.exec(ref.recordId)
  const projects = ref.scope.parameters.projects
  if (!match || !Array.isArray(projects) || !projects.includes(match[1]!)) return undefined
  return { project: match[1]!, jobId: match[2]! }
}

const retryJob: PluginFetchHandler = async (request, context) => {
  if (context.principal.kind !== 'device') return Response.json({ error: 'forbidden' }, { status: 403 })
  const parsed = retrySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'invalid_request' }, { status: 400 })
  const job = jobReference(parsed.data.ref)
  if (!job) return Response.json({ error: 'invalid_request' }, { status: 400 })
  const answers = await context.providers.withConnections(GITLAB_PROVIDER, async (connection, token) => {
    if (connection.id !== parsed.data.ref.connectionId) return undefined
    const session = { origin: serverOf(connection).origin, token }
    const path = `/projects/${projectRef(job.project)}/jobs/${job.jobId}`
    const current = await gl(session, path, { signal: request.signal })
    if (!current.ok) return { status: current.status }
    if (!RETRYABLE.has(((await current.json()) as RestJob).status)) return { status: 409 }
    const retried = await gl(session, `${path}/retry`, { method: 'POST', signal: request.signal })
    return { status: retried.ok ? 200 : retried.status }
  })
  const answer = answers[0]
  if (!answer) return Response.json({ error: 'connection_unavailable' }, { status: 403 })
  if (answer.status === 409) return Response.json({ error: 'job_not_retryable' }, { status: 409 })
  return answer.status === 200
    ? Response.json({ outcome: 'done' })
    : Response.json({ error: 'gitlab_retry_failed' }, { status: 502 })
}

export const createJobSourceHandler = () =>
  createProjectSourceHandler({
    description: jobSourceDescription,
    read: async (session, project, _connectionId, signal) => {
      const rows = await list<RestJob>(session, `/projects/${projectRef(project)}/jobs?per_page=${PER_PROJECT}`, signal)
      return {
        truncated: rows.length >= PER_PROJECT,
        records: rows.map((job) => ({
          recordId: `${project}:${job.id}`,
          data: {
            project,
            jobId: job.id,
            pipelineId: job.pipeline?.id ?? null,
            name: job.name,
            stage: job.stage,
            status: job.status,
            ref: job.ref,
            createdAt: time(job.created_at) ?? 0,
            finishedAt: time(job.finished_at),
            durationMs: job.duration == null ? null : Math.round(job.duration * 1000),
            url: job.web_url,
          },
          display: { title: job.name, url: job.web_url },
          action: { verb: 'openUrl' as const, url: job.web_url },
          ...(RETRYABLE.has(job.status) ? { actions: [retryAction] } : {}),
        })),
      }
    },
    actions: { retry: retryJob },
  })
