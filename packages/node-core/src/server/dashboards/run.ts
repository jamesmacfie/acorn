import { createHash } from 'node:crypto'
import { canonicalDataEncoding, DATA_LIMITS, MISSING, parseDataValue, readDataPointer } from '@acorn/protocol/dataValues.ts'
import type { DashboardContent, DashboardScope, PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataSourceQuery, DataSourceResult } from '@acorn/protocol/dataSources.ts'
import { bindPanelRows, describePanelPlan, groupPlanRows, resolvePlanColumns, runPlanStages, sortPlanRows, upgradePanelContent, validatePanelPlan, type DashboardRun, type PlanProblem, type PlanSource } from '@acorn/dashboards-core/plan.ts'
import type { Env } from '../bindings'
import type { DataSourceInvocation } from '../dataSources/authority'
import { invokeDataSource } from '../dataSources/runtime'
import { authorizeQueryScope, resolveQuery } from '../queries/runtime'
import { dashboardStore } from './store'
import { getDb } from '../db'
import { describeError } from '../telemetry/logger'
import { dashboardSharedRead } from './readCache'

const MAX_TOTAL_RECORDS = 20_000
const MAX_STAGE_ROWS = 25_000
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024
const MAX_RUN_MS = 60_000
const SHARED_READ_MS = 5_000

function fieldCanBeUnknown(source: PlanSource, pointer: string): boolean {
  let schema = source.description.schema
  for (const part of pointer.slice(1).split('/')) {
    const key = part.replaceAll('~1', '/').replaceAll('~0', '~')
    if (!schema.required?.includes(key) || !schema.properties?.[key]) return true
    schema = schema.properties[key]
  }
  return false
}

function plannedQuery(query: DataSourceQuery, plan: PanelPlan, source: PlanSource): DataSourceQuery {
  let next = query
  for (const stage of plan.stages) {
    const where = stage.where
    if (where.kind !== 'comparison' || where.left.address.from !== 'item'
      || (where.right && where.right.address.from !== 'literal')) continue
    const pointer = where.left.address.pointer
    const column = plan.columns.find(candidate => `/${candidate.id}` === pointer)
    const binding = column?.bind[source.instanceId]
    if (!binding || !('field' in binding) || binding.values) continue
    const field = source.description.fields.find(candidate => candidate.pointer === binding.field)
    if (!field?.query?.operators.includes(where.operator)) continue
    if (fieldCanBeUnknown(source, binding.field) && !['missing', 'present', 'eq'].includes(where.operator)) continue
    const pushed = { ...where, left: { ...where.left, address: { from: 'item' as const, pointer: binding.field } } }
    next = { ...next, predicate: next.predicate ? { kind: 'all', predicates: [next.predicate, pushed] } : pushed }
  }
  if (plan.sources.length === 1 && plan.stages.length === 0 && !query.take && plan.limit && plan.sort?.length) {
    const sort = plan.sort.flatMap(item => {
      const binding = plan.columns.find(column => column.id === item.column)?.bind[source.instanceId]
      return binding && 'field' in binding && source.description.fields.find(field => field.pointer === binding.field)?.query?.sortable
        ? [{ pointer: binding.field, direction: item.direction }] : []
    })
    if (sort.length === plan.sort.length) next = { ...next, sort, take: plan.limit }
  }
  return next
}

const digest = (value: unknown): string => createHash('sha256').update(canonicalDataEncoding(parseDataValue(value))).digest('hex')

async function sharedRead(env: Env, source: PlanSource, mode: 'preview' | 'execution', evaluationTime: number, invocation: DataSourceInvocation): Promise<DataSourceResult> {
  const window = Math.floor(evaluationTime / SHARED_READ_MS)
  const key = digest({ principal: invocation.principal.userId, query: source.query, revision: source.description.revision, mode, window })
  return dashboardSharedRead(key, () => invokeDataSource(env, {
    operation: 'query', query: source.query, mode, evaluationTime,
    pageSize: mode === 'preview' ? DATA_LIMITS.previewRecords : DATA_LIMITS.options,
  }, invocation))
}

