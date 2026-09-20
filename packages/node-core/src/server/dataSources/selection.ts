import { createHash, randomUUID } from 'node:crypto'
import type { DataSourcePage, DataSourceQuery, DataSourceRequest } from '@acorn/protocol/dataSources.ts'
import { compareDataValues, type DataPredicate } from '@acorn/protocol/dataBindings.ts'
import { DATA_LIMITS, MISSING, readDataPointer } from '@acorn/protocol/dataValues.ts'

export function dataComparisons(predicate?: DataPredicate): Extract<DataPredicate, { kind: 'comparison' }>[] {
  if (!predicate) return []
  if (predicate.kind === 'all') return predicate.predicates.flatMap(dataComparisons)
  if (predicate.kind !== 'comparison') throw new Error('unsupported_group')
  return [predicate]
}

/** Literal comparisons in `all` groups and numeric sorts only. Providers validate their advertised
 * subset first and prove exhaustion of the bounded candidate set before calling this helper. */
export function selectDataRecords(records: DataSourcePage['records'], query: DataSourceQuery) {
  const selected = records.filter(record => dataComparisons(query.predicate).every(filter => {
    if (filter.left.address.from !== 'item' || (filter.right && filter.right.address.from !== 'literal')) throw new Error('invalid_operand')
    return compareDataValues(
      readDataPointer(record.data, filter.left.address.pointer),
      filter.operator,
      filter.right?.address.from === 'literal' ? filter.right.address.value : MISSING,
    )
  })).sort((a, b) => {
    for (const sort of query.sort) {
      const left = readDataPointer(a.data, sort.pointer)
      const right = readDataPointer(b.data, sort.pointer)
      if (left === right) continue
      if (left === null) return -1
      if (right === null) return 1
      if (typeof left !== 'number' || typeof right !== 'number') throw new Error('unsupported_sort')
      return (left - right) * (sort.direction === 'asc' ? 1 : -1)
    }
    return a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0
  })
  return { records: query.take ? selected.slice(0, query.take) : selected,
    completeness: query.take && selected.length >= query.take ? { kind: 'bounded' as const } : { kind: 'complete' as const } }
}

/** Ephemeral pages of an already validated selection. Callers reauthorize before every read. */
export function createDataSelectionPager() {
  const selections = new Map<string, { key: string; page: DataSourcePage; expires: number; bytes: number }>()
  return async (owner: string, input: Extract<DataSourceRequest, { operation: 'query' }>, read: () => Promise<DataSourcePage>): Promise<DataSourcePage> => {
    for (const [id, entry] of selections) if (entry.expires <= Date.now()) selections.delete(id)
    const key = createHash('sha256').update(JSON.stringify({ owner, query: input.query, mode: input.mode, evaluationTime: input.evaluationTime })).digest('hex')
    let id = randomUUID() as string
    let offset = 0
    let entry
    if (input.cursor) {
      const match = /^([\w-]+):(\d+)$/.exec(input.cursor)
      if (!match) throw new Error('invalid_cursor')
      id = match[1]!
      offset = Number(match[2])
      entry = selections.get(id)
      if (!entry || entry.key !== key || !Number.isSafeInteger(offset) || offset >= entry.page.records.length) throw new Error('expired_or_invalid_cursor')
    } else {
      const page = await read()
      if (page.completeness.kind === 'incomplete') return { ...page, records: [] }
      entry = { key, page, expires: Date.now() + DATA_LIMITS.queryMs, bytes: Buffer.byteLength(JSON.stringify(page)) }
    }
    const records = entry.page.records.slice(offset, offset + input.pageSize)
    const more = offset + records.length < entry.page.records.length
    if (more && !selections.has(id)) {
      const bytes = [...selections.values()].reduce((sum, value) => sum + value.bytes, entry.bytes)
      if (selections.size >= 16 || bytes > DATA_LIMITS.selectionBytes) return { ...entry.page, records: [], completeness: { kind: 'incomplete', cause: 'host-budget' } }
      selections.set(id, entry)
    }
    return { ...entry.page, records, completeness: more ? { kind: 'more', cursor: `${id}:${offset + records.length}` } : entry.page.completeness }
  }
}
