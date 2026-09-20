import { dataComparisons, DATA_LIMITS, selectDataRecords, type PluginRequestContext } from '@acorn/plugin-api/node'
import type { DataSourceDetails, DataSourcePage, DataSourceQuery } from '@acorn/protocol/dataSources.ts'
import { parseDataValue } from '@acorn/protocol/dataValues.ts'
import type { RollbarItemMetadata, RollbarItemSummary, RollbarOccurrenceDetail, RollbarOccurrencesResponse } from '../../shared/api'
import { errorSourceDescription } from '../../shared/errorSource'
import { rollbarData, rollbarFetch, type RollbarApiItem } from '../index'
import { CAPS, normalizeSummary } from '../normalize'
import { ROLLBAR_ITEMS_RESOURCE, type RollbarResourceInput } from '../provider'
import { ROLLBAR_OCCURRENCES_RESOURCE, ROLLBAR_OCCURRENCE_RESOURCE, type RollbarOccurrencesInput, type RollbarOccurrenceInput } from '../occurrenceResources'

export function errorRecord(item: RollbarItemSummary) {
  if (!/^\d+$/.test(item.itemId) || !/^\d+$/.test(item.identifier)) throw new Error('invalid_identity')
  for (const value of [item.title, item.environment, item.level, item.status]) {
    if (Buffer.byteLength(value) > CAPS.maxStringBytes) throw new Error('source_string_too_large')
  }
  return { recordId: `${item.itemId}:${item.identifier}`, data: {
    id: item.itemId, counter: item.identifier, title: item.title, url: item.url, level: item.level,
    status: item.status, environment: item.environment, totalOccurrences: item.totalOccurrences,
    firstOccurrenceAt: item.firstOccurrenceAt, lastOccurrenceAt: item.lastOccurrenceAt,
  }, ...(item.url ? { action: { verb: 'openUrl' as const, url: item.url } } : {}) }
}

export async function readErrors(token: string, connectionId: string, query: DataSourceQuery, signal: AbortSignal): Promise<DataSourcePage> {
  const params = new URLSearchParams()
  for (const comparison of dataComparisons(query.predicate)) {
    const left = comparison.left.address, right = comparison.right?.address
    if (left.from !== 'item' || right?.from !== 'literal') throw new Error('invalid_operand')
    if (!errorSourceDescription.fields.find(field => field.pointer === left.pointer)?.query?.operators.includes(comparison.operator)) throw new Error('unsupported_filter')
    if (['/status', '/level', '/environment'].includes(left.pointer)) {
      if (typeof right.value !== 'string' || !right.value) throw new Error('invalid_filter')
      params.append(left.pointer.slice(1), right.value)
    } else if (typeof right.value !== 'number' || !Number.isFinite(right.value)) throw new Error('invalid_date')
  }
  for (const sort of query.sort) if (!errorSourceDescription.fields.find(field => field.pointer === sort.pointer)?.query?.sortable) throw new Error('unsupported_sort')
  const records: DataSourcePage['records'] = [], ids = new Set<string>()
  let bytes = 0
  for (let page = 1; page <= DATA_LIMITS.queryPages; page++) {
    signal.throwIfAborted()
    params.set('page', String(page))
    const result = await rollbarData<{ items: RollbarApiItem[] }>(await rollbarFetch(token, `/items?${params}`, signal))
    if (!Array.isArray(result.items)) throw new Error('invalid_page')
    for (const item of result.items) {
      for (const value of [item.title, item.environment, item.level, item.status]) {
        if (typeof value === 'string' && Buffer.byteLength(value) > CAPS.maxStringBytes) throw new Error('source_string_too_large')
      }
      const record = errorRecord(normalizeSummary(connectionId, '', item))
      if (ids.has(record.recordId)) throw new Error('duplicate_identity')
      ids.add(record.recordId)
      const size = Buffer.byteLength(JSON.stringify(record))
      if (size > DATA_LIMITS.recordBytes) throw new Error('record_too_large')
      bytes += size
      if (records.length >= DATA_LIMITS.selectionRecords || bytes > DATA_LIMITS.selectionBytes) return { records: [], revision: '1', readTime: Date.now(), completeness: { kind: 'incomplete', cause: 'upstream-cap' } }
      records.push(record)
    }
    // The documented items endpoint returns 100 records per page, with no cursor or snapshot.
    if (result.items.length < 100) return { ...selectDataRecords(records, query), revision: '1', readTime: Date.now() }
  }
  return { records: [], revision: '1', readTime: Date.now(), completeness: { kind: 'incomplete', cause: 'upstream-cap' } }
}

export async function readErrorDetails(context: PluginRequestContext, connectionId: string, recordId: string, signal: AbortSignal): Promise<DataSourceDetails> {
  const match = /^(\d+):(\d+)$/.exec(recordId)
  if (!match) throw new Error('invalid_identity')
  const identifier = match[2]!
  signal.throwIfAborted()
  const metadata = await context.providers.resource<RollbarResourceInput, RollbarItemMetadata>({ providerId: 'rollbar', connectionId,
    resourceId: ROLLBAR_ITEMS_RESOURCE, input: { kind: 'detail', identifier }, requireFresh: true })
  signal.throwIfAborted()
  if (!metadata.ok) {
    if (metadata.failure.status === 404) return { kind: 'not-found' }
    throw new Error('metadata_unavailable')
  }
  if (metadata.value.itemId !== match[1]) return { kind: 'not-found' }
  const occurrences = await context.providers.resource<RollbarOccurrencesInput, RollbarOccurrencesResponse>({ providerId: 'rollbar', connectionId,
    resourceId: ROLLBAR_OCCURRENCES_RESOURCE, input: { identifier }, requireFresh: true })
  signal.throwIfAborted()
  if (!occurrences.ok) throw new Error('occurrences_unavailable')
  const latest = occurrences.value.occurrences[0]
  let latestOccurrence = null
  if (latest) {
    const occurrence = await context.providers.resource<RollbarOccurrenceInput, RollbarOccurrenceDetail>({ providerId: 'rollbar', connectionId,
      resourceId: ROLLBAR_OCCURRENCE_RESOURCE, input: { identifier, occurrenceId: latest.id }, requireFresh: true })
    signal.throwIfAborted()
    if (!occurrence.ok || occurrence.value.truncated) throw new Error('occurrence_unavailable_or_truncated')
    const value = occurrence.value
    latestOccurrence = { id: value.id, occurredAt: value.occurredAt, message: value.message, exceptionClass: value.exceptionClass, frames: value.frames }
  }
  const data = parseDataValue({ group: errorRecord(metadata.value).data, latestOccurrence })
  // The resource normalizer caps strings at 8 KiB plus its omission marker. Refuse those
  // projections instead of treating an omitted suffix as complete source data.
  const assertStrings = (value: typeof data): void => {
    if (typeof value === 'string' && Buffer.byteLength(value) > CAPS.maxStringBytes) throw new Error('source_string_too_large')
    if (value && typeof value === 'object') for (const child of Object.values(value)) assertStrings(child)
  }
  assertStrings(data)
  if (Buffer.byteLength(JSON.stringify(data)) > DATA_LIMITS.detailBytes) throw new Error('detail_too_large')
  return { kind: 'found', data, fetchedTime: Date.now() }
}
