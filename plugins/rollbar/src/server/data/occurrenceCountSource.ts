import { createHash } from 'node:crypto'
import { dataComparisons, DATA_LIMITS, selectDataRecords, type PluginFetchHandler } from '@acorn/plugin-api/node'
import { dataSourceRequestSchema, type DataSourceQuery, type DataSourceRequest } from '@acorn/protocol/dataSources.ts'
import { occurrenceCountSourceDescription } from '../../shared/occurrenceCountSource'
import { levelName, occurrenceMetricsPath, rollbarData, rollbarFetch } from '../index'
import { CAPS } from '../normalize'

type QueryInput = Extract<DataSourceRequest, { operation: 'query' }>
type CountRecord = {
  recordId: string
  data: {
    id: string
    counter: string
    title: string
    url: string
    level: string
    environment: string
    day: number
    occurrences: number
  }
  action: { verb: 'openUrl'; url: string }
}
type Read = { records: CountRecord[]; full: boolean }
type MetricsResult = { timepoints?: { timestamp?: unknown; metrics_rows?: unknown }[] }

const DAY_SECONDS = 86_400
const DAY_MS = DAY_SECONDS * 1000
// One past the host's record budget, so a read that fills it shows that older days remain.
const READ_LIMIT = DATA_LIMITS.selectionRecords + 1
const FILTERS: Record<string, string> = {
  '/level': 'item_level',
  '/environment': 'environment',
  '/counter': 'item_counter',
}

/** The Metrics API query for a predicate. Day bounds widen to whole UTC days, so each count Rollbar
 *  returns covers its whole bucket; the predicate itself then applies to each bucket's start. */
function metricsQuery(query: DataSourceQuery) {
  const filters: { field: string; operator: 'eq'; values: (string | number)[] }[] = []
  let start: number | null = null
  let end: number | null = null
  for (const comparison of dataComparisons(query.predicate)) {
    const pointer = comparison.left.address.from === 'item' ? comparison.left.address.pointer : null
    const right = comparison.right?.address
    if (!pointer || right?.from !== 'literal') throw new Error('invalid_operand')
    const field = occurrenceCountSourceDescription.fields.find((candidate) => candidate.pointer === pointer)
    if (!field?.query?.operators.includes(comparison.operator)) throw new Error('unsupported_filter')
    const value = right.value
    if (pointer === '/day') {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('invalid_date')
      if (comparison.operator === 'gt' || comparison.operator === 'gte') start = Math.max(start ?? value, value)
      else end = Math.min(end ?? value, value)
    } else {
      if (typeof value !== 'string' || !value) throw new Error('invalid_filter')
      if (pointer === '/counter' && !/^\d+$/.test(value)) throw new Error('invalid_filter')
      filters.push({
        field: FILTERS[pointer]!,
        operator: 'eq',
        values: [pointer === '/counter' ? Number(value) : value],
      })
    }
  }
  return {
    ...(start === null ? {} : { start_time: Math.floor(start / DAY_MS) * DAY_SECONDS }),
    ...(end === null ? {} : { end_time: Math.floor(end / DAY_MS) * DAY_SECONDS + DAY_SECONDS - 1 }),
    granularity: 'day',
    timezone: 'UTC',
    group_by: ['item_id', 'item_counter', 'item_title', 'item_level', 'environment'],
    filters,
    sort: { field: 'timestamp', order: 'desc' },
    limit: READ_LIMIT,
  }
}

function countRecord(timestamp: unknown, row: unknown): CountRecord {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || !Array.isArray(row))
    throw new Error('invalid_row')
  const cells = Object.fromEntries(
    row.map((cell: { field?: unknown; value?: unknown }) => [String(cell?.field), cell?.value]),
  )
  const id = String(cells.item_id)
  const counter = String(cells.item_counter)
  if (!/^\d+$/.test(id) || !/^\d+$/.test(counter)) throw new Error('invalid_identity')
  const { item_title: title, environment, occurrence_count: occurrences } = cells
  const level =
    typeof cells.item_level === 'number' || typeof cells.item_level === 'string' ? levelName(cells.item_level) : null
  if (typeof title !== 'string' || typeof environment !== 'string' || level === null) throw new Error('invalid_row')
  if (typeof occurrences !== 'number' || !Number.isSafeInteger(occurrences)) throw new Error('invalid_row')
  for (const value of [title, environment, level])
    if (Buffer.byteLength(value) > CAPS.maxStringBytes) throw new Error('source_string_too_large')
  const day = timestamp * 1000
  const url = `https://rollbar.com/item/${id}/`
  return {
    recordId: `${id}:${day}`,
    data: { id, counter, title, url, level, environment, day, occurrences },
    action: { verb: 'openUrl', url },
  }
}

