import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dataSourceRequestSchema } from '@acorn/protocol/dataSources.ts'
import type { DataPredicate } from '@acorn/protocol/dataBindings.ts'
import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import { describeFilterRun } from '@acorn/dashboards-core/outline.ts'
import { memoryIdentityStore } from '../activeIdentity'
import { createCoreServices, SecretService } from '../core'
import { schema } from '../db'
import { makeTestDb, testCoreSeams, testEnv } from '../../testkit/db'
import { CapabilityRegistry } from '../pluginHost/capabilities'
import { clearRegistrations, initPlugins } from '../pluginHost/host'
import { runDashboard } from './run'

// Where a filter step ran: a source that applies a status filter as it reads, a size filter it
// declines, and a read it cuts short, so the explanation can be checked against the rows.
const records = [
  { id: '1', status: 'open', size: 1 },
  { id: '2', status: 'closed', size: 2 },
  { id: '3', status: 'open', size: 3 },
  { id: '4', status: 'open', size: 4 },
]
const source = { cap: Infinity, predicates: [] as (DataPredicate | undefined)[] }
const db = makeTestDb()
const secrets = new SecretService('c'.repeat(64))
const identity = memoryIdentityStore('owner')
const env = testEnv({ DB: db.db, ACTIVE_IDENTITY: identity, SECRETS: secrets })

beforeAll(async () => {
  await initPlugins(
    [
      {
        name: 'filter-test',
        init(ctx) {
          ctx.dataSources.register({
            sourceId: 'items',
            name: 'Items',
            singular: 'Item',
            plural: 'Items',
            identityScope: 'ID',
            handler: '/v1/p/filter-test/items',
          })
          ctx.routes.fetch(
            async (request) => {
              const input = dataSourceRequestSchema.parse(await request.json())
              if (input.operation === 'describe')
                return Response.json({
                  schema: {
                    type: 'object',
                    properties: { id: { type: 'string' }, status: { type: 'string' }, size: { type: 'number' } },
                    required: ['id', 'status', 'size'],
                  },
                  fields: [
                    { pointer: '/id', label: 'ID', origin: 'declared' },
                    {
                      pointer: '/status',
                      label: 'Status',
                      origin: 'declared',
                      query: { operators: ['eq'], sortable: false },
                    },
                    { pointer: '/size', label: 'Size', origin: 'declared' },
                  ],
                  parameters: { type: 'object' },
                  parameterFields: [],
                  revision: 'r1',
                  consistency: 'Live',
                  operations: { query: true, options: false, details: false, incremental: false, groups: [] },
                })
              if (input.operation !== 'query') return new Response(null, { status: 404 })
              const predicate = input.query.predicate
              source.predicates.push(predicate)
              const matched = records.filter(
                (record) =>
                  predicate?.kind !== 'comparison' ||
                  predicate.right?.address.from !== 'literal' ||
                  record.status === predicate.right.address.value,
              )
              return Response.json({
                records: matched.slice(0, source.cap).map((data) => ({ recordId: data.id, data })),
                revision: 'r1',
                readTime: 1,
                completeness:
                  matched.length > source.cap ? { kind: 'incomplete', cause: 'upstream-cap' } : { kind: 'complete' },
              })
            },
            { prefix: '/items' },
          )
        },
      },
    ],
    {
      env,
      dataDir: '',
      capabilities: new CapabilityRegistry(),
      core: createCoreServices({ db: db.db, secrets, activeIdentity: identity, ...testCoreSeams() }),
    },
  )
  await db.db
    .insert(schema.workspaces)
    .values({ id: 'w', name: 'Workspace', isDefault: true, sort: 0, createdAt: 1, updatedAt: 1 })
})
afterAll(() => {
  clearRegistrations('filter-test')
  db.cleanup()
})

