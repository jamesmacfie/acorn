import { describe, expect, it } from 'vitest'
import type { DataSourceDescription, DataSourceQuery } from '@acorn/protocol/dataSources.ts'
import { validateDescription, validateSourceQuery } from './validation'

const description = (): DataSourceDescription => ({
  schema: { type: 'object', properties: { state: { type: 'string' }, count: { type: 'number' } } },
  fields: [{ pointer: '/state', label: 'State', origin: 'declared', query: { operators: ['eq', 'in'], sortable: true }, choices: { kind: 'static', values: [{ id: 'open', label: 'Open' }] } }],
  parameters: { type: 'object', properties: { project: { type: 'string' }, team: { type: 'string' } } }, parameterFields: [],
  operations: { query: true, details: false, options: false, incremental: false, groups: ['all'] }, revision: '1', consistency: 'Live',
})
const query = (): DataSourceQuery => ({ source: { pluginId: 'test', sourceId: 'records' }, scope: { parameters: {} }, sort: [], predicate: { kind: 'comparison', left: { address: { from: 'item', pointer: '/state' } }, operator: 'eq', right: { address: { from: 'literal', value: 'removed-state' } } } })

describe('source authoring validation', () => {
  it('rejects removed static choices and unsupported groups/sorts', () => {
    expect(() => validateSourceQuery(query(), description())).toThrow('invalid-request')
    const request = query()
    request.predicate = { kind: 'any', predicates: [request.predicate!] }
    expect(() => validateSourceQuery(request, description())).toThrow('unsupported-query')
    request.predicate = undefined
    request.sort = [{ pointer: '/count', direction: 'asc' }]
    expect(() => validateSourceQuery(request, description())).toThrow('unsupported-query')
  })
  it('rejects metadata paths outside structural schema and cyclic parameter dependencies', () => {
    const metadata = description()
    metadata.fields[0]!.pointer = '/unknown'
    expect(() => validateDescription(metadata)).toThrow('invalid-response')
    metadata.fields = []
    metadata.parameterFields = [
      { pointer: '/project', label: 'Project', origin: 'declared', choices: { kind: 'dynamic', dependsOn: ['/team'] } },
      { pointer: '/team', label: 'Team', origin: 'declared', choices: { kind: 'dynamic', dependsOn: ['/project'] } },
    ]
    expect(() => validateDescription(metadata)).toThrow('invalid-response')
  })
})
