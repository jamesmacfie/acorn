import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { PluginFetchHandler } from '@acorn/plugin-api/node'
import { compareDataValues, type DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { dataRecordRefSchema, dataSourceRequestSchema, type DataSourcePage } from '@acorn/protocol/dataSources.ts'
import { DATA_LIMITS, MISSING, readDataPointer } from '@acorn/protocol/dataValues.ts'
import { actionsSourceDescription } from '../../shared/actionsSource'
import { gh } from '../githubApi'
import { repositoryName } from './pullQuery'
import { readRepositoryOptions } from './pullRead'

const date = z.string().nullable().transform(value => value === null ? null : Date.parse(value))
const runSchema = z.object({ id: z.number().int(), name: z.string().nullable(), run_attempt: z.number().int().positive(),
  created_at: z.string(), pull_requests: z.array(z.object({ number: z.number().int() })) })
const runsSchema = z.object({ total_count: z.number().int(), workflow_runs: z.array(runSchema) })
const jobSchema = z.object({ id: z.number().int(), name: z.string(), status: z.string(), conclusion: z.string().nullable(),
  started_at: date, completed_at: date, html_url: z.string().url() })
const jobsSchema = z.object({ total_count: z.number().int(), jobs: z.array(jobSchema) })
const currentJobSchema = z.object({ id: z.number().int(), status: z.string(), conclusion: z.string().nullable() })
const rerunSchema = z.strictObject({ ref: dataRecordRefSchema, actionId: z.literal('rerun-job'), idempotencyKey: z.string().uuid() })
const rerunPath = '/v1/p/github/data/actions/rerun'
const rerunAction = { id: 'rerun-job', label: 'Re-run job', risk: 'execute' as const,
  action: { verb: 'runNodeAction' as const, path: rerunPath } }

function jobReference(ref: z.infer<typeof dataRecordRefSchema>): { repository: string; jobId: string } | undefined {
  if (ref.pluginId !== 'github' || ref.sourceId !== 'actions-jobs' || !ref.connectionId
    || ref.scope?.connectionId !== ref.connectionId) return undefined
  const match = /^([\w.-]+\/[\w.-]+):(\d+)$/.exec(ref.recordId)
  if (!match || !Array.isArray(ref.scope.parameters.repositories)
    || !ref.scope.parameters.repositories.some(item => item === match[1])) return undefined
  return { repository: repositoryName(match[1]), jobId: match[2]! }
}

async function currentJob(ref: z.infer<typeof dataRecordRefSchema>, context: Parameters<PluginFetchHandler>[1], signal: AbortSignal) {
  const job = jobReference(ref)
  if (!job) return undefined
  const answers = await context.providers.withConnections('github', async (connection, token) => {
    if (connection.id !== ref.connectionId || connection.status !== 'connected') return undefined
    const path = `/repos/${job.repository}/actions/jobs/${job.jobId}`
    const response = await gh(token, path, { signal })
    if (response.status === 404) return undefined
    if (!response.ok) throw new Error('github_actions_unavailable')
    const current = currentJobSchema.parse(await response.json())
    if (current.id.toString() !== job.jobId) return undefined
    return { token, path, eligible: current.status === 'completed' }
  })
  return answers[0]
}

async function rest<T>(token: string, path: string, schema: z.ZodType<T>, signal: AbortSignal): Promise<T> {
  const response = await gh(token, path, { signal })
  if (!response.ok) throw new Error('github_actions_unavailable')
  return schema.parse(await response.json())
}

function matches(data: DataSourcePage['records'][number]['data'], predicate: DataPredicate): boolean {
  if (predicate.kind !== 'comparison') return predicate.kind === 'all'
    ? predicate.predicates.every(part => matches(data, part)) : predicate.predicates.some(part => matches(data, part))
  if (predicate.left.address.from !== 'item' || predicate.right?.address.from !== 'literal') throw new Error('unsupported_filter')
  try { return compareDataValues(readDataPointer(data, predicate.left.address.pointer), predicate.operator,
    predicate.right?.address.from === 'literal' ? predicate.right.address.value : MISSING) }
  catch { return false }
}

async function readJobs(token: string, repositories: string[], signal: AbortSignal): Promise<DataSourcePage> {
  const records: DataSourcePage['records'] = []
  let truncated = false
  let oldest = Date.now()
  let runBudget = 20
  for (const repository of repositories) {
    const { total_count, workflow_runs } = await rest(token, `/repos/${repository}/actions/runs?per_page=100&page=1`, runsSchema, signal)
    if (total_count > workflow_runs.length || workflow_runs.length > runBudget) truncated = true
    for (const run of workflow_runs.slice(0, runBudget)) {
      runBudget--
      oldest = Math.min(oldest, Date.parse(run.created_at))
      if (run.run_attempt > 3) truncated = true
      for (let attempt = 1; attempt <= Math.min(run.run_attempt, 3); attempt++) {
        const page = await rest(token, `/repos/${repository}/actions/runs/${run.id}/attempts/${attempt}/jobs?per_page=100&page=1`, jobsSchema, signal)
        if (page.total_count > page.jobs.length) truncated = true
        for (const job of page.jobs) {
          const data = { repository, runId: run.id, attempt, workflow: run.name ?? 'Workflow', job: job.name,
            status: job.status, conclusion: job.conclusion, startedAt: job.started_at, completedAt: job.completed_at,
            durationMs: job.started_at !== null && job.completed_at !== null ? Math.max(0, job.completed_at - job.started_at) : null,
            pullRequests: run.pull_requests.map(pull => pull.number), url: job.html_url }
          records.push({ recordId: `${repository}:${job.id}`, data, display: { title: job.name, url: job.html_url },
            action: { verb: 'openUrl', url: job.html_url },
            ...(job.status === 'completed' ? { actions: [rerunAction] } : {}) })
          if (records.length >= DATA_LIMITS.selectionRecords) { truncated = true; break }
        }
        if (records.length >= DATA_LIMITS.selectionRecords) break
      }
      if (runBudget === 0 || records.length >= DATA_LIMITS.selectionRecords) break
    }
    if (runBudget === 0 || records.length >= DATA_LIMITS.selectionRecords) break
  }
  const now = Date.now()
  return { records, revision: actionsSourceDescription.revision, readTime: now,
    coveredRange: { start: oldest, end: now }, completeness: truncated ? { kind: 'incomplete', cause: 'upstream-cap' } : { kind: 'complete' } }
}

type Selection = { key: string; page: DataSourcePage; expires: number }
export function createActionsSourceHandler(): PluginFetchHandler {
  const selections = new Map<string, Selection>()
  return async (request, context) => {
    try {
      if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 })
      if (context.principal.kind !== 'device' && !(context.principal.kind === 'internal' && context.principal.scope === 'service')) return Response.json({ error: 'forbidden' }, { status: 403 })
      if (new URL(request.url).pathname.endsWith('/rerun')) {
        if (context.principal.kind !== 'device') return Response.json({ error: 'forbidden' }, { status: 403 })
        const parsed = rerunSchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return Response.json({ error: 'invalid_request' }, { status: 400 })
        const current = await currentJob(parsed.data.ref, context, request.signal)
        if (!current?.eligible) return Response.json({ error: 'job_no_longer_rerunnable' }, { status: 409 })
        const result = await gh(current.token, `${current.path}/rerun`, { method: 'POST', signal: request.signal })
        return result.status === 201 ? Response.json({ outcome: 'done' }) : Response.json({ error: 'github_rerun_failed' }, { status: result.status })
      }
      const input = dataSourceRequestSchema.parse(await request.json())
      if (input.operation === 'describe') return Response.json(actionsSourceDescription)
      if (input.operation === 'actions') {
        const current = await currentJob(input.ref, context, request.signal)
        return Response.json({ actions: current?.eligible ? [rerunAction] : [] })
      }
      if (input.operation !== 'options' && input.operation !== 'query') return Response.json({ error: 'unsupported_operation' }, { status: 400 })
      const scope = input.operation === 'query' ? input.query.scope : input.scope
      if (!scope.connectionId) throw new Error('connection_required')
      if (input.operation === 'options' && (input.target !== 'parameter' || input.pointer !== '/repositories')) throw new Error('unsupported_options')
      const repositories = input.operation === 'query' ? scope.parameters.repositories : undefined
      if (input.operation === 'query' && (!Array.isArray(repositories) || repositories.length > 5)) throw new Error('invalid_repositories')
      const choices = input.operation === 'query' && Array.isArray(repositories) ? repositories.map(repositoryName) : []
      if (input.operation === 'query' && choices.length === 0) return Response.json({ records: [], revision: actionsSourceDescription.revision,
        readTime: Date.now(), coveredRange: { start: Date.now(), end: Date.now() }, completeness: { kind: 'complete' } })
      for (const [id, item] of selections) if (item.expires < Date.now()) selections.delete(id)
      const key = createHash('sha256').update(JSON.stringify({ userId: context.userId, scope, query: input.operation === 'query' ? input.query : null })).digest('hex')
      const match = input.operation === 'query' && input.cursor ? /^([\w-]+):(\d+)$/.exec(input.cursor) : null
      const selection = match ? selections.get(match[1]!) : undefined
      if (match && (!selection || selection.key !== key)) throw new Error('invalid_cursor')
      if (input.operation === 'query' && input.cursor && !match) throw new Error('invalid_cursor')
      const answers = await context.providers.withConnections('github', async (connection, token) => {
        if (connection.id !== scope.connectionId) return undefined
        if (input.operation === 'options') return { options: await readRepositoryOptions(token, input, request.signal) }
        return { page: selection?.page ?? await readJobs(token, choices, request.signal) }
      })
      const answer = answers[0]
      if (!answer) throw new Error('connection_unavailable')
      if ('options' in answer) return Response.json(answer.options)
      let records = answer.page.records
      if (input.operation !== 'query') throw new Error('invalid_operation')
      if (input.query.predicate) records = records.filter(record => matches(record.data, input.query.predicate!))
      records = [...records].sort((left, right) => {
        for (const sort of input.query.sort) {
          const a = readDataPointer(left.data, sort.pointer)
          const b = readDataPointer(right.data, sort.pointer)
          if (a === b) continue
          if (typeof a !== 'number' || typeof b !== 'number') throw new Error('unsupported_sort')
          return (a - b) * (sort.direction === 'asc' ? 1 : -1)
        }
        return left.recordId.localeCompare(right.recordId)
      })
      if (input.query.take) records = records.slice(0, input.query.take)
      const offset = match ? Number(match[2]) : 0
      if (!Number.isSafeInteger(offset) || offset < 0 || offset >= Math.max(records.length, 1)) throw new Error('invalid_cursor')
      const selected = records.slice(offset, offset + input.pageSize)
      const more = offset + selected.length < records.length
      let id = match?.[1]
      if (more && !id) {
        if (selections.size >= 16) throw new Error('selection_budget')
        id = randomUUID()
        selections.set(id, { key, page: answer.page, expires: Date.now() + DATA_LIMITS.queryMs })
      }
      return Response.json({ ...answer.page, records: selected, completeness: more ? { kind: 'more', cursor: `${id}:${offset + selected.length}` } : answer.page.completeness })
    } catch { return Response.json({ error: 'github_actions_source_failed' }, { status: 502 }) }
  }
}