const where = (column: string, value: string | number): PanelPlan['stages'][number] => ({
  op: 'filter',
  where: {
    kind: 'comparison',
    left: { address: { from: 'item', pointer: `/${column}` } },
    operator: 'eq',
    right: { address: { from: 'literal', value } },
  },
})
let evaluationTime = 1_000_000
const run = (stages: PanelPlan['stages'], cap = Infinity) => {
  // Each run gets its own time, so the Node's five-second shared read doesn't answer from the last one.
  evaluationTime += 10_000
  source.cap = cap
  source.predicates = []
  return runDashboard(
    env,
    {
      scope: { workspaceId: 'w' },
      mode: 'execution',
      evaluationTime,
      target: {
        kind: 'draft',
        content: {
          version: 2,
          title: 'Items',
          time: { zone: 'UTC', mode: 'fixed', weekStart: 'monday' },
          sources: [
            {
              id: 'items',
              label: 'Items',
              role: 'primary',
              reference: {
                kind: 'inline',
                bindings: {},
                content: {
                  name: 'Items',
                  parameters: { type: 'object', properties: {}, additionalProperties: false },
                  sourceParameters: {},
                  query: {
                    source: { pluginId: 'filter-test', sourceId: 'items' },
                    scope: { workspaceId: 'w', parameters: {} },
                    sort: [],
                  },
                },
              },
            },
          ],
          columns: ['id', 'status', 'size'].map((id) => ({
            id,
            label: id,
            type: id === 'size' ? ('number' as const) : ('text' as const),
            bind: { items: { field: `/${id}` } },
          })),
          stages,
          view: { kind: 'table' },
        },
      },
    },
    { principal: { kind: 'internal', scope: 'service', userId: 'owner' }, signal: new AbortController().signal },
  )
}
const ids = (result: Awaited<ReturnType<typeof run>>) => result.rows.map((row) => row.values.id)

describe('filter diagnostics', () => {
  it('say the source applied a filter it declares, and the panel applied one it declines', async () => {
    const result = await run([where('status', 'open'), where('size', 3)])
    expect(source.predicates[0]).toMatchObject({ left: { address: { pointer: '/status' } } })
    expect(result.diagnostics.filters).toEqual([
      { path: '/stages/0', appliedBy: 'source', source: 'items' },
      { path: '/stages/1', appliedBy: 'panel' },
    ])
    expect(ids(result)).toEqual(['3'])
    expect(describeFilterRun(result, '/stages/0')).toBe('Items applies this filter as it reads.')
    expect(describeFilterRun(result, '/stages/1')).toBe('The panel applies this filter to the records it read.')
  })

  it('stop at the first step that isn’t a filter, so a later filter runs on the panel', async () => {
    const result = await run([
      { op: 'compute', columns: [{ id: 'copy', label: 'Copy', expression: { kind: 'column', column: 'size' } }] },
      where('status', 'open'),
    ])
    expect(source.predicates[0]).toBeUndefined()
    expect(result.diagnostics.filters).toEqual([{ path: '/stages/1', appliedBy: 'panel' }])
    expect(ids(result)).toEqual(['1', '3', '4'])
  })

  it('warn that a panel filter only saw what a capped source returned', async () => {
    // The source stops after two records, before the panel's size filter runs, so record 4 is never seen.
    const result = await run([where('size', 4)], 2)
    expect(ids(result)).toEqual([])
    expect(result.diagnostics.problems).toContainEqual(
      expect.objectContaining({ severity: 'warning', failure: expect.objectContaining({ reason: 'upstream-cap' }) }),
    )
    expect(describeFilterRun(result, '/stages/0')).toBe(
      "The panel applies this filter to the records it read. Items returned only some of its records, so this filter couldn't check the rest.",
    )
  })

  it('say a capped source filtered first, so its rows all match but more may exist', async () => {
    const result = await run([where('status', 'open')], 2)
    expect(ids(result)).toEqual(['1', '3'])
    expect(describeFilterRun(result, '/stages/0')).toBe(
      'Items applies this filter as it reads. It stopped before its last match, so more records may match.',
    )
  })

  it('make no claim when the Node leaves the diagnostic out', async () => {
    const result = await run([where('status', 'open')])
    const { filters: _omitted, ...older } = result.diagnostics
    expect(describeFilterRun({ ...result, diagnostics: older }, '/stages/0')).toBeUndefined()
  })
})
