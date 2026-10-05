import { afterEach, expect, it } from 'vitest'
import { invokeDataSource } from '@acorn/node-core/server/dataSources'
import { makeTestNodeContext, memoryIdentityStore, testEnv, type TestNodeContext } from '@acorn/plugin-api/testkit'
import { defineDerivedSource, derivedSourceManifest, field } from './index.ts'

// The SDK's handler under the host's own runtime: the host describes it, composes its revision, binds
// its input, reads the input for it, checks its pages, and drops what fails its schema. A unit test
// with a fake handle can't show those agree.
const contexts: TestNodeContext[] = []
afterEach(() => { for (const context of contexts.splice(0)) context.cleanup() })

const rows = defineDerivedSource({
  id: 'doubled', name: 'Doubled', singular: 'Row', plural: 'Rows', handler: '/v1/p/sdk-derived/doubled',
  inputs: { numbers: { source: 'sdk-upstream:numbers', label: 'Numbers' } },
  fields: { value: field.number({ label: 'Value' }) },
  async query({ inputs }) {
    const { records } = await inputs.numbers.all()
    // An odd input breaks the declared field on purpose, so the page reports one dropped record.
    return records.map(record => ({ id: record.ref.recordId, data: { value: record.data.n === 3 ? 'three' as never : Number(record.data.n) * 2 } }))
  },
})

function world() {
  const upstream = makeTestNodeContext({ plugin: { name: 'sdk-upstream' } })
  const derived = makeTestNodeContext({ plugin: { name: 'sdk-derived' } })
  contexts.push(upstream, derived)
  upstream.dataSources.register({ sourceId: 'numbers', name: 'Numbers', singular: 'Number', plural: 'Numbers', identityScope: 'Number', handler: '/v1/p/sdk-upstream/numbers' })
  upstream.routes.fetch(async (request) => {
    const input = await request.json() as { operation: string }
    if (input.operation === 'describe') return Response.json({ schema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
      fields: [], parameters: { type: 'object' }, parameterFields: [], revision: 'numbers-1', consistency: 'Fixed',
      operations: { query: true, options: false, details: false, incremental: false, groups: [] } })
    return Response.json({ records: [1, 2, 3].map(n => ({ recordId: String(n), data: { n } })), revision: 'numbers-1', readTime: 1, completeness: { kind: 'complete' } })
  }, { prefix: '/numbers' })
  derived.dataSources.register(derivedSourceManifest(rows))
  derived.routes.fetch(rows.fetch)
  return testEnv({ ...upstream.env, ACTIVE_IDENTITY: memoryIdentityStore('owner') })
}

const invocation = () => ({ principal: { kind: 'internal' as const, scope: 'service' as const, userId: 'owner' }, signal: new AbortController().signal })
const scope = { parameters: {}, inputs: { numbers: { parameters: {} } } }

it('describes, reads its input through the host, and reports dropped records', async () => {
  const env = world()
  const description = await invokeDataSource(env, { operation: 'describe', source: { pluginId: 'sdk-derived', sourceId: 'doubled' }, scope }, invocation())
  expect(description.revision).toMatch(/^derived\./)
  expect(description.fields).toEqual(rows.description.fields)

  const result = await invokeDataSource(env, { operation: 'query', mode: 'execution', evaluationTime: 1, pageSize: 25,
    query: { source: { pluginId: 'sdk-derived', sourceId: 'doubled' }, scope, sort: [] } }, invocation())
  expect(result.records.map(record => [record.ref.recordId, record.data])).toEqual([['1', { value: 2 }], ['2', { value: 4 }]])
  expect(result.completeness).toEqual({ kind: 'incomplete', cause: 'invalid-records', count: 1 })
  expect(result.inputs).toEqual({ numbers: { records: 3, completeness: { kind: 'complete' } } })
  expect(result.revision).toBe(description.revision)
})
