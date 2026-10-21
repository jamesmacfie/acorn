import type { DataPredicate } from '@acorn/protocol/dataBindings.ts'
import type {
  DataSourceDescription,
  DataSourcePage,
  DataSourceQuery,
  DataSourceRequest,
  DataSourceScope,
} from '@acorn/protocol/dataSources.ts'
import { DATA_LIMITS, parseDataPointer } from '@acorn/protocol/dataValues.ts'
import type { Env } from '../bindings'
import type { AppDatabase } from '../db'
import { registerCoreDataSource, registeredDataSource } from '../dataSources/registry'
import { createDataSelectionPager } from '../dataSources/selection'
import { sourceFieldSchema } from '@acorn/protocol/dataSchemas.ts'
import {
  DatasetError,
  assertDatasetScope,
  coverageForDataset,
  datasetCoveragePartial,
  currentVersion,
  datasetRefresh,
  getDataset,
  listDatasets,
  type DatasetDefinition,
} from './store'

const datasetSourceId = (id: string) => `dataset:${id}`
export const datasetIdFromSource = (sourceId: string): string | null =>
  sourceId.startsWith('dataset:') ? sourceId.slice(8) : null

/** JSON paths are built only from parsed field pointers; all values stay bound parameters. */
export function jsonPath(pointer: string): string {
  const parts = parseDataPointer(pointer)
  if (!parts || !parts.length) throw new DatasetError('invalid', 'Invalid field pointer.')
  return `$${parts.map((part) => `.${JSON.stringify(part)}`).join('')}`
}

export type SqlClause = { text: string; params: unknown[] }
/** A conservative interval for all-of time filters. Any-of and unknown values leave coverage broad. */
export function predicateTimeWindow(
  predicate: DataPredicate | undefined,
  pointers: ReadonlySet<string>,
): { from?: number; to?: number } {
  if (!predicate || predicate.kind === 'any') return {}
  if (predicate.kind === 'all') {
    return predicate.predicates.reduce<{ from?: number; to?: number }>((window, child) => {
      const part = predicateTimeWindow(child, pointers)
      return {
        from: Math.max(window.from ?? -Infinity, part.from ?? -Infinity),
        to: Math.min(window.to ?? Infinity, part.to ?? Infinity),
      }
    }, {})
  }
  if (predicate.kind !== 'comparison') return {}
  if (
    predicate.left.address.from !== 'item' ||
    !pointers.has(predicate.left.address.pointer) ||
    predicate.right?.address.from !== 'literal'
  )
    return {}
  const raw = predicate.right.address.value
  const time = typeof raw === 'number' ? raw : typeof raw === 'string' ? Date.parse(raw) : NaN
  if (!Number.isFinite(time)) return {}
  if (predicate.operator === 'eq') return { from: time, to: time + 1 }
  if (predicate.operator === 'gt') return { from: time + 1 }
  if (predicate.operator === 'gte') return { from: time }
  if (predicate.operator === 'lt') return { to: time }
  if (predicate.operator === 'lte') return { to: time + 1 }
  return {}
}
export function datasetPredicateSql(predicate: DataPredicate | undefined, fields: ReadonlySet<string>): SqlClause {
  if (!predicate) return { text: '1', params: [] }
  if (predicate.kind !== 'comparison') {
    const nested = predicate.predicates.map((part) => datasetPredicateSql(part, fields))
    return {
      text: `(${nested.map((part) => part.text).join(predicate.kind === 'all' ? ' AND ' : ' OR ')})`,
      params: nested.flatMap((part) => part.params),
    }
  }
  const left = predicate.left.address
  const right = predicate.right?.address
  if (left.from !== 'item' || (right && right.from !== 'literal') || !fields.has(left.pointer))
    throw new DatasetError('invalid', 'Unsupported dataset filter.')
  const path = jsonPath(left.pointer),
    value = `json_extract(data_json, ?)`
  if (predicate.operator === 'missing') return { text: 'json_type(data_json, ?) IS NULL', params: [path] }
  if (predicate.operator === 'present') return { text: 'json_type(data_json, ?) IS NOT NULL', params: [path] }
  if (!right) throw new DatasetError('invalid')
  const operand = right.value
  if (predicate.operator === 'in') {
    if (!Array.isArray(operand) || operand.length > 100) throw new DatasetError('invalid')
    return {
      text: `(${operand.map(() => `${value} IS ?`).join(' OR ') || '0'})`,
      params: operand.flatMap((item) => [path, item]),
    }
  }
  if (predicate.operator === 'contains') {
    if (typeof operand !== 'string') throw new DatasetError('invalid')
    return {
      text: `(CASE WHEN json_type(data_json, ?) = 'array'
      THEN EXISTS (SELECT 1 FROM json_each(data_json, ?) WHERE json_each.value IS ?)
      ELSE instr(${value}, ?) > 0 END)`,
      params: [path, path, operand, path, operand],
    }
  }
  const operator = { eq: 'IS', ne: 'IS NOT', lt: '<', lte: '<=', gt: '>', gte: '>=' }[predicate.operator]
  if (!operator || (typeof operand === 'object' && operand !== null)) throw new DatasetError('invalid')
  return { text: `${value} ${operator} ?`, params: [path, operand] }
}

