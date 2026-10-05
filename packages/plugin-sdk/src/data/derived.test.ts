import { expect, it } from 'vitest'
import type { DataSourceInputHandle, DataSourceResult, PluginRequestContext } from 'acorn-plugin-types'
import { defineDerivedSource, derivedSourceManifest, field } from './index.ts'
import type * as Published from './public.ts'
import * as data from './index.ts'

// The published declaration is hand-written, so hold it to the implementation both ways.
type Mutual<A, B> = [A extends B ? true : never, B extends A ? true : never]
const _field: Mutual<typeof data.field, typeof Published.field> = [true, true]
const _define: Mutual<typeof data.defineDerivedSource, typeof Published.defineDerivedSource> = [true, true]
const _manifest: Mutual<typeof data.derivedSourceManifest, typeof Published.derivedSourceManifest> = [true, true]
void [_field, _define, _manifest]

const result = (records: { id: string; data: Record<string, unknown>; url?: string }[], completeness: DataSourceResult['completeness'] = { kind: 'complete' }): DataSourceResult => ({
  records: records.map(record => ({ ref: { pluginId: 'up', sourceId: 'items', recordId: record.id }, data: record.data as never,
    ...(record.url ? { action: { verb: 'openUrl' as const, url: record.url } } : {}) })),
  revision: 'up-1', readTime: 1, completeness, mode: 'execution', evaluationTime: 1,
})
const handle = (query: DataSourceInputHandle['query']): DataSourceInputHandle => ({
  describe: async () => { throw new Error('unused') }, identity: async () => ({}), options: async () => ({ options: [], exhausted: true }), query,
})
const context = (inputs: Record<string, DataSourceInputHandle>) => ({ userId: 'owner', principal: { kind: 'device', userId: 'owner' }, providers: {}, inputs }) as unknown as PluginRequestContext
const call = async (source: { fetch: (request: Request, context: PluginRequestContext) => Response | Promise<Response> }, body: unknown, inputs: Record<string, DataSourceInputHandle> = {}) => {
  const response = await source.fetch(new Request('http://plugin.test/', { method: 'POST', body: JSON.stringify(body) }), context(inputs))
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}
const query = (pageSize = 25, cursor?: string) => ({ operation: 'query', mode: 'execution', evaluationTime: 5, pageSize, ...(cursor ? { cursor } : {}),
  query: { source: { pluginId: 'mine', sourceId: 'rows' }, scope: { parameters: {} }, sort: [] } })

const readiness = defineDerivedSource({
  id: 'rows', name: 'Rows', singular: 'Row', plural: 'Rows', handler: '/v1/p/mine/rows',
  inputs: { items: { source: 'up:items', label: 'Items' }, extra: { source: 'up:items', label: 'Extra', optional: true } },
  fields: {
    title: field.text({ label: 'Title', role: 'title' }),
    state: field.choice({ label: 'State', role: 'status', choices: [{ id: 'ready', label: 'Ready', tone: 'ok' }, { id: 'blocked', label: 'Blocked', tone: 'bad' }] }),
    labels: field.text({ label: 'Labels', list: true }),
    due: field.datetime({ label: 'Due', precision: 'day', nullable: true }),
  },
  async query({ inputs }) {
    // Optional inputs are typed `| undefined`: without the `?.`, this line doesn't compile.
    const extra = await inputs.extra?.all()
    const { records } = await inputs.items.all({ where: { open: true } })
    return [...records, ...extra?.records ?? []].map(record => ({ id: record.ref.recordId, opens: record.ref,
      data: { title: String(record.data.title), state: record.data.blocked ? 'blocked' as const : 'ready' as const, labels: [], due: null } }))
  },
})

it('builds fields and their schema together, and describes them with a stable revision', async () => {
  expect(field.number({ label: 'Points', unit: 'pt', nullable: true })).toEqual({
    schema: { type: ['number', 'null'] }, field: { label: 'Points', origin: 'declared', display: { kind: 'number', unit: 'pt' } },
  })
  expect(field.choice({ label: 'Size', nullable: true, choices: [{ id: 's', label: 'Small' }] }).schema).toEqual({ type: ['string', 'null'], enum: ['s', null] })
  expect(field.person({ label: 'Owner', list: true }).schema).toEqual({ type: 'array', items: { type: 'string' } })
  expect(field.boolean({ label: 'Done' }).field.display).toEqual({ kind: 'boolean' })
  expect(field.link({ label: 'Link', role: 'url' }).field.display).toEqual({ kind: 'link', role: 'url' })

  const { body } = await call(readiness, { operation: 'describe', source: { pluginId: 'mine', sourceId: 'rows' }, scope: { parameters: {} } })
  expect(body).toEqual(readiness.description)
  expect(body.schema).toEqual({ type: 'object', additionalProperties: false, required: ['title', 'state', 'labels', 'due'], properties: {
    title: { type: 'string' }, state: { type: 'string', enum: ['ready', 'blocked'] }, labels: { type: 'array', items: { type: 'string' } },
    due: { type: ['number', 'null'] } } })
  expect((body.fields as { pointer: string; display: unknown }[]).map(item => [item.pointer, item.display])).toEqual([
    ['/title', { kind: 'text', role: 'title' }], ['/state', { kind: 'status', role: 'status' }],
    ['/labels', { kind: 'text', list: true }], ['/due', { kind: 'datetime', precision: 'day' }]])
  expect(body.revision).toMatch(/^sdk\./)
  expect(defineDerivedSource({ ...readiness.definition }).description.revision).toBe(body.revision)
  expect(defineDerivedSource({ ...readiness.definition, fields: { title: field.text({ label: 'Name' }) }, query: () => [] }).description.revision).not.toBe(body.revision)
})

