import { compareDataValues, type DataPredicate } from '@acorn/protocol/dataBindings.ts'
import type { DataSourceQuery, DataSourcePage } from '@acorn/protocol/dataSources.ts'
import { readDataPointer } from '@acorn/protocol/dataValues.ts'
import { pullSourceDescription } from '../../shared/pullSource'

export const repositoryName = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(value) || value.length > 200) throw new Error('invalid_repository')
  return value
}

function comparisons(predicate?: DataPredicate): Extract<DataPredicate, { kind: 'comparison' }>[] {
  if (!predicate) return []
  if (predicate.kind === 'all') return predicate.predicates.flatMap(comparisons)
  if (predicate.kind !== 'comparison') throw new Error('unsupported_group')
  return [predicate]
}

/** Qualifiers only narrow candidates. Exact typed predicates are checked after full exhaustion. */
export function pullSearch(query: DataSourceQuery): string {
  const repositories = query.scope.parameters.repositories
  if (repositories !== undefined && (!Array.isArray(repositories) || repositories.length > 50)) throw new Error('invalid_repositories')
  const parts = ['is:pr', ...(repositories ?? []).map(value => `repo:${repositoryName(value)}`)]
  for (const filter of comparisons(query.predicate)) {
    const left = filter.left.address
    const right = filter.right?.address
    if (left.from !== 'item' || right?.from !== 'literal') throw new Error('invalid_operand')
    const field = pullSourceDescription.fields.find(field => field.pointer === left.pointer)
    if (!field?.query?.operators.includes(filter.operator)) throw new Error('unsupported_filter')
    const value = right.value
    switch (left.pointer) {
      case '/author':
        if (typeof value !== 'string' || !/^[\w-]+(?:\[bot\])?$/.test(value)) throw new Error('invalid_author')
        parts.push(`author:${value}`)
        break
      case '/state':
        if (!['open', 'closed', 'merged'].includes(String(value))) throw new Error('invalid_state')
        parts.push(value === 'closed' ? 'is:closed is:unmerged' : `is:${value}`)
        break
      case '/draft':
        if (typeof value !== 'boolean') throw new Error('invalid_draft')
        parts.push(`draft:${value}`)
        break
      case '/reviewRequestedFromViewer':
        if (typeof value !== 'boolean') throw new Error('invalid_review_filter')
        parts.push(value ? 'review-requested:@me' : '-review-requested:@me')
        break
      default: {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('invalid_date')
        const lower = filter.operator === 'gt' || filter.operator === 'gte'
        // Search dates have second precision; include boundary seconds, then compare milliseconds.
        const date = new Date((lower ? Math.floor(value / 1000) : Math.ceil(value / 1000)) * 1000).toISOString()
        parts.push(`${left.pointer === '/createdAt' ? 'created' : 'updated'}:${lower ? '>=' : '<='}${date}`)
      }
    }
  }
  for (const sort of query.sort) {
    if (!pullSourceDescription.fields.find(field => field.pointer === sort.pointer)?.query?.sortable) throw new Error('unsupported_sort')
  }
  return parts.join(' ')
}

export function selectPulls(records: DataSourcePage['records'], query: DataSourceQuery): DataSourcePage['records'] {
  const filters = comparisons(query.predicate)
  return records.filter(record => filters.every(filter => {
    if (filter.left.address.from !== 'item' || filter.right?.address.from !== 'literal') throw new Error('invalid_operand')
    return compareDataValues(readDataPointer(record.data, filter.left.address.pointer), filter.operator, filter.right.address.value)
  })).sort((a, b) => {
    for (const sort of query.sort) {
      const left = readDataPointer(a.data, sort.pointer)
      const right = readDataPointer(b.data, sort.pointer)
      if (typeof left !== 'number' || typeof right !== 'number') throw new Error('invalid_sort_value')
      if (left !== right) return (left - right) * (sort.direction === 'asc' ? 1 : -1)
    }
    return a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0
  })
}