type CoverageWindow = NonNullable<DataSourceDescription['coverageWindows']>[number]

/** A scheduled agent refresh that hasn't written for its cadence and a grace of a quarter of it, at
 *  most an hour, is a gap from when it was due, as a failed capture is. */
export function overdueRefresh(
  dataset: DatasetDefinition,
  refreshedAt: number | undefined,
  now: number,
): CoverageWindow | undefined {
  // shortcut: `every` is the cadence chosen when the dataset was made, so a schedule edited later in
  // Workflows doesn't move it. Read the schedule itself if that drift starts to mislead.
  const every = datasetRefresh(dataset)?.every
  if (!every || refreshedAt === undefined) return undefined
  const due = refreshedAt + every * 1000
  if (now < due + Math.min(every * 250, 3_600_000)) return undefined
  return { fromTime: due, toTime: now, kind: 'gap', reason: 'The scheduled agent refresh is overdue.' }
}

export function datasetSourceDescription(db: AppDatabase, dataset: DatasetDefinition): DataSourceDescription {
  const version = currentVersion(db, dataset)
  const refreshedAt =
    dataset.feeder === 'agent'
      ? ((
          db.$client
            .prepare('SELECT MAX(finished_at) AS at FROM dataset_captures WHERE dataset_id = ?')
            .get(dataset.id) as { at: number | null }
        ).at ?? undefined)
      : undefined
  const overdue = overdueRefresh(dataset, refreshedAt, Date.now())
  const metadata = dataset.mode === 'snapshot-history' ? '_observationTime' : '_arrivedAt'
  return {
    revision: String(version.version),
    schema: {
      ...version.schema,
      required: [],
      additionalProperties: true,
      properties: { ...version.schema.properties, [metadata]: { type: 'number' } },
    },
    fields: [
      ...version.fields.map((field) => {
        const shape = sourceFieldSchema(version.schema, field.pointer)
        const types = shape ? (Array.isArray(shape.type) ? shape.type : [shape.type]) : []
        const ordered = types.some((type) => type === 'string' || type === 'number')
        const scalar = types.some((type) => ['string', 'number', 'boolean', 'null'].includes(type))
        const operators = [
          'missing',
          'present',
          ...(scalar ? ['eq', 'ne', 'in'] : []),
          ...(ordered ? ['lt', 'lte', 'gt', 'gte'] : []),
          ...(types.some((type) => type === 'string' || type === 'array') ? ['contains'] : []),
        ] as NonNullable<typeof field.query>['operators']
        return { ...field, origin: 'declared' as const, query: { operators, sortable: ordered } }
      }),
      {
        pointer: `/${metadata}`,
        label: metadata === '_observationTime' ? 'Observed' : 'Arrived',
        origin: 'declared',
        display: { kind: 'datetime' },
        query: { operators: ['eq', 'ne', 'lt', 'lte', 'gt', 'gte'], sortable: true },
      },
    ],
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    parameterFields: [],
    operations: { query: true, options: false, details: false, incremental: false, groups: ['all', 'any'] },
    consistency: `${dataset.mode}; ${dataset.feeder} feeder; ${dataset.retentionDays} day retention. Coverage is tracked separately from captures.`,
    dataset: { mode: dataset.mode, feeder: dataset.feeder, ...(refreshedAt !== undefined ? { refreshedAt } : {}) },
    coverageWindows: [
      ...(overdue ? [overdue] : []),
      ...coverageForDataset(db, dataset.id).map((item) => ({
        ...item,
        kind: item.kind === 'complete' ? ('complete' as const) : ('gap' as const),
      })),
    ].slice(0, 100),
  }
}