it('emits the manifest entry from the definition', () => {
  expect(derivedSourceManifest(readiness)).toEqual({
    sourceId: 'rows', name: 'Rows', singular: 'Row', plural: 'Rows', identityScope: 'Built from its inputs', handler: '/v1/p/mine/rows',
    titlePointer: '/title', inputs: { items: { source: 'up:items', label: 'Items' }, extra: { source: 'up:items', label: 'Extra', optional: true } },
  })
})

it('reads a bound input, turns `where` into a predicate, opens the upstream record, and skips an unbound optional input', async () => {
  const asked: unknown[] = []
  const items = handle(async (request) => {
    asked.push(request)
    return result([{ id: 'a', data: { title: 'A' }, url: 'https://example.test/a' }, { id: 'b', data: { title: 'B', blocked: true } }])
  })
  const { body } = await call(readiness, query(), { items })
  expect(asked).toEqual([{ pageSize: 100, predicate: { kind: 'all', predicates: [{ kind: 'comparison', operator: 'eq',
    left: { address: { from: 'item', pointer: '/open' } }, right: { address: { from: 'literal', value: true } } }] } }])
  expect(body).toMatchObject({ revision: readiness.description.revision, completeness: { kind: 'complete' }, records: [
    { recordId: 'a', data: { state: 'ready' }, action: { verb: 'openUrl', url: 'https://example.test/a' }, display: { url: 'https://example.test/a' } },
    { recordId: 'b', data: { state: 'blocked' } }] })
  expect((body.records as Record<string, unknown>[])[1]).not.toHaveProperty('action')
  // A required input with no handle only happens when something other than the host calls the route.
  expect((await call(readiness, query())).status).toBe(400)
})

it('pages through an input with `all`, and stops at the record budget', async () => {
  let reads = 0
  const paged = handle(async ({ cursor } = {}) => {
    reads++
    const start = Number(cursor ?? 0)
    const records = Array.from({ length: 100 }, (_, index) => ({ id: String(start + index), data: { title: 'x' } }))
    return result(records, start + 100 < 300 ? { kind: 'more', cursor: String(start + 100) } : { kind: 'complete' })
  })
  const counted = defineDerivedSource({ ...readiness.definition, query: async ({ inputs }) => {
    const read = await inputs.items.all()
    return [{ id: 'count', data: { title: String(read.records.length), state: 'ready', labels: [read.completeness.kind], due: null } }]
  } })
  expect((await call(counted, query(), { items: paged })).body.records).toMatchObject([{ data: { title: '300', labels: ['complete'] } }])
  expect(reads).toBe(3)

  const endless = handle(async ({ cursor } = {}) => result(Array.from({ length: 100 }, (_, index) => ({ id: `${cursor ?? 0}-${index}`, data: {} })),
    { kind: 'more', cursor: String(Number(cursor ?? 0) + 1) }))
  const cut = await call(counted, query(), { items: endless })
  expect(cut.body).toMatchObject({ records: [{ data: { title: '5000', labels: ['incomplete'] } }], completeness: { kind: 'incomplete', cause: 'host-budget' } })
})

it('drops records that fail the declared fields, counts them, and pages the rest', async () => {
  const mixed = defineDerivedSource({ ...readiness.definition, query: () => [
    { id: '1', data: { title: 'One', state: 'ready', labels: [], due: null } },
    { id: '2', data: { title: 'Two', state: 'unknown', labels: [], due: null } } as never,
    { id: '3', data: { title: 'Three', state: 'ready', labels: [], due: 7 } },
  ] })
  const first = await call(mixed, query(1), { items: handle(async () => result([])) })
  expect(first.body).toMatchObject({ records: [{ recordId: '1' }], completeness: { kind: 'more' } })
  const cursor = (first.body.completeness as { cursor: string }).cursor
  const second = await call(mixed, query(1, cursor), { items: handle(async () => result([])) })
  expect(second.body).toMatchObject({ records: [{ recordId: '3' }], completeness: { kind: 'incomplete', cause: 'invalid-records', count: 1 } })
  // `details` answers from the newest run.
  expect((await call(mixed, { operation: 'details', ref: { pluginId: 'mine', sourceId: 'rows', recordId: '3' }, scope: { parameters: {} }, projection: [] })).body)
    .toEqual({ kind: 'found', data: { title: 'Three', state: 'ready', labels: [], due: 7 }, fetchedTime: 5 })

  const twice = defineDerivedSource({ ...readiness.definition, query: () => [
    { id: '1', data: { title: 'One', state: 'ready', labels: [], due: null } }, { id: '1', data: { title: 'One', state: 'ready', labels: [], due: null } }] })
  expect(await call(twice, query(), { items: handle(async () => result([])) })).toMatchObject({ status: 502, body: { message: 'Two records share the id 1' } })
})