/** The connection's daily counts, newest day first, up to the host's record budget. */
async function readCounts(token: string, query: DataSourceQuery, signal: AbortSignal): Promise<Read> {
  const result = await rollbarData<MetricsResult>(
    await rollbarFetch(token, occurrenceMetricsPath, signal, metricsQuery(query)),
  )
  if (!Array.isArray(result.timepoints)) throw new Error('invalid_page')
  const records: CountRecord[] = []
  const ids = new Set<string>()
  for (const timepoint of result.timepoints) {
    if (!Array.isArray(timepoint.metrics_rows)) throw new Error('invalid_page')
    for (const row of timepoint.metrics_rows) {
      const record = countRecord(timepoint.timestamp, row)
      if (ids.has(record.recordId)) throw new Error('duplicate_identity')
      ids.add(record.recordId)
      records.push(record)
    }
  }
  records.sort((left, right) => right.data.day - left.data.day)
  return {
    records: records.slice(0, DATA_LIMITS.selectionRecords),
    full: records.length > DATA_LIMITS.selectionRecords,
  }
}

// A run reads every page within one evaluation time, so its pages share one Rollbar query instead of
// asking again for each 100 records.
const reads = new Map<string, { expires: number; read: Promise<Read> }>()
function retainedRead(owner: string, input: QueryInput, read: () => Promise<Read>): Promise<Read> {
  const now = Date.now()
  for (const [key, entry] of reads) if (entry.expires <= now) reads.delete(key)
  const key = createHash('sha256')
    .update(JSON.stringify([owner, input.query.scope, input.query.predicate ?? null, input.evaluationTime]))
    .digest('hex')
  const retained = reads.get(key)
  if (retained) return retained.read
  if (reads.size >= 16) reads.delete(reads.keys().next().value!)
  const entry = { expires: now + DATA_LIMITS.queryMs, read: read() }
  entry.read.catch(() => reads.delete(key))
  reads.set(key, entry)
  return entry.read
}

function countPage(read: Read, input: QueryInput) {
  const selected = selectDataRecords(read.records, input.query)
  const offset = input.cursor ? Number(input.cursor) : 0
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= Math.max(selected.records.length, 1))
    throw new Error('invalid_cursor')
  const records = selected.records.slice(offset, offset + input.pageSize)
  const next = offset + records.length
  // The oldest kept day may have lost some groups to the budget, so full coverage starts the day after.
  const oldest = read.records.at(-1)?.data.day
  return {
    records,
    // Answer `more` until the last page: the host stops at the first page that is anything else.
    completeness:
      next < selected.records.length
        ? { kind: 'more' as const, cursor: String(next) }
        : read.full
          ? { kind: 'incomplete' as const, cause: 'host-budget' as const }
          : selected.completeness,
    ...(read.full && oldest !== undefined
      ? { coveredRange: { start: oldest + DAY_MS, end: input.evaluationTime } }
      : {}),
    revision: occurrenceCountSourceDescription.revision,
    readTime: Date.now(),
  }
}

/** A refusal Rollbar explains, as the one-sentence reason the host shows. */
function failure(error: unknown): Response {
  const status = error instanceof Error ? /^rollbar (\d+)$/.exec(error.message)?.[1] : undefined
  if (status === '429')
    return Response.json(
      { error: 'rate_limited', reason: 'Rollbar is rate limiting this token. Try again in a minute.' },
      { status: 429 },
    )
  if (status === '403')
    return Response.json(
      {
        error: 'rollbar_source_failed',
        reason: "Rollbar refused the read. It needs a token with read scope and the Metrics API on the account's plan.",
      },
      { status: 502 },
    )
  return Response.json({ error: 'rollbar_source_failed' }, { status: 502 })
}

export function createOccurrenceCountSourceHandler(): PluginFetchHandler {
  return async (request, context) => {
    if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 })
    if (
      context.principal.kind !== 'device' &&
      !(context.principal.kind === 'internal' && context.principal.scope === 'service')
    )
      return Response.json({ error: 'forbidden' }, { status: 403 })
    try {
      const input = dataSourceRequestSchema.parse(await request.json())
      if (input.operation === 'describe') return Response.json(occurrenceCountSourceDescription)
      if (input.operation !== 'query') return Response.json({ error: 'unsupported_operation' }, { status: 400 })
      const connectionId = input.query.scope.connectionId
      // Checked on every page, so a continuation can't outlive a disconnected account.
      if (
        !connectionId ||
        !(await context.providers.connections('rollbar')).some(
          (connection) => connection.id === connectionId && connection.status === 'connected',
        )
      )
        throw new Error('connection_unavailable')
      const read = await retainedRead(context.userId, input, async () => {
        const results = await context.providers.withConnections('rollbar', async (connection, token) =>
          connection.id === connectionId ? readCounts(token, input.query, request.signal) : undefined,
        )
        if (!results[0]) throw new Error('connection_unavailable')
        return results[0]
      })
      return Response.json(await countPage(read, input))
    } catch (error) {
      return failure(error)
    }
  }
}
