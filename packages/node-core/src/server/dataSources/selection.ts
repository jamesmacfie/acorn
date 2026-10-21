import { createHash, randomUUID } from 'node:crypto'
import type { DataSourcePage, DataSourceQuery, DataSourceRequest } from '@acorn/protocol/dataSources.ts'
import { dataPredicateMatches, type DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { DATA_LIMITS, readDataPointer } from '@acorn/protocol/dataValues.ts'

// Selecting and paging a source's read. See docs/data-sources/serve-a-query.md.

type QueryInput = Extract<DataSourceRequest, { operation: 'query' }>
type SourceRecord = DataSourcePage['records'][number]

export function dataComparisons(predicate?: DataPredicate): Extract<DataPredicate, { kind: 'comparison' }>[] {
  if (!predicate) return []
  if (predicate.kind === 'all') return predicate.predicates.flatMap(dataComparisons)
  if (predicate.kind !== 'comparison') throw new Error('unsupported_group')
  return [predicate]
}

/** Literal comparisons, in `all` or `any` groups, and numeric sorts only. Ties, and a query with no
 *  sort, fall back to record ID order, or with `readOrder` keep the order the records came in.
 *  Providers validate their advertised subset first and prove exhaustion of the bounded candidate set
 *  before calling this helper. */
export function selectDataRecords<T extends SourceRecord>(
  records: T[],
  query: DataSourceQuery,
  { readOrder = false } = {},
) {
  const { predicate } = query
  const selected = (
    predicate ? records.filter((record) => dataPredicateMatches(record.data, predicate)) : [...records]
  ).sort((a, b) => {
    for (const sort of query.sort) {
      const left = readDataPointer(a.data, sort.pointer)
      const right = readDataPointer(b.data, sort.pointer)
      if (left === right) continue
      if (left === null) return -1
      if (right === null) return 1
      if (typeof left !== 'number' || typeof right !== 'number') throw new Error('unsupported_sort')
      return (left - right) * (sort.direction === 'asc' ? 1 : -1)
    }
    return readOrder ? 0 : a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0
  })
  return {
    records: query.take ? selected.slice(0, query.take) : selected,
    completeness:
      query.take && selected.length >= query.take ? { kind: 'bounded' as const } : { kind: 'complete' as const },
  }
}

/** The page of a whole read that starts at `offset`. The host stops at the first page that isn't `more`,
 *  so the read's own completeness, `incomplete` included, waits for its last page. */
function pageAt<T extends { records: unknown[]; completeness: DataSourcePage['completeness'] }>(
  read: T,
  offset: number,
  pageSize: number,
  cursor: (next: number) => string,
): T {
  const records = read.records.slice(offset, offset + pageSize)
  const next = offset + records.length
  return {
    ...read,
    records,
    completeness: next < read.records.length ? { kind: 'more', cursor: cursor(next) } : read.completeness,
  }
}

/**
 * Selects and pages records a source reads again for every page, with the offset as the cursor. A read
 * the budget cut (`truncated`, from `withinDataBudget`) is `incomplete` with `host-budget`, covered from the `timePointer` of the
 * oldest record it kept, so read newest first.
 */
export function pageDataRecords<T extends SourceRecord>(
  input: QueryInput,
  read: { records: T[]; truncated: boolean },
  options: { timePointer?: string; readOrder?: boolean } = {},
) {
  const selected = selectDataRecords(read.records, input.query, options)
  const oldest = options.timePointer && read.records.at(-1)
  const whole: Pick<DataSourcePage, 'completeness' | 'coveredRange'> & { records: T[] } = read.truncated
    ? {
        records: selected.records,
        completeness: { kind: 'incomplete', cause: 'host-budget' },
        ...(oldest
          ? { coveredRange: { start: readDataPointer(oldest.data, options.timePointer!) as number, end: Date.now() } }
          : {}),
      }
    : selected
  const offset = input.cursor ? Number(input.cursor) : 0
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= Math.max(whole.records.length, 1))
    throw new Error('invalid_cursor')
  return pageAt(whole, offset, input.pageSize, String)
}

/** Pages a read made once per run, retained for the run's pages. Callers reauthorize before every read. */
export function createDataSelectionPager() {
  const selections = new Map<string, { key: string; page: DataSourcePage; expires: number; bytes: number }>()
  return async (owner: string, input: QueryInput, read: () => Promise<DataSourcePage>): Promise<DataSourcePage> => {
    for (const [id, entry] of selections) if (entry.expires <= Date.now()) selections.delete(id)
    const key = createHash('sha256')
      .update(JSON.stringify({ owner, query: input.query, mode: input.mode, evaluationTime: input.evaluationTime }))
      .digest('hex')
    let id = randomUUID() as string
    let offset = 0
    let entry
    if (input.cursor) {
      const match = /^([\w-]+):(\d+)$/.exec(input.cursor)
      if (!match) throw new Error('invalid_cursor')
      id = match[1]!
      offset = Number(match[2])
      entry = selections.get(id)
      if (!entry || entry.key !== key || !Number.isSafeInteger(offset) || offset >= entry.page.records.length)
        throw new Error('expired_or_invalid_cursor')
    } else {
      const page = await read()
      entry = { key, page, expires: Date.now() + DATA_LIMITS.queryMs, bytes: Buffer.byteLength(JSON.stringify(page)) }
    }
    if (offset + input.pageSize < entry.page.records.length && !selections.has(id)) {
      const bytes = [...selections.values()].reduce((sum, value) => sum + value.bytes, entry.bytes)
      if (selections.size >= 16 || bytes > DATA_LIMITS.selectionBytes)
        return { ...entry.page, records: [], completeness: { kind: 'incomplete', cause: 'host-budget' } }
      selections.set(id, entry)
    }
    return pageAt(entry.page, offset, input.pageSize, (next) => `${id}:${next}`)
  }
}