/** Every row the query selects, up to the host's budget. A run's pages are cut from one read through the pager. */
function readDataset(
  db: AppDatabase,
  dataset: DatasetDefinition,
  query: DataSourceQuery,
  readTime: number,
): DataSourcePage {
  const fields = new Set(datasetSourceDescription(db, dataset).fields.map((field) => field.pointer))
  const where = datasetPredicateSql(query.predicate, fields)
  const sort = query.sort
    .map((entry) => {
      if (!fields.has(entry.pointer)) throw new DatasetError('invalid', 'Unknown sort field.')
      return `json_extract(exposed.data_json, '${jsonPath(entry.pointer).replaceAll("'", "''")}') ${entry.direction.toUpperCase()}`
    })
    .join(', ')
  const limit = query.take ?? DATA_LIMITS.selectionRecords
  const metadata = dataset.mode === 'snapshot-history' ? '_observationTime' : '_arrivedAt'
  const rows = db.$client
    .prepare(`WITH exposed AS (
      SELECT r.id, r.dataset_id, r.identity, r.removed_at, r.evidence_json, r.reason, c.value_json,
      json_set(CASE WHEN c.value_json IS NULL THEN r.data_json ELSE json_set(r.data_json, '$.correction', json(c.value_json)) END,
        '$.${metadata}', r.${dataset.mode === 'snapshot-history' ? 'observation_time' : 'arrived_at'}) AS data_json
      FROM dataset_rows r LEFT JOIN dataset_corrections c ON c.dataset_id = r.dataset_id AND c.identity = r.identity)
      SELECT identity, data_json AS dataJson, evidence_json AS evidenceJson, reason, value_json AS correctionJson
      FROM exposed WHERE dataset_id = ? AND removed_at IS NULL AND ${where.text}
      ORDER BY ${sort ? `${sort}, ` : ''}id ASC LIMIT ?`)
    .all(dataset.id, ...where.params, limit + 1) as {
    identity: string
    dataJson: string
    evidenceJson: string | null
    reason: string | null
    correctionJson: string | null
  }[]
  const cut = !query.take && rows.length > limit
  const records = rows.slice(0, limit).map((row) => ({
    recordId: row.identity,
    data: {
      ...(JSON.parse(row.dataJson) as Record<string, unknown>),
      ...(row.correctionJson ? { correction: JSON.parse(row.correctionJson) } : {}),
    },
  }))
  const gaps = datasetCoveragePartial(
    db,
    dataset,
    predicateTimeWindow(query.predicate, new Set([dataset.eventTimeField ?? '/_observationTime'])),
  )
  return {
    records,
    revision: String(dataset.currentVersion),
    readTime,
    completeness:
      query.take && records.length === query.take
        ? { kind: 'bounded' as const }
        : cut
          ? { kind: 'incomplete' as const, cause: 'host-budget' as const }
          : gaps
            ? { kind: 'incomplete' as const, cause: 'coverage-gap' as const }
            : { kind: 'complete' as const },
  }
}

const pageDataset = createDataSelectionPager()

function datasetSourceHandler(id: string) {
  return async (request: DataSourceRequest, env: Env) => {
    const dataset = getDataset(env.DB, id)
    const scope = request.operation === 'query' ? request.query.scope : request.scope
    assertDatasetScope(dataset, scope.workspaceId ?? '', scope.projectId)
    if (request.operation === 'describe') return datasetSourceDescription(env.DB, dataset)
    if (request.operation !== 'query') throw new DatasetError('invalid', 'Unsupported dataset operation.')
    return pageDataset(`dataset:${id}`, request, async () =>
      readDataset(env.DB, dataset, request.query, request.evaluationTime),
    )
  }
}

export function ensureDatasetSource(db: AppDatabase, id: string, scope: DataSourceScope): void {
  const dataset = getDataset(db, id)
  assertDatasetScope(dataset, scope.workspaceId ?? '', scope.projectId)
  if (registeredDataSource({ pluginId: 'core', sourceId: datasetSourceId(id) })) return
  registerCoreDataSource(
    {
      sourceId: datasetSourceId(id),
      name: dataset.name,
      singular: 'Dataset row',
      plural: 'Dataset rows',
      identityScope: `Dataset ${id}`,
    },
    datasetSourceHandler(id),
  )
}

export function datasetSourcesInScope(db: AppDatabase, scope: DataSourceScope): Set<string> {
  if (!scope.workspaceId) return new Set()
  const ids = listDatasets(db, scope.workspaceId, scope.projectId).map((dataset) => dataset.id)
  for (const id of ids) ensureDatasetSource(db, id, scope)
  return new Set(ids.map(datasetSourceId))
}
