import { dataComparisons, DATA_LIMITS, selectDataRecords } from '@acorn/plugin-api/node'
import type {
  DataSourceDescription,
  DataSourceOptions,
  DataSourcePage,
  DataSourceQuery,
} from '@acorn/protocol/dataSources.ts'
import { linearData, linearFetch } from '../index'

// The reads every Linear source shares: one GraphQL call, the query's checked filters, and a paged
// read that exhausts Linear before it filters, sorts, and takes.

export type Page<T> = { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
export const pageFields = 'pageInfo { hasNextPage endCursor }'

export async function graph<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted()
  const response = await linearFetch(token, query, variables, signal)
  if (!response.ok) throw new Error('linear_unavailable')
  return linearData<T>(response)
}

/** Epoch milliseconds for a Linear timestamp, refusing one that doesn't parse. */
export function epoch(value: string): number
export function epoch(value: string | null): number | null
export function epoch(value: string | null) {
  if (value === null) return null
  const time = Date.parse(value)
  if (!Number.isFinite(time)) throw new Error('invalid_record')
  return time
}

/** The query's literal comparisons, each one an operator its field advertises. */
export function sourceFilters(description: DataSourceDescription, query: DataSourceQuery) {
  const field = (pointer: string) => description.fields.find((candidate) => candidate.pointer === pointer)
  for (const sort of query.sort) if (!field(sort.pointer)?.query?.sortable) throw new Error('unsupported_sort')
  return dataComparisons(query.predicate).map((comparison) => {
    const left = comparison.left.address,
      right = comparison.right?.address
    if (left.from !== 'item' || right?.from !== 'literal') throw new Error('invalid_operand')
    if (!field(left.pointer)?.query?.operators.includes(comparison.operator)) throw new Error('unsupported_filter')
    return { pointer: left.pointer, operator: comparison.operator, value: right.value }
  })
}

/** A Linear date comparison, `{ updatedAt: { gte: '…' } }`, for a time field's epoch literal. */
export function dateFilter(filter: ReturnType<typeof sourceFilters>[number]) {
  if (typeof filter.value !== 'number') throw new Error('invalid_date')
  return { [filter.pointer.slice(1)]: { [filter.operator]: new Date(filter.value).toISOString() } }
}

export function optionsPage(page: Page<{ id: string; name: string }>, cursor: string | undefined): DataSourceOptions {
  if (page.pageInfo.hasNextPage && (!page.pageInfo.endCursor || page.pageInfo.endCursor === cursor))
    throw new Error('invalid_cursor')
  return {
    options: page.nodes.map((node) => ({ id: node.id, label: node.name.slice(0, 80) })),
    exhausted: !page.pageInfo.hasNextPage,
    ...(page.pageInfo.hasNextPage ? { nextCursor: page.pageInfo.endCursor! } : {}),
  }
}

/**
 * Reads every upstream page, then filters, sorts, and takes. When the selection budget stops the
 * read first, the page is incomplete with no records, because a take over part of the selection
 * isn't its first N.
 */
export async function readAllRecords<T extends { id: string }>(
  description: DataSourceDescription,
  query: DataSourceQuery,
  fetchPage: (after: string | null) => Promise<Page<T>>,
  toRecord: (node: T) => DataSourcePage['records'][number],
): Promise<DataSourcePage> {
  const cut = (): DataSourcePage => ({
    records: [],
    revision: description.revision,
    readTime: Date.now(),
    completeness: { kind: 'incomplete', cause: 'upstream-cap' },
  })
  const records: DataSourcePage['records'] = []
  const ids = new Set<string>(),
    cursors = new Set<string>()
  let after: string | null = null,
    bytes = 0
  for (let page = 0; page < DATA_LIMITS.queryPages; page++) {
    const nodes = await fetchPage(after)
    for (const node of nodes.nodes) {
      if (ids.has(node.id)) throw new Error('invalid_record')
      ids.add(node.id)
      const record = toRecord(node)
      const size = Buffer.byteLength(JSON.stringify(record))
      if (size > DATA_LIMITS.recordBytes) throw new Error('invalid_record')
      bytes += size
      if (records.length >= DATA_LIMITS.selectionRecords || bytes > DATA_LIMITS.selectionBytes) return cut()
      records.push(record)
    }
    if (!nodes.pageInfo.hasNextPage)
      return { ...selectDataRecords(records, query), revision: description.revision, readTime: Date.now() }
    after = nodes.pageInfo.endCursor
    if (!after || cursors.has(after)) throw new Error('invalid_cursor')
    cursors.add(after)
  }
  return cut()
}
