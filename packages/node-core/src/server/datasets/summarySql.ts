import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataSourceQuery, DataSourceDescription } from '@acorn/protocol/dataSources.ts'
import type { DataValue } from '@acorn/protocol/dataValues.ts'
import { bucketValue } from '@acorn/dashboards-core/planBuckets.ts'
import { finishSummaryRows } from '@acorn/dashboards-core/analysis.ts'
import type { PlanRow } from '@acorn/dashboards-core/plan.ts'
import type { AppDatabase } from '../db'
import { DatasetError, type DatasetDefinition } from './store'
import { datasetPredicateSql, jsonPath } from './source'

type Summary = Extract<PanelPlan['stages'][number], { op: 'summarize' }>
type Measure = Summary['measures'][number]
const registered = new WeakSet<AppDatabase>()
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`
const field = (id: string) => {
  const pointer = `/${id.replaceAll('~', '~0').replaceAll('/', '~1')}`
  return `json_extract(data_json, ${literal(jsonPath(pointer))})`
}
const names = (count: number) => Array.from({ length: count }, (_, i) => `g${i}`)
const key = (values: readonly DataValue[]) => JSON.stringify(values)

function ensureBucketFunction(db: AppDatabase) {
  if (registered.has(db)) return
  db.$client.function('acorn_bucket', { deterministic: true }, (value, kind, zone, weekStart) =>
    bucketValue(value as string | number | null, kind as 'day' | 'week' | 'month', String(zone), String(weekStart) as PanelPlan['time']['weekStart']) as string | number | null)
  registered.add(db)
}

function mappedColumn(plan: PanelPlan, sourceId: string, description: DataSourceDescription, id: string) {
  const column = plan.columns.find(item => item.id === id)
  if (!column) throw new DatasetError('invalid', `Column ${id} is missing.`)
  const binding = column.bind[sourceId]
  if (!binding) return { text: 'NULL', params: [] as unknown[] }
  if ('value' in binding) return { text: 'json_extract(?, \'$\')', params: [JSON.stringify(binding.value)] }
  const path = jsonPath(binding.field)
  let expression = `json_extract(data_json, ${literal(path)})`
  const params: unknown[] = []
  if (binding.values) {
    const cases = Object.entries(binding.values).flatMap(([mapped, raws]) => raws.map(raw => {
      params.push(raw, mapped)
      return `WHEN ${expression} = ? THEN ?`
    }))
    expression = `CASE ${cases.join(' ')} ELSE ${column.unmatched === 'hidden' ? 'NULL' : expression} END`
  }
  if (column.unit === 'ms' && description.fields.find(item => item.pointer === binding.field)?.display?.unit === 's') {
    expression = `(${expression}) * 1000`
  }
  return { text: expression, params }
}

export function baseSql(dataset: DatasetDefinition, plan: PanelPlan, sourceId: string, query: DataSourceQuery, description: DataSourceDescription, stage: Summary) {
  const sourceFields = new Set(description.fields.map(item => item.pointer))
  const sourceWhere = datasetPredicateSql(query.predicate, sourceFields)
  const columns = plan.columns.map(column => mappedColumn(plan, sourceId, description, column.id))
  const stageFilters = plan.stages.slice(0, plan.stages.indexOf(stage))
  if (stageFilters.some(item => item.op !== 'filter') || query.take || plan.sources.length !== 1 || plan.relations?.length) {
    throw new DatasetError('invalid', 'Database summary supports one dataset and filters before the summary.')
  }
  const mappedFields = new Set(plan.columns.map(column => `/${column.id}`))
  const filter = stageFilters.map(item => datasetPredicateSql((item as Extract<typeof item, { op: 'filter' }>).where, mappedFields))
  const groupNames = names(stage.by.length)
  const groupExpressions = stage.by.map(item => {
    const value = field(item.column)
    return item.bucket && item.bucket !== 'value'
      ? `acorn_bucket(${value}, ${literal(item.bucket)}, ${literal(plan.time.zone)}, ${literal(plan.time.weekStart)})`
      : value
  })
  const metadata = dataset.mode === 'snapshot-history' ? '_observationTime' : '_arrivedAt'
  const data = `json_set(CASE WHEN c.value_json IS NULL THEN r.data_json ELSE json_set(r.data_json, '$.correction', json(c.value_json)) END,
    '$.${metadata}', r.${dataset.mode === 'snapshot-history' ? 'observation_time' : 'arrived_at'})`
  const pairs = columns.map((column, index) => `${literal(plan.columns[index]!.id)}, ${column.text.replaceAll('json_extract(data_json,', `json_extract(${data},`)}`).join(', ')
  const sql = `WITH mapped AS (SELECT r.id, r.identity, json_object(${pairs}) AS data_json FROM dataset_rows r
    LEFT JOIN dataset_corrections c ON c.dataset_id = r.dataset_id AND c.identity = r.identity
    WHERE r.dataset_id = ? AND r.removed_at IS NULL AND ${sourceWhere.text.replaceAll('json_extract(data_json,', `json_extract(${data},`)}),
    filtered AS (SELECT * FROM mapped WHERE ${filter.map(part => part.text).join(' AND ') || '1'}),
    grouped AS (SELECT *, ${groupExpressions.length ? groupExpressions.map((expression, index) => `${expression} AS g${index}`).join(', ') : '1 AS grouping_key'} FROM filtered)`
  return { sql, params: [...columns.flatMap(column => column.params), dataset.id, ...sourceWhere.params, ...filter.flatMap(part => part.params)], groupNames }
}

function measureSql(measure: Measure, groupNames: string[]) {
  const value = measure.column ? field(measure.column) : 'NULL'
  const numeric = `CASE WHEN typeof(${value}) IN ('integer','real') THEN ${value} END`
  const aggregate = {
    count: 'COUNT(*)', 'count-where': 'COUNT(*)', sum: `COALESCE(SUM(${numeric}), 0)`,
    average: `AVG(${numeric})`, minimum: `MIN(${numeric})`, maximum: `MAX(${numeric})`,
    'distinct-count': `COUNT(DISTINCT CASE WHEN ${value} IS NOT NULL THEN json_quote(${value}) END)`,
    'distinct-list': `json_group_array(DISTINCT CASE WHEN ${value} IS NOT NULL THEN json_quote(${value}) END)`,
    earliest: `MIN(${value})`, latest: `MAX(${value})`, median: 'NULL', percentile: 'NULL',
  }[measure.kind]
  return { value, numeric, aggregate, grouping: groupNames.length ? ` GROUP BY ${groupNames.join(', ')}` : '' }
}

function readGroups(db: AppDatabase, base: ReturnType<typeof baseSql>, stage: Summary) {
  const group = base.groupNames.join(', ')
  const rows = db.$client.prepare(`${base.sql} SELECT ${group ? `${group}, ` : ''}COUNT(*) AS size FROM grouped${group ? ` GROUP BY ${group}` : ''} LIMIT 5001`)
    .all(...base.params) as Record<string, DataValue | number>[]
  if (rows.length > 5000) throw new DatasetError('capacity', 'Summary has more than 5,000 groups.')
  const result = new Map<string, PlanRow>()
  for (const record of rows) {
    const values = Object.fromEntries(stage.by.map((by, index) => [by.column, record[`g${index}`] ?? null])) as Record<string, DataValue>
    const id = key(stage.by.map(by => values[by.column] ?? null))
    const groupValues = Object.fromEntries(stage.by.map(by => [by.column, values[by.column] ?? null]))
    result.set(id, { id: `summary:${id}`, values, records: [], summaryStage: -1, partial: {},
      datasetGroups: Object.fromEntries(stage.measures.map(measure => [measure.id, { groupValues, measureId: measure.id }])) })
  }
  return result
}

function percentileRows(db: AppDatabase, base: ReturnType<typeof baseSql>, measure: Measure, where: string, params: unknown[]) {
  const group = base.groupNames.join(', '), value = field(measure.column!)
  const partition = group ? `PARTITION BY ${group} ` : ''
  const rank = measure.kind === 'median' ? 0.5 : (measure.percentile ?? 50) / 100
  const sql = `${base.sql}, selected AS (SELECT ${group ? `${group}, ` : ''}${value} AS v FROM grouped WHERE ${where} AND typeof(${value}) IN ('integer','real')),
    ranked AS (SELECT ${group ? `${group}, ` : ''}v, ROW_NUMBER() OVER (${partition}ORDER BY v) AS rn,
      COUNT(*) OVER (${partition.trimEnd()}) AS n FROM selected)
    SELECT ${group ? `${group}, ` : ''}
      MAX(CASE WHEN rn = CAST((n - 1) * ? AS INTEGER) + 1 THEN v END) AS low,
      MAX(CASE WHEN rn = MIN(CAST((n - 1) * ? AS INTEGER) + 2, n) THEN v END) AS high,
      MAX((n - 1) * ? - CAST((n - 1) * ? AS INTEGER)) AS fraction
    FROM ranked${group ? ` GROUP BY ${group}` : ''}`
  return db.$client.prepare(sql).all(...base.params, ...params, rank, rank, rank, rank) as Record<string, number | null>[]
}

/** SQL performs filtering, grouping and all row-wide reductions; JS sees summary rows only. */
export function summarizeDataset(db: AppDatabase, dataset: DatasetDefinition, plan: PanelPlan, query: DataSourceQuery,
  description: DataSourceDescription, incomplete: boolean): { rows: PlanRow[]; inputCount: number; stageIndex: number } {
  const stageIndex = plan.stages.findIndex(stage => stage.op === 'summarize')
  if (stageIndex < 0) throw new DatasetError('invalid')
  const stage = plan.stages[stageIndex] as Summary
  ensureBucketFunction(db)
  const base = baseSql(dataset, plan, plan.sources[0]!.id, query, description, stage)
  const inputCount = (db.$client.prepare(`${base.sql} SELECT COUNT(*) AS count FROM filtered`).get(...base.params) as { count: number }).count
  const groups = readGroups(db, base, stage)
  const group = base.groupNames.join(', ')
  for (const measure of stage.measures) {
    const filter = datasetPredicateSql(measure.where, new Set(plan.columns.map(column => `/${column.id}`)))
    const { value, aggregate, grouping } = measureSql(measure, base.groupNames)
    const unknown = measure.column ? `SUM(CASE WHEN ${value} IS NULL THEN 1 ELSE 0 END)` : '0'
    const wrongType = measure.column ? `SUM(CASE WHEN ${value} IS NOT NULL AND typeof(${value}) NOT IN ('integer','real') THEN 1 ELSE 0 END)` : '0'
    const unit = measure.column ? plan.columns.find(column => column.id === measure.column)?.unit : undefined
    const unitExpr = typeof unit === 'object' ? field(unit.column) : null
    const units = unitExpr ? `COUNT(DISTINCT ${unitExpr}) AS units, SUM(${unitExpr} IS NULL) AS unknownUnit` : '0 AS units, 0 AS unknownUnit'
    const results = measure.kind === 'median' || measure.kind === 'percentile'
      ? percentileRows(db, base, measure, filter.text, filter.params)
      : db.$client.prepare(`${base.sql} SELECT ${group ? `${group}, ` : ''}${aggregate} AS value,
          ${unknown} AS unknown, ${wrongType} AS wrongType, ${units} FROM grouped WHERE ${filter.text}${grouping}`)
        .all(...base.params, ...filter.params) as Record<string, unknown>[]
    const byKey = new Map(results.map(row => [key(base.groupNames.map(name => row[name] as DataValue ?? null)), row]))
    const percentileStats = measure.kind === 'median' || measure.kind === 'percentile'
      ? new Map((db.$client.prepare(`${base.sql} SELECT ${group ? `${group}, ` : ''}${unknown} AS unknown, ${units}
          FROM grouped WHERE ${filter.text}${grouping}`).all(...base.params, ...filter.params) as Record<string, unknown>[])
        .map(row => [key(base.groupNames.map(name => row[name] as DataValue ?? null)), row])) : null
    for (const [id, row] of groups) {
      const item = byKey.get(id)
      const stats = percentileStats?.get(id) ?? item
      const raw = measure.kind === 'median' || measure.kind === 'percentile'
        ? item && item.low !== null && item.low !== undefined && item.high !== null && item.high !== undefined
          ? Number(item.low) + (Number(item.high) - Number(item.low)) * Number(item.fraction) : null
        : item?.value ?? (measure.kind === 'count' || measure.kind === 'count-where' || measure.kind === 'sum' || measure.kind === 'distinct-count' ? 0 : null)
      if (measure.kind === 'distinct-list') {
        const serialized = String(raw ?? '[]')
        if (serialized.length > 1_000_000) throw new DatasetError('capacity', 'Distinct list is too large.')
        const values = (JSON.parse(serialized) as (string | null)[]).filter((part): part is string => part !== null)
        if (values.length > 1000) throw new DatasetError('capacity', 'Distinct list has more than 1,000 values.')
        row.values[measure.id] = values.map(part => JSON.parse(part) as DataValue)
      } else row.values[measure.id] = raw as DataValue
      if (incomplete || !['count', 'count-where'].includes(measure.kind) && Number(stats?.unknown ?? 0) > 0 || ['sum', 'average'].includes(measure.kind) && Number(item?.wrongType ?? 0) > 0
        || Number(stats?.unknownUnit ?? 0) > 0 || Number(stats?.units ?? 0) > 1) {
        row.partial![measure.id] = incomplete ? 'source incomplete or window uncovered'
          : Number(stats?.unknownUnit ?? 0) > 0 ? 'unknown unit' : 'unknown input values'
      }
      if (Number(stats?.units ?? 0) > 1) throw new DatasetError('invalid', `Measure ${measure.label} mixes units.`)
    }
  }
  const rows = finishSummaryRows(plan, stage, [...groups.values()]).map(row => ({ ...row, summaryStage: stageIndex }))
  return { rows, inputCount, stageIndex }
}

/** Bounded on-demand input rows for a displayed summary cell. Never embedded in a summary response. */
export function datasetDrilldown(db: AppDatabase, dataset: DatasetDefinition, plan: PanelPlan, query: DataSourceQuery,
  description: DataSourceDescription, groupValues: Record<string, DataValue>, measureId?: string, limit = 1000) {
  const stageIndex = plan.stages.findIndex(stage => stage.op === 'summarize')
  const stage = plan.stages[stageIndex]
  if (stage?.op !== 'summarize') throw new DatasetError('invalid', 'No summary to drill into.')
  const measure = measureId ? stage.measures.find(item => item.id === measureId) : undefined
  if (measureId && !measure) throw new DatasetError('invalid', 'Unknown measure.')
  ensureBucketFunction(db)
  const base = baseSql(dataset, plan, plan.sources[0]!.id, query, description, stage)
  const measureFilter = datasetPredicateSql(measure?.where, new Set(plan.columns.map(column => `/${column.id}`)))
  const groupFilter = stage.by.map((by, index) => {
    if (!Object.hasOwn(groupValues, by.column)) throw new DatasetError('invalid', 'Missing summary key.')
    return `g${index} IS ?`
  }).join(' AND ') || '1'
  const params = [...base.params, ...measureFilter.params, ...stage.by.map(by => groupValues[by.column] ?? null)]
  const where = `${measureFilter.text} AND ${groupFilter}`
  const total = (db.$client.prepare(`${base.sql} SELECT COUNT(*) AS total FROM grouped WHERE ${where}`).get(...params) as { total: number }).total
  const items = db.$client.prepare(`${base.sql} SELECT identity, data_json AS dataJson FROM grouped WHERE ${where} ORDER BY id LIMIT ?`)
    .all(...params, Math.min(limit, 1000)) as { identity: string; dataJson: string }[]
  const rows: PlanRow[] = items.map(item => {
    const ref = { pluginId: 'core', sourceId: `dataset:${dataset.id}`, recordId: item.identity, scope: query.scope }
    return { id: `${plan.sources[0]!.id}:${item.identity}`, values: JSON.parse(item.dataJson) as Record<string, DataValue>, records: [ref], recordItems: [{ ref }] }
  })
  return { total, rows, truncated: total > rows.length }
}
