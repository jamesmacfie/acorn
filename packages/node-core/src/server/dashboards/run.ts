import { createHash } from 'node:crypto'
import { canonicalDataEncoding, DATA_LIMITS, MISSING, parseDataValue, readDataPointer } from '@acorn/protocol/dataValues.ts'
import type { DashboardContent, DashboardScope, PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataSourceQuery, DataSourceRef, DataSourceResult } from '@acorn/protocol/dataSources.ts'
import type { DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { resolveDataBinding } from '@acorn/protocol/dataQueryResolution.ts'
import { bindPanelRows, describePanelPlan, groupPlanRows, relatePanelRows, resolvePlanColumns, runPlanStages, sortPlanRows, upgradePanelContent, validatePanelPlan, type DashboardRun, type PlanProblem, type PlanSource, type SourceFailure } from '@acorn/dashboards-core/plan.ts'
import type { Env } from '../bindings'
import type { DataSourceInvocation } from '../dataSources/authority'
import { invokeDataSource } from '../dataSources/runtime'
import { DataSourceError } from '../dataSources/validation'
import { authorizeQueryScope, resolveQuery } from '../queries/runtime'
import { dashboardStore } from './store'
import { getDb } from '../db'
import { describeError } from '../telemetry/logger'
import { dashboardSharedRead } from './readCache'
import { sourceCoverageProblem } from './coverage'
import { getConnection } from '../integrations/connections'

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
  if (plan.sources.find(entry => entry.id === source.instanceId)?.role !== 'primary') return query
  let next = query
  for (const stage of plan.stages) {
    if (stage.op !== 'filter') break
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

/** Where a source's problem points: at the input's binding when an input is at fault and the plan
 *  holds the query inline, so the studio marks the input's row, and at the source otherwise. */
const sourcePath = (plan: PanelPlan, index: number, input?: string): string =>
  input && plan.sources[index]?.reference.kind === 'inline' ? `/sources/${index}/reference/content/query/scope/inputs/${input}` : `/sources/${index}`

/** A source that couldn't answer, as a problem. `message` keeps the Node's wording for older clients,
 *  and `failure` carries the code, source, and input so a client can word it and offer the fix. */
function sourceProblem(plan: PanelPlan, index: number, label: string, error: unknown, timedOut: boolean, source?: DataSourceRef): PlanProblem {
  const failure: SourceFailure = {
    code: timedOut ? 'timeout' : error instanceof DataSourceError ? error.code : 'source-error',
    ...(source ? { source: `${source.pluginId}:${source.sourceId}` } : {}),
    ...(!timedOut && error instanceof DataSourceError && error.detail?.input ? { input: error.detail.input } : {}),
    ...(!timedOut && error instanceof DataSourceError && error.detail?.reason ? { reason: error.detail.reason } : {}),
  }
  return { path: sourcePath(plan, index, failure.input), message: timedOut ? 'Run time budget exceeded.' : `${label}: ${describeError(error).message}`, severity: 'error', failure }
}

/** A partial read, as a warning. An input's own partial read names the input, so the client can say
 *  which provider held back. */
function incompleteProblem(plan: PanelPlan, index: number, source: PlanSource, result: DataSourceResult): PlanProblem | undefined {
  if (result.completeness.kind !== 'incomplete') return undefined
  const { cause, count } = result.completeness
  const input = cause === 'invalid-records' ? undefined
    : Object.entries(result.inputs ?? {}).find(([, read]) => read.completeness.kind === 'incomplete')?.[0]
  return { path: sourcePath(plan, index, input), message: `${source.label} returned incomplete data (${cause}).`, severity: 'warning',
    failure: { code: 'incomplete', source: `${source.query.source.pluginId}:${source.query.source.sourceId}`, reason: cause,
      ...(count ? { count } : {}), ...(input ? { input } : {}) } }
}

const digest = (value: unknown): string => createHash('sha256').update(canonicalDataEncoding(parseDataValue(value))).digest('hex')

async function resolvePlanContexts(env: Env, plan: PanelPlan, sources: PlanSource[], evaluationTime: number,
  zone: string, invocation: DataSourceInvocation): Promise<PanelPlan> {
  const usesViewerBinding = (predicate: DataPredicate): boolean => predicate.kind === 'comparison'
    ? predicate.right?.address.from === 'context' && predicate.right.address.name === 'viewer'
    : predicate.predicates.some(usesViewerBinding)
  const usesViewer = plan.stages.some(stage => stage.op === 'filter' && usesViewerBinding(stage.where))
  if (usesViewer && sources.length !== 1) throw new Error('You in a panel filter requires one account source')
  const viewer = usesViewer ? await invokeDataSource(env, { operation: 'identity', source: sources[0]!.query.source,
    scope: sources[0]!.query.scope }, invocation) : undefined
  const context = { evaluationTime, timePolicy: { zone, weekStart: plan.time.weekStart }, viewer }
  const resolve = (predicate: DataPredicate): DataPredicate => {
    if (predicate.kind !== 'comparison') return { ...predicate, predicates: predicate.predicates.map(resolve) }
    if (predicate.right?.address.from !== 'context') return predicate
    let value = resolveDataBinding(predicate.right, context)
    const left = predicate.left.address
    const column = left.from === 'item' ? plan.columns.find(item => `/${item.id}` === left.pointer) : undefined
    if (column?.precision === 'day' && typeof value === 'number') {
      value = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value)
    }
    return { ...predicate, right: { address: { from: 'literal', value } } }
  }
  return { ...plan, stages: plan.stages.map(stage => stage.op === 'filter' ? { ...stage, where: resolve(stage.where) } : stage) }
}

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
  let uncoveredWindow = false
  const started = Date.now()
  for (const entry of plan.sources) {
    try {
      const resolved = await resolveQuery(env, args.scope, entry.reference, { evaluationTime,
        timePolicy: { zone: plan.time.mode === 'viewer' && args.viewerZone ? args.viewerZone : plan.time.zone, weekStart: plan.time.weekStart } }, runInvocation)
      const description = await invokeDataSource(env, { operation: 'describe', source: resolved.query.source, scope: resolved.query.scope }, runInvocation)
      const account = resolved.query.scope.connectionId ? await getConnection(getDb(env), invocation.principal.userId, resolved.query.scope.connectionId) : null
      sources.push({ instanceId: entry.id, label: entry.label, query: resolved.query, description,
        ...(account ? { accountLabel: account.name ?? account.label } : {}) })
      sourceDiagnostics.push({ id: entry.id, label: entry.label, revision: description.revision,
        queryDigest: resolved.published?.digest ?? digest(entry.reference.kind === 'inline' ? entry.reference.content : null),
        parameters: resolved.parameters, account: resolved.query.scope.connectionId ?? null, coverageWindows: description.coverageWindows,
        writable: description.writable })
    } catch (error) {
      problems.push(sourceProblem(plan, plan.sources.indexOf(entry), entry.label, error, runInvocation.signal.reason?.name === 'TimeoutError',
        entry.reference.kind === 'inline' ? entry.reference.content.query.source : undefined))
      sourceDiagnostics.push({ id: entry.id, label: entry.label })
    }
  }
  plan = resolvePlanColumns(plan, sources)
  const describedPlan = plan
  try { plan = await resolvePlanContexts(env, plan, sources, evaluationTime,
    plan.time.mode === 'viewer' && args.viewerZone ? args.viewerZone : plan.time.zone, runInvocation) }
  catch (error) { problems.push({ path: '/stages', message: describeError(error).message, severity: 'error' }) }
  const validation = validatePanelPlan(plan, sources)
  const unavailableColumns = new Set<number>()
  for (const problem of validation) {
    const binding = /^\/columns\/(\d+)\/bind\//.exec(problem.path)
    if (binding && /no longer describes|now describes/.test(problem.message)) {
      unavailableColumns.add(Number(binding[1]))
      problems.push({ ...problem, severity: 'warning' })
    } else problems.push(problem)
  }
  const datasetSources = sources.filter(source => source.query.source.pluginId === 'core' && source.query.source.sourceId.startsWith('dataset:'))
  if (datasetSources.length && plan.stages.some(stage => stage.op === 'summarize')) {
    if (sources.length !== 1 || datasetSources.length !== 1) {
      problems.push({ path: '/sources', message: 'A dataset summary needs one dataset source and a summarize stage.', severity: 'error' })
    }
    let rows: DashboardRun['rows'] = []
    let counts: DashboardRun['diagnostics']['stages'] = []
    if (!problems.some(problem => problem.severity === 'error')) try {
      const source = datasetSources[0]!
      const [{ datasetIdFromSource, predicateTimeWindow }, { getDataset, datasetCoveragePartial }] = await Promise.all([
        import('../datasets/source'), import('../datasets/store'),
      ])
      const id = datasetIdFromSource(source.query.source.sourceId)!
      const dataset = getDataset(getDb(env), id)
      const timeField = dataset.eventTimeField ?? '/_observationTime'
      const sourceWindow = predicateTimeWindow(source.query.predicate, new Set([timeField]))
      const mapped = new Set(plan.columns.filter(column => {
        const binding = column.bind[source.instanceId]
        return binding && 'field' in binding && binding.field === timeField
      })
        .map(column => `/${column.id}`))
      const stageWindows = plan.stages.slice(0, plan.stages.findIndex(stage => stage.op === 'summarize'))
        .filter(stage => stage.op === 'filter').map(stage => predicateTimeWindow(stage.where, mapped))
      const window = stageWindows.reduce<{ from: number; to: number }>((current, part) => ({ from: Math.max(current.from, part.from ?? -Infinity),
        to: Math.min(current.to, part.to ?? Infinity) }),
      { from: sourceWindow.from ?? -Infinity, to: sourceWindow.to ?? Infinity })
      const gaps = datasetCoveragePartial(getDb(env), dataset, window)
      const { summarizeDataset } = await import('../datasets/summarySql')
      const summary = summarizeDataset(getDb(env), dataset, plan, source.query, source.description, gaps)
      const staged = runPlanStages({ ...plan, stages: plan.stages.slice(summary.stageIndex + 1) }, summary.rows, evaluationTime, gaps)
      rows = sortPlanRows(plan, staged.rows).slice(0, plan.limit ?? 5000)
      counts = [{ path: `/stages/${summary.stageIndex}`, input: summary.inputCount, output: summary.rows.length,
        meaning: 'one row per summary group' }, ...staged.counts]
      problems.push(...staged.problems)
      sourceDiagnostics[0]!.completeness = gaps ? { kind: 'incomplete', cause: 'coverage-gap' } : { kind: 'complete' }
      sourceDiagnostics[0]!.readTime = evaluationTime
    } catch (error) {
      problems.push({ path: '/stages', message: error instanceof Error ? error.message : 'Database summary failed.', severity: 'error' })
    }
    const effectivePlan = plan.time.mode === 'viewer' && args.viewerZone ? { ...plan, time: { ...plan.time, zone: args.viewerZone } } : plan
    return { plan, rows: problems.some(problem => problem.severity === 'error') ? [] : rows,
      groups: problems.some(problem => problem.severity === 'error') ? [] : groupPlanRows(effectivePlan, rows, evaluationTime),
      description: describePanelPlan(plan, sources), diagnostics: { problems, sources: sourceDiagnostics, stages: counts,
        evaluationTime, plugins: ['core'], accounts: [], complete: !problems.length && sourceDiagnostics[0]?.completeness?.kind === 'complete' } }
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
        diagnostic.coveredRange = source.result.coveredRange
        diagnostic.observedAt = source.result.observedAt
        if (source.result.inputs) diagnostic.inputs = source.result.inputs
        const index = plan.sources.findIndex(entry => entry.id === source.instanceId)
        const coverageProblem = sourceCoverageProblem(plan, source, evaluationTime)
        if (coverageProblem) {
          uncoveredWindow = true
          problems.push({ path: `/sources/${index}`, message: coverageProblem, severity: 'warning' })
        }
        const incomplete = incompleteProblem(plan, index, source, source.result)
        if (incomplete) problems.push(incomplete)
        if (sources.reduce((sum, entry) => sum + (entry.result?.records.length ?? 0), 0) > MAX_TOTAL_RECORDS) { problems.push({ path: '/sources', message: 'Total record budget exceeded.', severity: 'error' }); break }
      } catch (error) {
        problems.push(sourceProblem(plan, plan.sources.findIndex(entry => entry.id === source.instanceId), source.label, error,
          runInvocation.signal.reason?.name === 'TimeoutError', source.query.source))
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
  const related = relatePanelRows(plan, sources, initial)
  problems.push(...related.problems)
  const staged = runPlanStages(plan, related.rows, evaluationTime, uncoveredWindow || sourceDiagnostics.some(source => source.completeness?.kind === 'incomplete'))
  problems.push(...staged.problems)
  if (staged.counts.some(count => count.input > MAX_STAGE_ROWS || count.output > MAX_STAGE_ROWS)) problems.push({ path: '/stages', message: 'Intermediate row budget exceeded.', severity: 'error' })
  const rows = sortPlanRows(plan, staged.rows).slice(0, plan.limit ?? 5000)
  if (new TextEncoder().encode(JSON.stringify(rows)).byteLength > MAX_OUTPUT_BYTES) problems.push({ path: '/rows', message: 'Output byte budget exceeded.', severity: 'error' })
  const effectivePlan = plan.time.mode === 'viewer' && args.viewerZone ? { ...plan, time: { ...plan.time, zone: args.viewerZone } } : plan
  return {
    plan: describedPlan, rows: problems.some(problem => problem.severity === 'error') ? [] : rows,
    groups: problems.some(problem => problem.severity === 'error') ? [] : groupPlanRows(effectivePlan, rows, evaluationTime),
    description: describePanelPlan(describedPlan, sources),
    diagnostics: {
      problems, sources: sourceDiagnostics, stages: staged.counts, evaluationTime,
      asOf: sourceDiagnostics.reduce<number | undefined>((oldest, source) => source.observedAt !== undefined && source.readTime !== undefined && source.observedAt < source.readTime
        ? Math.min(oldest ?? source.observedAt, source.observedAt) : oldest, undefined),
      plugins: [...new Set(sources.map(source => source.query.source.pluginId))],
      accounts: [...new Set(sources.flatMap(source => source.query.scope.connectionId ? [source.query.scope.connectionId] : []))],
      complete: !uncoveredWindow && !problems.some(problem => problem.severity === 'error') && !related.problems.length
        && !rows.some(row => row.partial && Object.keys(row.partial).length)
        && sources.every(source => source.result?.completeness.kind === 'complete' || source.result?.completeness.kind === 'bounded'),
    },
  }
}