export async function runDashboard(env: Env, args: {
  scope: DashboardScope
  target: { kind: 'published'; id: string; revision?: number } | { kind: 'draft'; content: DashboardContent }
  mode: 'preview' | 'execution'
  viewerZone?: string
  evaluationTime?: number
}, invocation: DataSourceInvocation): Promise<DashboardRun> {
  const runInvocation = { ...invocation, signal: AbortSignal.any([invocation.signal, AbortSignal.timeout(MAX_RUN_MS)]) }
  await authorizeQueryScope(env, args.scope, runInvocation)
  const content = args.target.kind === 'draft' ? args.target.content
    : dashboardStore(getDb(env)).published(args.scope, args.target.id, args.target.revision).content
  let plan: PanelPlan = 'version' in content ? content as PanelPlan : upgradePanelContent(content)
  const evaluationTime = args.evaluationTime ?? Date.now()
  const problems: PlanProblem[] = []
  const sources: PlanSource[] = []
  const sourceDiagnostics: DashboardRun['diagnostics']['sources'] = []
  const started = Date.now()
  for (const entry of plan.sources) {
    try {
      const resolved = await resolveQuery(env, args.scope, entry.reference, {}, runInvocation)
      const description = await invokeDataSource(env, { operation: 'describe', source: resolved.query.source, scope: resolved.query.scope }, runInvocation)
      sources.push({ instanceId: entry.id, label: entry.label, query: resolved.query, description })
      sourceDiagnostics.push({ id: entry.id, label: entry.label, revision: description.revision,
        queryDigest: resolved.published?.digest ?? digest(entry.reference.kind === 'inline' ? entry.reference.content : null),
        parameters: resolved.parameters, account: resolved.query.scope.connectionId ?? null })
    } catch (error) {
      problems.push({ path: `/sources/${plan.sources.indexOf(entry)}`, message: runInvocation.signal.reason?.name === 'TimeoutError' ? 'Run time budget exceeded.' : `${entry.label}: ${describeError(error).message}`, severity: 'error' })
      sourceDiagnostics.push({ id: entry.id, label: entry.label })
    }
  }
  plan = resolvePlanColumns(plan, sources)
  const validation = validatePanelPlan(plan, sources)
  const unavailableColumns = new Set<number>()
  for (const problem of validation) {
    const binding = /^\/columns\/(\d+)\/bind\//.exec(problem.path)
    if (binding && /no longer describes|now describes/.test(problem.message)) {
      unavailableColumns.add(Number(binding[1]))
      problems.push({ ...problem, severity: 'warning' })
    } else problems.push(problem)
  }
  if (!problems.some(problem => problem.severity === 'error')) {
    for (const source of sources) {
      if (Date.now() - started > MAX_RUN_MS) { problems.push({ path: '/sources', message: 'Run time budget exceeded.', severity: 'error' }); break }
      try {
        source.query = plannedQuery(source.query, plan, source)
        source.result = await sharedRead(env, source, args.mode, evaluationTime, runInvocation)
        const diagnostic = sourceDiagnostics.find(entry => entry.id === source.instanceId)!
        diagnostic.completeness = source.result.completeness
        diagnostic.readTime = source.result.readTime
        if (source.result.completeness.kind === 'incomplete') problems.push({ path: `/sources/${plan.sources.findIndex(entry => entry.id === source.instanceId)}`, message: `${source.label} returned incomplete data (${source.result.completeness.cause}).`, severity: 'warning' })
        if (sources.reduce((sum, entry) => sum + (entry.result?.records.length ?? 0), 0) > MAX_TOTAL_RECORDS) { problems.push({ path: '/sources', message: 'Total record budget exceeded.', severity: 'error' }); break }
      } catch (error) {
        problems.push({ path: `/sources/${plan.sources.findIndex(entry => entry.id === source.instanceId)}`, message: runInvocation.signal.reason?.name === 'TimeoutError' ? 'Run time budget exceeded.' : `${source.label}: ${describeError(error).message}`, severity: 'error' })
      }
    }
  }
  const initial = problems.some(problem => problem.severity === 'error') ? [] : bindPanelRows(plan, sources)
  for (const [index, column] of plan.columns.entries()) {
    if (!column.choices?.length) continue
    const declared = new Set(column.choices.map(choice => choice.id))
    const unmatched = new Set<string>()
    for (const source of sources) {
      const binding = column.bind[source.instanceId]
      if (!binding || !('field' in binding)) continue
      for (const record of source.result?.records ?? []) {
        const raw = readDataPointer(record.data, binding.field)
        if (raw === MISSING || raw === null || typeof raw !== 'string') continue
        const mapped = binding.values ? Object.entries(binding.values).find(([, values]) => values.includes(raw))?.[0] : raw
        if (!mapped || !declared.has(mapped)) unmatched.add(raw)
      }
    }
    if (unmatched.size) problems.push({ path: `/columns/${index}/choices`, message: `${column.label} has new values to map: ${[...unmatched].slice(0, 10).join(', ')}.`, severity: 'warning' })
  }
  for (const row of initial) for (const index of unavailableColumns) {
    const column = plan.columns[index]
    if (column) row.values[column.id] = null
  }
  const staged = runPlanStages(plan, initial)
  if (staged.counts.some(count => count.input > MAX_STAGE_ROWS || count.output > MAX_STAGE_ROWS)) problems.push({ path: '/stages', message: 'Intermediate row budget exceeded.', severity: 'error' })
  const rows = sortPlanRows(plan, staged.rows).slice(0, plan.limit ?? 5000)
  if (new TextEncoder().encode(JSON.stringify(rows)).byteLength > MAX_OUTPUT_BYTES) problems.push({ path: '/rows', message: 'Output byte budget exceeded.', severity: 'error' })
  const effectivePlan = plan.time.mode === 'viewer' && args.viewerZone ? { ...plan, time: { ...plan.time, zone: args.viewerZone } } : plan
  return {
    plan, rows: problems.some(problem => problem.severity === 'error') ? [] : rows,
    groups: problems.some(problem => problem.severity === 'error') ? [] : groupPlanRows(effectivePlan, rows, evaluationTime),
    description: describePanelPlan(plan, sources),
    diagnostics: {
      problems, sources: sourceDiagnostics, stages: staged.counts, evaluationTime,
      plugins: [...new Set(sources.map(source => source.query.source.pluginId))],
      accounts: [...new Set(sources.flatMap(source => source.query.scope.connectionId ? [source.query.scope.connectionId] : []))],
      complete: !problems.some(problem => problem.severity === 'error') && sources.every(source => source.result?.completeness.kind === 'complete' || source.result?.completeness.kind === 'bounded'),
    },
  }
}
