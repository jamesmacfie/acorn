import { z } from 'zod'
import type { PluginFetchHandler } from '@acorn/plugin-api/node'
import { dataRecordRefSchema } from '@acorn/protocol/dataSources.ts'
import { jobSourceDescription, mergeRequestSourceDescription } from './sourceDescriptions'
import { formatMergeRequestRef, mergeRequestUrl } from '../../shared/mergeRequestRef'
import { GITLAB_HOST } from '../config'
import { gl, glError, GITLAB_PROVIDER, projectRef } from '../gitlabApi'
import { createProjectSourceHandler } from './projectSource'

// GitLab's two read sources over the projects a panel names. 100 records a project: past that the
// read says it's incomplete rather than reading on.
const PER_PROJECT = 100

const time = (value: string | null | undefined): number | null => (value ? Date.parse(value) : null)

async function list<T>(token: string, path: string, signal: AbortSignal): Promise<T[]> {
  const response = await gl({ token }, path, { signal })
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
    read: async ({ token }, project, connectionId, signal) => {
      const rows = await list<RestMergeRequest>(
        token,
        `/projects/${projectRef(project)}/merge_requests?state=all&order_by=updated_at&per_page=${PER_PROJECT}`,
        signal,
      )
      return {
        truncated: rows.length >= PER_PROJECT,
        records: rows.map((row) => {
          const url = row.web_url || mergeRequestUrl(project, row.iid)
          return {
            recordId: formatMergeRequestRef(project, row.iid),
            data: {
              project,
              remoteRepository: `${GITLAB_HOST}/${project}`,
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
    const path = `/projects/${projectRef(job.project)}/jobs/${job.jobId}`
    const current = await gl({ token }, path, { signal: request.signal })
    if (!current.ok) return { status: current.status }
    if (!RETRYABLE.has(((await current.json()) as RestJob).status)) return { status: 409 }
    const retried = await gl({ token }, `${path}/retry`, { method: 'POST', signal: request.signal })
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
    read: async ({ token }, project, _connectionId, signal) => {
      const rows = await list<RestJob>(token, `/projects/${projectRef(project)}/jobs?per_page=${PER_PROJECT}`, signal)
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
